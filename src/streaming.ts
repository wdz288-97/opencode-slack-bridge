import type { WebClient } from '@slack/web-api'
import type { OpenCodeClient } from './opencode.js'
import { 
  createSlackBlocks, 
  chunkMessage, 
  type SlackBlock,
  looksLikeCode,
  formatCodeBlock 
} from './formatting.js'

// Convert markdown to Slack format (inline helper)
function toSlackMarkdown(text: string): string {
  if (!text) return ''
  
  let result = text
  
  // Code blocks: ```lang\ncode```
  result = result.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => 
    `\n\n\`\`\`${lang}\n${code.trim()}\n\`\`\`\n\n`)
  
  // Bold: **text** → *text*
  result = result.replace(/\*\*([^*]+)\*\*/g, '*$1*')
  
  // Italic: *text* → _text_ (but be careful with _)
  result = result.replace(/(?<!\*)\*(?!\*)([^*]+)(?<!\*)\*(?!\*)/g, '_$1_')
  
  // Strikethrough: ~~text~~ → ~text~
  result = result.replace(/~~([^~]+)~~/g, '-$1-')
  
  // Block quotes: > text → >_ text
  result = result.replace(/^>\s*(.+)$/gm, '>_$1')
  
  // Links: [text](url) → <url|text>
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>')
  
  return result.trim()
}

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
  toolStartTimes: Map<string, number>  // Track when tools started running (for timeout)
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
const TOOL_TIMEOUT_MS = 120000 // 2 minutes timeout for running tools

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
      toolStartTimes: new Map(),
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
        debugLog(sessionId, '📝 DELTA:', props?.field)
        this.handleDelta(state, props as { partID?: string; field: string; delta: string })
        break

      case 'message.part.updated':
        debugLog(sessionId, '🔄 PART UPDATED:', props?.part ? 'yes' : 'no')
        this.handlePartUpdated(state, props as { part: Record<string, unknown> })
        break

      case 'session.status':
        debugLog(sessionId, '📊 SESSION STATUS:', props)
        break

      case 'step-start':
        debugLog(sessionId, '▶ STEP START:', props?.stepID)
        break

      case 'step-finish':
        debugLog(sessionId, '⏹ STEP FINISH:', props?.stepID)
        break

      case 'tool-start':
        debugLog(sessionId, '🔧 TOOL START:', props?.tool || props?.name)
        break

      case 'tool-call':
        debugLog(sessionId, '📞 TOOL CALL:', props?.tool || props?.name)
        break

      case 'tool-result':
        debugLog(sessionId, '✅ TOOL RESULT:', props?.tool || props?.name, props?.status)
        break

      case 'session.idle':
        debugLog(sessionId, '💤 SESSION IDLE - completed!')
        this.handleSessionIdle(state)
        break

      case 'session.error':
        debugLog(sessionId, '❌ SESSION ERROR:', props)
        this.handleSessionError(state, props as { error?: { data?: { message?: string } } })
        break

      case 'session.busy':
        debugLog(sessionId, '⚡️ SESSION BUSY')
        break

      case 'tool-output':
        debugLog(sessionId, '📤 TOOL OUTPUT:', props?.tool || props?.name)
        break

      case 'session.created':
        debugLog(sessionId, '🆕 SESSION CREATED')
        break

      case 'session.updated':
        debugLog(sessionId, '🔁 SESSION UPDATED:', props?.info)
        break

      case 'session.deleted':
        debugLog(sessionId, '🗑 SESSION DELETED')
        break

      case 'session.diff':
        debugLog(sessionId, '📝 SESSION DIFF:', props?.info)
        break

      case 'message.created':
        debugLog(sessionId, '💬 MESSAGE CREATED')
        break

      case 'message.updated':
        debugLog(sessionId, '🔄 MESSAGE UPDATED:', props?.info)
        break

      default:
        debugLog(sessionId, '❓ UNKNOWN EVENT:', eventType, props ? Object.keys(props) : '')
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
      const newStatus = toolState.status as ToolOutput['status']

      debugLog(state.sessionId, 'TOOL:', part.tool, 'state:', newStatus)

      state.toolOutputs.set(callID, {
        tool: part.tool as string,
        status: newStatus,
        input: toolState.input,
        output: toolState.output,
        title: toolState.title,
      })

      // Track tool start time for timeout detection
      if (newStatus === 'running') {
        state.toolStartTimes.set(callID, Date.now())
        // Cancel any pending timeout for this tool (retry case)
      } else if (newStatus === 'completed' || newStatus === 'error') {
        state.toolStartTimes.delete(callID)
      }

      this.scheduleUpdate(state)
    }
  }

  private async handleSessionIdle(state: StreamState): Promise<void> {
    // Discard thinking content - never show it in output
    let finalText = state.accumulatedText
    if (state.isThinkingActive && state.accumulatedThinking && !state.accumulatedText) {
      state.accumulatedThinking = ''
      state.isThinkingActive = false
      finalText = ''
    }

    // Convert to Slack format
    const slackText = toSlackMarkdown(finalText || 'Done.')

    // Check if needs chunking (> 12000 chars per block)
    const needsChunk = slackText.length > 12000

    if (needsChunk) {
      // Split into multiple messages
      const rawChunks = chunkMessage(slackText, 11000)
      
      for (let i = 0; i < rawChunks.length; i++) {
        const blocks: SlackBlock[] = []
        
        // Add chunk
        blocks.push({ type: 'markdown', text: rawChunks[i] })
        
        // Add divider and tool summary on last chunk
        if (i === rawChunks.length - 1 && state.toolOutputs.size > 0) {
          blocks.push({ type: 'divider' })
          const summary = this.formatToolSummary(state.toolOutputs)
          blocks.push({ type: 'section', text: { type: 'mrkdwn', text: summary } })
        }

        const chunkNum = rawChunks.length > 1 ? `[${i + 1}/${rawChunks.length}] ` : ''

        try {
          if (i === 0) {
            await this.slack.chat.update({
              channel: state.channelId,
              ts: state.messageTs,
              text: chunkNum + rawChunks[i].slice(0, 150),
              blocks,
            })
          } else {
            await this.slack.chat.postMessage({
              channel: state.channelId,
              text: chunkNum + rawChunks[i].slice(0, 150),
              thread_ts: state.messageTs,
              blocks,
            })
          }
        } catch (error) {
          console.error('Failed to send chunk:', error)
        }
      }
    } else {
      // Single message with Block Kit
      const blocks: SlackBlock[] = []
      blocks.push({ type: 'markdown', text: slackText })

      if (state.toolOutputs.size > 0) {
        blocks.push({ type: 'divider' })
        const summary = this.formatToolSummary(state.toolOutputs)
        blocks.push({ type: 'section', text: { type: 'mrkdwn', text: summary } })
      }

      await this.slack.chat.update({
        channel: state.channelId,
        ts: state.messageTs,
        text: slackText.slice(0, 150).replace(/\n/g, ' '),
        blocks,
      })
    }

    // Update reaction to success
    this.updateReaction(state, 'white_check_mark').catch(() => {})
    this.cleanup(state.sessionId)
    // Fire and forget - don't await async callback
    void this.onStreamEnd?.(state.sessionId)
  }

  private async handleSessionError(
    state: StreamState,
    properties: { error?: { data?: { message?: string } } }
  ): Promise<void> {
    const errorMessage = properties.error?.data?.message || 'Unknown error'
    
    const blocks: SlackBlock[] = [
      { type: 'section', text: { type: 'mrkdwn', text: `_Error: ${errorMessage}_` } }
    ]

    await this.slack.chat.update({
      channel: state.channelId,
      ts: state.messageTs,
      text: `Error: ${errorMessage}`,
      blocks,
    })
    
    // Update reaction to error
    this.updateReaction(state, 'x').catch(() => {})
    this.cleanup(state.sessionId)
    // Fire and forget - don't await async callback
    void this.onStreamEnd?.(state.sessionId)
  }

  private scheduleUpdate(state: StreamState): void {
    // Check for tool timeouts first
    this.checkToolTimeout(state)

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

  private async checkToolTimeout(state: StreamState): Promise<void> {
    const now = Date.now()
    let timedOutTool: string | null = null
    let timedOutTimestamp: number | null = null

    // Find any tool that has exceeded the timeout
    for (const [callId, startTime] of state.toolStartTimes) {
      const elapsed = now - startTime
      if (elapsed > TOOL_TIMEOUT_MS) {
        timedOutTool = callId
        timedOutTimestamp = startTime
        break
      }
    }

    if (timedOutTool) {
      console.error(`Tool timeout detected: ${timedOutTool} running for ${TOOL_TIMEOUT_MS}ms`)

      // Remove from tracking
      state.toolStartTimes.delete(timedOutTool)

      // Abort the session
      try {
        await this.opencode.abortSession(state.sessionId)
      } catch (error) {
        console.error('Failed to abort session:', error)
      }

      // Notify user in Slack
      const toolName = state.toolOutputs.get(timedOutTool)?.tool || timedOutTool
      const blocks: SlackBlock[] = [
        { type: 'section', text: { type: 'mrkdwn', text: `_Tool timed out after 2 minutes: ${toolName}_` } },
        { type: 'section', text: { type: 'mrkdwn', text: 'Session has been aborted. You can send a new message to start again.' } },
      ]

      try {
        await this.slack.chat.update({
          channel: state.channelId,
          ts: state.messageTs,
          text: `Tool timeout: ${toolName}`,
          blocks,
        })
      } catch (error) {
        console.error('Failed to notify Slack of timeout:', error)
      }

      // Add error reaction
      this.updateReaction(state, 'x').catch(() => {})
      this.cleanup(state.sessionId)
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
    text = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    text = text.replace(/<antThinking>[\s\S]*?<\/antThinking>/gi, '')
    text = text.replace(/<thinking>/gi, '')
    text = text.replace(/<antThinking>/gi, '')
    text = text.replace(/<\/thinking>/gi, '')
    text = text.replace(/<\/antThinking>/gi, '')

    // Clean up empty lines and whitespace
    text = text.replace(/\n\s*\n/g, '\n')
    text = text.replace(/^\s+/gm, '')

    // During streaming, show thinking indicator if no answer yet
    if (!isFinal && !text && state.accumulatedThinking) {
      text = ':typing: Typing...'
    }

    // Build blocks array
    const blocks: SlackBlock[] = []

    // Add tool progress during streaming
    if (!isFinal && state.toolOutputs.size > 0) {
      const toolLines: string[] = []
      for (const t of state.toolOutputs.values()) {
        const icon = t.status === 'completed' ? '✅' : t.status === 'running' ? '🔧' : '⏳'
        const label = t.title || t.tool
        toolLines.push(`${icon} ${label}`)
      }
      if (toolLines.length > 0) {
        blocks.push({ type: 'section', text: { type: 'mrkdwn', text: toolLines.join('\n') } })
      }
    }

    // Convert to Slack format and add as markdown block
    if (text) {
      const slackText = toSlackMarkdown(text)
      blocks.push({ type: 'markdown', text: slackText })
    }

    // Add tool summary on completion
    if (isFinal && state.toolOutputs.size > 0) {
      const summary = this.formatToolSummary(state.toolOutputs)
      if (summary) {
        blocks.push({ type: 'divider' })
        blocks.push({ type: 'section', text: { type: 'mrkdwn', text: summary } })
      }
    }

    // Add cursor during streaming (if no tool outputs showing)
    if (!isFinal && text && !text.includes(':typing: Typing...') && state.toolOutputs.size === 0) {
      // Append cursor to last block - handle both mrkdwn and markdown blocks
      const lastBlock = blocks[blocks.length - 1]
      if (lastBlock && lastBlock.text && typeof lastBlock.text === 'object') {
        lastBlock.text.text += '\u258C'
      }
    }

    // Fallback text (first 150 chars for notifications)
    const fallbackText = text 
      ? text.slice(0, 150).replace(/\n/g, ' ') + (text.length > 150 ? '...' : '')
      : 'Processing...'

    try {
      await this.slack.chat.update({
        channel: state.channelId,
        ts: state.messageTs,
        text: fallbackText,
        blocks: blocks.length > 0 ? blocks : undefined,
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
