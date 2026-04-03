import type { WebClient } from '@slack/web-api'
import type { OpenCodeClient } from './opencode.js'

interface StreamState {
  channelId: string
  messageTs: string
  sessionId: string
  originalChannelId: string  // Where user's message was (for reactions)
  originalMessageTs: string  // User's message timestamp (for reactions)
  threadTs: string           // Thread timestamp (the streaming message)
  accumulatedText: string
  accumulatedThinking: string
  isThinkingActive: boolean
  lastUpdate: number
  toolOutputs: Map<string, ToolOutput>
}

interface ToolOutput {
  tool: string
  status: 'pending' | 'running' | 'completed' | 'error'
  input?: unknown
  output?: string
  title?: string
}

const UPDATE_INTERVAL_MS = 500
const MAX_MESSAGE_LENGTH = 4000 // Slack's actual limit

// Regex patterns for thinking blocks
const THINKING_TAGS = [
  /<thinking>([\s\S]*?)<\/thinking>/gi,
  /<antThinking>([\s\S]*?)<\/antThinking>/gi,
]

// Opening tags that indicate thinking started (no closing yet)
const OPENING_TAGS = [
  /<thinking>/i,
  /<antThinking>/i,
]

const CLOSING_TAGS = [
  /<\/thinking>/i,
  /<\/antThinking>/i,
]

export class StreamManager {
  private streams = new Map<string, StreamState>()
  private updateTimers = new Map<string, NodeJS.Timeout>()
  private eventHandlers = new Map<string, (event: Record<string, unknown>) => void>()
  private onStreamEnd?: (sessionId: string) => Promise<void> | void

  constructor(
    private slack: WebClient,
    private opencode: OpenCodeClient,
    onStreamEnd?: (sessionId: string) => Promise<void> | void
  ) {
    this.onStreamEnd = onStreamEnd
  }

  async startStream(
    channelId: string,
    messageTs: string,
    sessionId: string,
    originalChannelId?: string,
    originalMessageTs?: string
  ): Promise<void> {
    const state: StreamState = {
      channelId,
      messageTs,
      sessionId,
      originalChannelId: originalChannelId || channelId,
      originalMessageTs: originalMessageTs || messageTs,
      threadTs: messageTs,
      accumulatedText: '',
      accumulatedThinking: '',
      isThinkingActive: false,
      lastUpdate: Date.now(),
      toolOutputs: new Map(),
    }

    this.streams.set(sessionId, state)

    // Create bound handler for this session
    const handler = (event: Record<string, unknown>) => {
      this.handleEvent(sessionId, event)
    }

    this.eventHandlers.set(sessionId, handler)

    // Register with single global SSE subscriber
    await this.opencode.onSessionEvent(sessionId, handler)
  }

  private handleEvent(sessionId: string, event: Record<string, unknown>): void {
    const state = this.streams.get(sessionId)
    if (!state) return

    const eventType = event.type as string
    const props = event.properties as Record<string, unknown> | undefined

    switch (eventType) {
      case 'message.part.delta':
        this.handleDelta(state, props as { field: string; delta: string })
        break

      case 'message.part.updated':
        this.handlePartUpdated(state, props as { part: Record<string, unknown> })
        break

      case 'session.idle':
        this.handleSessionIdle(state)
        break

      case 'session.error':
        this.handleSessionError(state, props as { error?: { data?: { message?: string } } })
        break
    }
  }

  private handleDelta(
    state: StreamState,
    properties: { field: string; delta: string }
  ): void {
    if (properties.field === 'text') {
      const delta = properties.delta

      // Check for opening/closing thinking tags in the delta
      for (const openTag of OPENING_TAGS) {
        if (openTag.test(delta)) {
          state.isThinkingActive = true
          openTag.lastIndex = 0 // Reset regex
          break
        }
      }

      for (const closeTag of CLOSING_TAGS) {
        if (closeTag.test(delta)) {
          state.isThinkingActive = false
          closeTag.lastIndex = 0 // Reset regex
          break
        }
      }

      // Route to thinking or answer
      if (state.isThinkingActive) {
        state.accumulatedThinking += delta
      } else {
        state.accumulatedText += delta
      }

      this.scheduleUpdate(state)
    }
  }

  private handlePartUpdated(
    state: StreamState,
    properties: { part: Record<string, unknown> }
  ): void {
    const part = properties.part

    if (part.type === 'tool') {
      const toolState = part.state as { status: string; input?: unknown; output?: string; title?: string }
      const callID = (part.callID as string) || (part.tool as string)

      state.toolOutputs.set(callID, {
        tool: part.tool as string,
        status: toolState.status as ToolOutput['status'],
        input: toolState.input,
        output: toolState.output,
        title: toolState.title,
      })

      this.scheduleUpdate(state)
    }
  }

