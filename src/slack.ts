import { App } from '@slack/bolt'
import { OpenCodeClient } from './opencode.js'
import { SessionManager } from './sessions.js'
import { StreamManager } from './streaming.js'
import { MessageQueue } from './queue.js'

export interface SlackBridgeConfig {
  appToken: string
  botToken: string
  opencodeUrl: string
  opencodeAgent: string
  allowedUsers?: string[]
  allowedChannels?: string[]
}

export class SlackBridge {
  private app: App
  private opencode: OpenCodeClient
  private sessions: SessionManager
  private streamManager: StreamManager
  private queue: MessageQueue
  private allowedUsers: Set<string>
  private allowedChannels: Set<string>
  private opencodeAgent: string

  constructor(config: SlackBridgeConfig) {
    this.app = new App({
      token: config.botToken,
      appToken: config.appToken,
      socketMode: true,
    })

    this.opencode = new OpenCodeClient(config.opencodeUrl)
    this.sessions = new SessionManager()
    this.queue = new MessageQueue()
    this.allowedUsers = new Set(config.allowedUsers || [])
    this.allowedChannels = new Set(config.allowedChannels || [])
    this.opencodeAgent = config.opencodeAgent

    // StreamManager calls onStreamEnd when session finishes
    this.streamManager = new StreamManager(
      this.app.client,
      this.opencode,
      (sessionId) => this.onStreamEnd(sessionId)
    )

    this.setupHandlers()
    this.setupCommands()
  }

  // Called when a stream ends (idle or error)
  private async onStreamEnd(sessionId: string): Promise<void> {
    // Find the session key for this session
    for (const sessionKey of this.sessions.listKeys()) {
      const sid = this.sessions.get(sessionKey)
      if (sid === sessionId) {
        this.queue.setProcessing(sessionKey, false)
        // Drain queued messages
        await this.drainQueue(sessionKey)
        break
      }
    }
  }

  // Process queued messages after session becomes idle
  private async drainQueue(sessionKey: string): Promise<void> {
    const next = this.queue.dequeue(sessionKey)
    if (!next) {
      console.log(`[drainQueue] No queued message for ${sessionKey}`)
      return
    }

    const sessionId = this.sessions.get(sessionKey)
    if (!sessionId) {
      console.log(`[drainQueue] No session found for ${sessionKey}`)
      return
    }

    try {
      this.queue.setProcessing(sessionKey, true)
      console.log(`[drainQueue] Processing queued message: "${next.text.slice(0, 50)}..."`)

      const initialResponse = await this.app.client.chat.postMessage({
        channel: next.channelId,
        text: 'Processing queued message...',
        thread_ts: next.threadTs || undefined,
      })

      if (!initialResponse?.ts) {
        console.log(`[drainQueue] Failed to send initial response`)
        this.queue.setProcessing(sessionKey, false)
        return
      }

      console.log(`[drainQueue] Starting stream, sessionId: ${sessionId}`)
      await this.streamManager.startStream(sessionKey, initialResponse.ts, sessionId)
      console.log(`[drainQueue] Sending prompt to OpenCode...`)
      await this.opencode.sendPrompt(sessionId, next.text, this.opencodeAgent)
      console.log(`[drainQueue] Prompt sent, waiting for response...`)
    } catch (error) {
      console.error('Error draining queue:', error)
      this.queue.setProcessing(sessionKey, false)
      await this.app.client.chat.postMessage({
        channel: next.channelId,
        text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        thread_ts: next.threadTs || undefined,
      })
    }
  }

  // Access control check
  private isAuthorized(userId?: string, channelId?: string): boolean {
    if (this.allowedUsers.size > 0 && userId && !this.allowedUsers.has(userId)) {
      return false
    }
    if (this.allowedChannels.size > 0 && channelId && !this.allowedChannels.has(channelId)) {
      return false
    }
    return true
  }

  // Input validation
  private validateInput(text: string): { valid: boolean; error?: string } {
    const MAX_LENGTH = 10000
    if (text.length > MAX_LENGTH) {
      return { valid: false, error: `Message too long (${text.length} chars). Max: ${MAX_LENGTH}` }
    }
    return { valid: true }
  }

