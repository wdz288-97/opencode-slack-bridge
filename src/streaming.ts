import type { WebClient } from '@slack/web-api'
import type { OpenCodeClient } from './opencode.js'

// Debug logging helper
const DEBUG = process.env.DEBUG === 'true'
function debugLog(sessionId: string, ...args: unknown[]): void {
  if (DEBUG) {
    console.log(`[${new Date().toISOString()}] [${sessionId.slice(0,8)}]`, ...args)
  }
}

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
  reasoningPartIds: Set<string>  // Track reasoning part IDs to filter at source
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
      reasoningPartIds: new Set(),
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

    debugLog(sessionId, 'EVENT:', eventType, props ? Object.keys(props) : '')

    switch (eventType) {
      case 'message.part.delta':
        this.handleDelta(state, props as { partID?: string; field: string; delta: string })
        break

      case 'message.part.updated':
        this.handlePartUpdated(state, props as { part: Record<string, unknown> })
        break

      case 'session.status':
        debugLog(sessionId, 'SESSION STATUS:', props)
        break

      case 'step-start':
        debugLog(sessionId, 'STEP START:', props)
        break

      case 'step-finish':
        debugLog(sessionId, 'STEP FINISH:', props)
        break

      case 'tool-start':
        debugLog(sessionId, 'TOOL START:', props)
        break

      case 'tool-call':
        debugLog(sessionId, 'TOOL CALL:', props)
        break

      case 'session.idle':
        debugLog(sessionId, 'SESSION IDLE - completed')
        this.handleSessionIdle(state)
        break

      case 'session.error':
        debugLog(sessionId, 'SESSION ERROR:', props)
        this.handleSessionError(state, props as { error?: { data?: { message?: string } } })
        break

      case 'session.busy':
        debugLog(sessionId, 'SESSION BUSY')
        break
    }
  }

  private handleDelta(
    state: StreamState,
    properties: { partID?: string; field: string; delta: string }
  ): void {
    // Filter out deltas from reasoning parts at the source
    if (properties.partID && state.reasoningPartIds.has(properties.partID)) {
      return // Skip reasoning deltas entirely
    }

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
    const partId = part.id as string
    const partType = part.type as string

    // Track reasoning part IDs to filter them at the source
    if (partType === 'reasoning') {
      state.reasoningPartIds.add(partId)
    }

    if (partType === 'tool') {
      const toolState = part.state as { status: string; input?: unknown; output?: string; title?: string }
      const callID = (part.callID as string) || (part.tool as string)

      debugLog(state.sessionId, 'TOOL:', part.tool, 'state:', toolState.status)

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
    // Discard thinking content - never show it in output
    // Just clear thinking and use accumulatedText as final answer
    let finalSuffix = ''
    if (state.isThinkingActive && state.accumulatedThinking && !state.accumulatedText) {
      // Model thought but never produced answer - show nothing or minimal
      state.accumulatedThinking = ''
      state.isThinkingActive = false
      // Don't show thinking as answer - just leave empty or a brief message
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

    // Remove thinking tags from final output
    // Also handle unclosed tags and edge cases
    text = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    text = text.replace(/<antThinking>[\s\S]*?<\/antThinking>/gi, '')
    // Remove orphaned thinking start tags (unclosed)
    text = text.replace(/<thinking>/gi, '')
    text = text.replace(/<antThinking>/gi, '')
    // Remove orphaned thinking end tags (no opening)
    text = text.replace(/<\/thinking>/gi, '')
    text = text.replace(/<\/antThinking>/gi, '')

    // Filter out thinking/reasoning patterns - model outputs this without tags
    // These patterns match common reasoning phrases the model outputs

    // 1. Tool/capability explanation patterns (most common for "Looking at my available tools..." type)
    const toolPatterns = [
      // Looking at my available tools / Checking my available tools
      /(?:Looking at|Checking|Scanning|Reviewing) (?:my )?available tools[,.]?\s*/gi,
      /(?:I have|I do have|I can see|I can use|I have access to) (?:access to )?(?:the )?(?:gws|Google Workspace|google workspace) (?:tool|CLI|command)?s?(?: available)?[.,:;\s]*/gi,
      /(?:I don't have|I cannot|I do not have|I can't access) (?:access to |the )?(?:gws|Google Workspace) (?:tool|CLI)?[.,:\s]*/gi,
      /(?:The )?(?:gws|GWS|Google Workspace) (?:tool|CLI|command)(?: is|'?s)? (?:not |un)?available[.,:\s]*/gi,
      /I (?:can|cannot|don't|do not|have|need|want|will|would|should)(?: not|'t)? .*(?:tool|available|access|see|have access)/gi,
      /(?:Looking at|I can|I do have|I see|I don't see|I need to check|I should verify|I will check|Let me provide|I can provide|I will provide|I want to|Maybe I|Let me know if|I can help|I need more|I should have)/gim,
    ]

    // 2. Standard reasoning phrases
    const thinkingPatterns = [
      /^(Let me think|I'll think|Consider|Let me consider|I'll analyze|Analyzing|Thinking|Hmm|Uhh|Well,|Let me look at|Let me check|Based on|I'll need|First, let me|Giving|Providing|Sure,|Of course,|Certainly,|I can|I don't have|I cannot|I need to|I should|I'd be|I would be|I will|Sure thing|Absolutely|Here is|Here's)/i,
      /^(Wait,|Wait -|Hold on,|One moment,|Actually,|Now,|So,|Then,|Next,|Finally,|Also,|Additionally,|Moreover,|Furthermore,)/im,
      /^(I should (?:note|mention|add| clarify|explain|point out|confirm|verify|check|add)|Let me (?:re-?read|clarify|explain|add|verify|check))/im,
    ]

    // Apply tool patterns first (most specific)
    for (const pattern of toolPatterns) {
      text = text.replace(pattern, '')
    }

    // Apply thinking patterns
    for (const pattern of thinkingPatterns) {
      text = text.replace(pattern, '')
    }

    // Remove lines that are entirely thinking-like
    const thinkingLines = [
      /Looking at my available tools[,\s]*(?:I|we)? .*/gim,
      /(?:The )?(?:gws|GWS|Google Workspace) (?:tool|CLI|command)(?: is|'?s)? (?:not available|unavailable)/gim,
      /I (?:do not|don't) have (?:access to|a) .* tool/gim,
    ]
    for (const linePattern of thinkingLines) {
      text = text.replace(linePattern, '')
    }

    // Clean up empty lines and whitespace
    text = text.replace(/\n\s*\n/g, '\n')
    text = text.replace(/^\s+/gm, '')  // Remove leading whitespace on each line

    // Fix markdown-style formatting for Slack:
    // - Bold: **text** → *text* (most common issue)
    // - Strikethrough: ~~text~~ → ~text~
    text = text.replace(/\*\*/g, '*')
    text = text.replace(/~~/g, '~')

    // Note: italic conversion (*text* → _text_) is risky since * is also used for bold
    // and bullet points. Skipping for safety.

    // During streaming, show thinking indicator if no answer yet
    if (!isFinal && !text && state.accumulatedThinking) {
      text = ':typing: Typing...'
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

    // Only add cursor when no tool outputs (tools show their own icons)
    if (!isFinal && text && !text.includes(':typing: Typing...') && state.toolOutputs.size === 0) {
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