  private handleSessionIdle(state: StreamState): void {
    // If thinking was never closed, append it to the answer
    // so no content is silently dropped
    let finalSuffix = ''
    if (state.isThinkingActive && state.accumulatedThinking && !state.accumulatedText) {
      // Model started thinking but never produced answer — show thinking as answer
      state.accumulatedText = state.accumulatedThinking
      state.accumulatedThinking = ''
      state.isThinkingActive = false
    }
    this.updateSlackMessage(state, finalSuffix, true)
    // Update reaction to success
    this.updateReaction(state, 'white_check_mark').catch(() => {})
    this.cleanup(state.sessionId)
    // Fire and forget - don't await async callback
    void this.onStreamEnd?.(state.sessionId)
  }

  private handleSessionError(
    state: StreamState,
    properties: { error?: { data?: { message?: string } } }
  ): void {
    const errorMessage = properties.error?.data?.message || 'Unknown error'
    this.updateSlackMessage(state, `\n\n_Error: ${errorMessage}_`, true)
    // Update reaction to error
    this.updateReaction(state, 'x').catch(() => {})
    this.cleanup(state.sessionId)
    // Fire and forget - don't await async callback
    void this.onStreamEnd?.(state.sessionId)
  }

  private scheduleUpdate(state: StreamState): void {
    const now = Date.now()
    const elapsed = now - state.lastUpdate

    if (elapsed >= UPDATE_INTERVAL_MS) {
      this.updateSlackMessage(state)
    } else {
      const existing = this.updateTimers.get(state.sessionId)
      if (existing) clearTimeout(existing)

      const timer = setTimeout(() => {
        if (this.streams.has(state.sessionId)) {
          this.updateSlackMessage(state)
        }
        this.updateTimers.delete(state.sessionId)
      }, UPDATE_INTERVAL_MS - elapsed)

      this.updateTimers.set(state.sessionId, timer)
    }
  }

  private async updateSlackMessage(
    state: StreamState,
    suffix: string = '',
    isFinal: boolean = false
  ): Promise<void> {
    state.lastUpdate = Date.now()

    let text = state.accumulatedText

    // During streaming, show thinking indicator if no answer yet
    if (!isFinal && !text && state.accumulatedThinking) {
      text = '🤔 Thinking...'
    }

    // Calculate max length accounting for suffix and cursor
    const truncationSuffix = '\n\n... (truncated)'
    const maxTextLength = MAX_MESSAGE_LENGTH - truncationSuffix.length - (isFinal ? 0 : 1) - suffix.length

    if (text.length > maxTextLength) {
      text = text.slice(0, maxTextLength) + truncationSuffix
    }

    // Add tool progress during streaming
    if (!isFinal && state.toolOutputs.size > 0) {
      const running = Array.from(state.toolOutputs.values()).filter(t => t.status === 'running')
      const completed = Array.from(state.toolOutputs.values()).filter(t => t.status === 'completed')

      if (running.length > 0 || completed.length > 0) {
        const toolLines: string[] = []
        for (const t of state.toolOutputs.values()) {
          const icon = t.status === 'completed' ? '✅' : t.status === 'running' ? '🔧' : '⏳'
          const label = t.title || t.tool
          toolLines.push(`${icon} ${label}`)
        }
        text += '\n\n' + toolLines.join('\n')
      }
    }

    // Add tool summary on completion
    if (isFinal && state.toolOutputs.size > 0) {
      const summary = this.formatToolSummary(state.toolOutputs)
      if (summary) text += '\n\n' + summary
    }

    if (!isFinal && text && !text.includes('🤔 Thinking...')) {
      text += '\u258C' // cursor
    }

    text += suffix

    try {
      await this.slack.chat.update({
        channel: state.channelId,
        ts: state.messageTs,
        text: text || 'Processing...',
      })
    } catch (error) {
      console.error('Failed to update Slack message:', error)
    }
  }

  private async updateReaction(state: StreamState, emoji: string): Promise<void> {
    try {
      // Remove typing reaction first
      await this.slack.reactions.remove({
        channel: state.originalChannelId,
        timestamp: state.originalMessageTs,
        name: 'typing',
      }).catch(() => {}) // Ignore if not present

      // Add completion reaction
      await this.slack.reactions.add({
        channel: state.originalChannelId,
        timestamp: state.originalMessageTs,
        name: emoji,
      })
    } catch (error) {
      console.error('Failed to update reaction:', error)
    }
  }

  private formatToolSummary(tools: Map<string, ToolOutput>): string {
    const completed = Array.from(tools.values()).filter(t => t.status === 'completed')
    if (completed.length === 0) return ''

    const lines = completed.map(t => `✅ ${t.title || t.tool}`)
    return `*Tools used (${completed.length}):*\n${lines.join('\n')}`
  }

  stopStream(sessionId: string): void {
    this.cleanup(sessionId)
  }

  private cleanup(sessionId: string): void {
    // Unregister from event bus
    const handler = this.eventHandlers.get(sessionId)
    if (handler) {
      this.opencode.offSessionEvent(sessionId, handler)
      this.eventHandlers.delete(sessionId)
    }

    // Clear timer
    const timer = this.updateTimers.get(sessionId)
    if (timer) {
      clearTimeout(timer)
      this.updateTimers.delete(sessionId)
    }

    // Remove stream state
    this.streams.delete(sessionId)
  }
}