  // File size validation
  private validateFile(file: { size?: number | null; name?: string | null }): { valid: boolean; error?: string } {
    const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
    if (file.size && file.size > MAX_FILE_SIZE) {
      return { valid: false, error: `File "${file.name || 'unknown'}" too large (${Math.round(file.size / 1024 / 1024)}MB). Max: 10MB` }
    }
    return { valid: true }
  }

  // Get session key (channel or channel:thread)
  private getSessionKey(channelId: string, threadTs?: string): string {
    return threadTs ? `${channelId}:${threadTs}` : channelId
  }

  private setupHandlers() {
    // Single message handler for both text and files
    this.app.message(async ({ message, say, client }) => {
      if (message.subtype === 'bot_message') return
      if (!('text' in message) && !('files' in message)) return

      const channelId = message.channel
      const userId = 'user' in message ? message.user : undefined
      const text = 'text' in message ? (message.text || '') : ''
      const threadTs = 'thread_ts' in message ? message.thread_ts : undefined
      const files = 'files' in message ? message.files : undefined
      const sessionKey = this.getSessionKey(channelId, threadTs)

      console.log(`[SLACK] Message received from ${userId} in ${channelId}${threadTs ? ':'+threadTs : ''}`)

      // Access control
      if (!this.isAuthorized(userId, channelId)) {
        return
      }

      // Add typing reaction to acknowledge message received
      const userMessageTs = 'ts' in message ? message.ts : undefined
      if (userMessageTs) {
        await this.addReaction(channelId, userMessageTs, 'typing')
      }

      // Handle .queue suffix
      if (text.endsWith('. queue')) {
        const queueText = text.slice(0, -7).trim()
        if (queueText && userId) {
          // Validate before queuing
          const validation = this.validateInput(queueText)
          if (!validation.valid) {
            await say({
              text: validation.error || 'Invalid input',
              thread_ts: threadTs || undefined,
            })
            return
          }
          const queuedId = this.queue.enqueue(sessionKey, { channelId, userId, text: queueText, threadTs })
          if (queuedId === null) {
            await say({
              text: 'Queue is full. Please try again later.',
              thread_ts: threadTs || undefined,
            })
            return
          }
          await say({
            text: `Queued message (${this.queue.size(sessionKey)} in queue)`,
            thread_ts: threadTs || undefined,
          })
          console.log(`[SLACK] Queued message (${this.queue.size(sessionKey)} in queue)`)
        }
        return
      }

      // Input validation (text only)
      if (text) {
        const validation = this.validateInput(text)
        if (!validation.valid) {
          await say({
            text: validation.error || 'Invalid input',
            thread_ts: threadTs || undefined,
          })
          return
        }
      }

      // Check if session is busy
      let sessionId = this.sessions.get(sessionKey)
      if (sessionId && this.queue.isProcessing(sessionKey)) {
        if (userId) {
          const queueText = text || (files ? '[file attachment]' : '')
          const queuedId = this.queue.enqueue(sessionKey, { channelId, userId, text: queueText, threadTs })
          if (queuedId === null) {
            await say({
              text: 'Queue is full. Please try again later.',
              thread_ts: threadTs || undefined,
            })
          } else {
            await say({
              text: `Session is busy. Queued (${this.queue.size(sessionKey)} in queue)`,
              thread_ts: threadTs || undefined,
            })
          }
        }
        return
      }

      try {
        // Get or create session
        if (!sessionId) {
          const session = await this.opencode.createSession()
          sessionId = session.id
          this.sessions.set(sessionKey, sessionId)
          console.log(`[SESSION] ${sessionKey} -> ${sessionId}`)
          console.log(`Created session ${sessionId} for ${sessionKey}`)
        }

        // Mark as processing
        this.queue.setProcessing(sessionKey, true)

        // Process files if present
        let promptText = text
        if (files && files.length > 0) {
          const fileContents: string[] = []
          for (const file of files) {
            // Validate file size first
            const fileValidation = this.validateFile(file)
            if (!fileValidation.valid) {
              this.queue.setProcessing(sessionKey, false)
              await this.updateReaction(channelId, userMessageTs, 'typing', 'x')
              await say({
                text: fileValidation.error || 'Invalid file',
                thread_ts: threadTs || undefined,
              })
              return
            }
            if (file.url_private) {
              const response = await client.files.info({ file: file.id })
              const fileContent = (response.file as any)?.content
              if (fileContent) {
                fileContents.push(`File: ${file.name}\n${fileContent}`)
              }
            }
          }
          if (fileContents.length > 0) {
            promptText = text
              ? `${text}\n\nAttached files:\n${fileContents.join('\n\n---\n\n')}`
              : `Attached files:\n${fileContents.join('\n\n---\n\n')}`
          }
        }

        if (!promptText) {
          this.queue.setProcessing(sessionKey, false)
          return
        }

        // Send initial response in thread
        const initialResponse = await say({
          text: ':typing: Typing...',
          thread_ts: threadTs || userMessageTs || undefined,
        })

        if (!initialResponse?.ts) {
          console.error('Failed to send initial response')
          this.queue.setProcessing(sessionKey, false)
          await this.updateReaction(channelId, userMessageTs, 'typing', 'x')
          return
        }

        // Start streaming (pass original message info for reactions)
        await this.streamManager.startStream(
          channelId,
          initialResponse.ts,
          sessionId,
          channelId,
          userMessageTs || initialResponse.ts
        )

        // Send prompt
        console.log(`[OPENCODE] Sending prompt: "${promptText.slice(0, 60)}${promptText.length > 60 ? '...' : ''}"`)
        await this.opencode.sendPrompt(sessionId, promptText, this.opencodeAgent)

      } catch (error) {
        console.error('Error processing message:', error)
        this.queue.setProcessing(sessionKey, false)
        await this.updateReaction(channelId, userMessageTs, 'typing', 'x')
        await say({
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          thread_ts: threadTs || undefined,
        })
      }
    })
  }

