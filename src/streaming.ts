import type { WebClient } from '@slack/web-api'
import type { OpenCodeClient } from './opencode.js'

interface StreamState {
  channelId: string
  messageTs: string
  sessionId: string
  accumulatedText: string
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
const MAX_MESSAGE_LENGTH = 3000

export class StreamManager {
  private streams = new Map<string, StreamState>()
  private updateTimers = new Map<string, NodeJS.Timeout>()

  constructor(
    private slack: WebClient,
    private opencode: OpenCodeClient
  ) {}

  async startStream(
    channelId: string,
    messageTs: string,
    sessionId: string
  ): Promise<void> {
    const state: StreamState = {
      channelId,
      messageTs,
      sessionId,
      accumulatedText: '',
      lastUpdate: Date.now(),
      toolOutputs: new Map(),
    }

    this.streams.set(sessionId, state)
    this.listenToEvents(sessionId)
  }

  private async listenToEvents(sessionId: string): Promise<void> {
    const state = this.streams.get(sessionId)
    if (!state) return

    try {
      const events = await this.opencode.subscribeToEvents()

      for await (const event of events) {
        const current = this.streams.get(sessionId)
        if (!current) break

        const evt = event as Record<string, unknown>
        const props = evt.properties as Record<string, unknown> | undefined

        if (props?.sessionID && props.sessionID !== sessionId) {
          continue
        }

        const eventType = evt.type as string

        switch (eventType) {
          case 'message.part.delta':
            this.handleDelta(current, props as { field: string; delta: string })
            break

          case 'message.part.updated':
            this.handlePartUpdated(current, props as { part: Record<string, unknown> })
            break

          case 'session.idle':
            this.handleSessionIdle(current)
            return

          case 'session.error':
            this.handleSessionError(current, props as { error?: { data?: { message?: string } } })
            return
        }
      }
    } catch (error) {
      console.error('SSE listener error:', error)
      const s = this.streams.get(sessionId)
      if (s) {
        await this.updateSlackMessage(s, `\n\n_Error: ${error instanceof Error ? error.message : 'Connection lost'}_`)
      }
    }
  }

  private handleDelta(
    state: StreamState,
    properties: { field: string; delta: string }
  ): void {
    if (properties.field === 'text') {
      state.accumulatedText += properties.delta
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
    this.updateSlackMessage(state, '', true)
    this.cleanup(state.sessionId)
  }

  private handleSessionError(
    state: StreamState,
    properties: { error?: { data?: { message?: string } } }
  ): void {
    const errorMessage = properties.error?.data?.message || 'Unknown error'
    this.updateSlackMessage(state, `\n\n_Error: ${errorMessage}_`, true)
    this.cleanup(state.sessionId)
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
        this.updateSlackMessage(state)
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

    if (text.length > MAX_MESSAGE_LENGTH) {
      text = text.slice(0, MAX_MESSAGE_LENGTH - 20) + '\n... (truncated)'
    }

    if (state.toolOutputs.size > 0 && isFinal) {
      const summary = this.formatToolSummary(state.toolOutputs)
      if (summary) text += '\n\n' + summary
    }

    if (!isFinal && text) {
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

  private formatToolSummary(tools: Map<string, ToolOutput>): string {
    const completed = Array.from(tools.values()).filter(t => t.status === 'completed')
    if (completed.length === 0) return ''

    const lines = completed.map(t => {
      const emoji = t.status === 'completed' ? '\u2705' : t.status === 'error' ? '\u274C' : '\u23F3'
      return `${emoji} ${t.title || t.tool}`
    })

    return '*Tools used:*\n' + lines.join('\n')
  }

  stopStream(sessionId: string): void {
    this.cleanup(sessionId)
  }

  private cleanup(sessionId: string): void {
    this.streams.delete(sessionId)
    const timer = this.updateTimers.get(sessionId)
    if (timer) {
      clearTimeout(timer)
      this.updateTimers.delete(sessionId)
    }
  }
}