  // Add reaction to a message
  private async addReaction(channelId: string, ts: string, emoji: string): Promise<void> {
    try {
      await this.app.client.reactions.add({
        channel: channelId,
        timestamp: ts,
        name: emoji,
      })
    } catch (error) {
      // Ignore if reaction already exists or message not found
    }
  }

  // Replace one reaction with another
  private async updateReaction(channelId: string, ts: string | undefined, from: string, to: string): Promise<void> {
    if (!ts) return
    try {
      await this.app.client.reactions.remove({
        channel: channelId,
        timestamp: ts,
        name: from,
      }).catch(() => {})
      await this.app.client.reactions.add({
        channel: channelId,
        timestamp: ts,
        name: to,
      })
    } catch (error) {
      // Ignore errors
    }
  }

  private setupCommands() {
    // /abort - Stop current session
    this.app.command('/abort', async ({ command, ack, respond }) => {
      await ack()

      if (!this.isAuthorized(command.user_id, command.channel_id)) {
        await respond('Not authorized')
        return
      }

      const channelId = command.channel_id
      const threadTs = command.thread_ts || undefined
      const sessionKey = this.getSessionKey(channelId, threadTs)
      const sessionId = this.sessions.get(sessionKey) || this.sessions.get(channelId)

      if (!sessionId) {
        await respond('No active session in this channel')
        return
      }

      try {
        await this.opencode.abortSession(sessionId)
        this.streamManager.stopStream(sessionId)
        // Clear both sessionKey and channelId queue states
        this.queue.setProcessing(sessionKey, false)
        this.queue.setProcessing(channelId, false)
        this.queue.clear(sessionKey)
        this.queue.clear(channelId)
        await respond('Session aborted')
      } catch (error) {
        await respond(`Failed to abort: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    })

    // /resume - Resume a previous session
    this.app.command('/resume', async ({ command, ack, respond }) => {
      await ack()

      if (!this.isAuthorized(command.user_id, command.channel_id)) {
        await respond('Not authorized')
        return
      }

      const channelId = command.channel_id
      const threadTs = command.thread_ts || undefined
      const sessionKey = this.getSessionKey(channelId, threadTs)
      const args = command.text?.trim()

      try {
        const sessions = await this.opencode.listSessions()

        if (sessions.length === 0) {
          await respond('No sessions found. Send a message to start a new one.')
          return
        }

        // If user provided a number, select that session
        if (args) {
          const index = parseInt(args, 10) - 1
          if (isNaN(index) || index < 0 || index >= Math.min(sessions.length, 10)) {
            await respond(`Invalid selection. Use a number between 1 and ${Math.min(sessions.length, 10)}`)
            return
          }

          const selected = sessions[index]
          this.sessions.set(sessionKey, selected.id)
          this.queue.setProcessing(sessionKey, false)
          await respond(`Resumed session: ${selected.title || 'Untitled'} (${selected.id.slice(0, 8)}...)`)
          return
        }

        // No argument - show session list
        const sessionList = sessions.slice(0, 10).map((s, i) => {
          const title = s.title || 'Untitled'
          return `${i + 1}. ${title} (${s.id.slice(0, 8)}...)`
        }).join('\n')

        await respond(`Recent sessions:\n${sessionList}\n\nUse \`/resume <number>\` to select a session (e.g., \`/resume 1\`)`)
      } catch (error) {
        await respond(`Failed to list sessions: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    })

    // /queue - View or clear message queue
    this.app.command('/queue', async ({ command, ack, respond }) => {
      await ack()

      const channelId = command.channel_id
      const threadTs = command.thread_ts || undefined
      const sessionKey = this.getSessionKey(channelId, threadTs)
      const args = command.text?.trim().toLowerCase()

      if (args === 'clear') {
        const count = this.queue.clear(sessionKey)
        await respond(`Cleared ${count} queued messages`)
        return
      }

      const size = this.queue.size(sessionKey)
      const isProcessing = this.queue.isProcessing(sessionKey)

      if (size === 0) {
        await respond(`Queue is empty. Session is ${isProcessing ? 'busy' : 'idle'}.`)
        return
      }

      const messages = this.queue.getAll(sessionKey)
      const list = messages.map((m, i) => `${i + 1}. ${m.text.slice(0, 50)}${m.text.length > 50 ? '...' : ''}`).join('\n')
      await respond(`${size} messages queued (session is ${isProcessing ? 'busy' : 'idle'}):\n${list}\n\nUse /queue clear to empty the queue.`)
    })

    // /sessions - List current channel's session
    this.app.command('/sessions', async ({ command, ack, respond }) => {
      await ack()

      const channelId = command.channel_id
      const threadTs = command.thread_ts || undefined
      const sessionKey = this.getSessionKey(channelId, threadTs)
      const sessionId = this.sessions.get(sessionKey) || this.sessions.get(channelId)

      if (!sessionId) {
        await respond('No session in this channel. Send a message to start one.')
        return
      }

      const isProcessing = this.queue.isProcessing(sessionKey)
      const queueSize = this.queue.size(sessionKey)

      await respond([
        `Session: ${sessionId.slice(0, 12)}...`,
        `Status: ${isProcessing ? 'Busy' : 'Idle'}`,
        queueSize > 0 ? `Queue: ${queueSize} messages` : '',
      ].filter(Boolean).join('\n'))
    })

    // /help - Show available commands
    this.app.command('/help', async ({ ack, respond }) => {
      await ack()

      await respond([
        '*OpenCode Slack Bridge Commands*',
        '',
        '*/abort* - Stop the current session',
        '*/resume* - Resume a previous session',
        '*/queue* [clear] - View or clear message queue',
        '*/sessions* - Show current session info',
        '*/help* - Show this help message',
        '',
        '*Tips:*',
        '- End a message with `. queue` to queue it while busy',
        '- Sessions persist across restarts',
      ].join('\n'))
    })
  }

async start() {
    // index.ts already detected the port, just verify
    try {
      const health: any = await this.opencode.checkHealth()
      console.log(`✓ OpenCode ${health.version} connected`)
    } catch {
      console.warn('⚠️ OpenCode not reachable')
    }

    await this.app.start()
    console.log('⚡️ OpenCode Slack Bridge is running!')
    console.log('Press Ctrl+C to stop')
  }

  async stop() {
    console.log('Shutting down...')

    // Abort all active sessions
    for (const { sessionId } of this.sessions.list()) {
      try {
        await this.opencode.abortSession(sessionId)
        console.log(`Aborted session ${sessionId.slice(0, 8)}...`)
      } catch (e) {
        // Session may already be idle, ignore
      }
    }

    this.sessions.close()
    await this.app.stop()
  }
}
