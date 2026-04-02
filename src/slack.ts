import { App } from '@slack/bolt'
import { OpenCodeClient } from './opencode.js'
import { SessionManager } from './sessions.js'
import { StreamManager } from './streaming.js'

export interface SlackBridgeConfig {
  appToken: string
  botToken: string
  opencodeUrl: string
}

export class SlackBridge {
  private app: App
  private opencode: OpenCodeClient
  private sessions: SessionManager
  private streamManager: StreamManager

  constructor(config: SlackBridgeConfig) {
    this.app = new App({
      token: config.botToken,
      appToken: config.appToken,
      socketMode: true,
    })

    this.opencode = new OpenCodeClient(config.opencodeUrl)
    this.sessions = new SessionManager()
    this.streamManager = new StreamManager(this.app.client, this.opencode)

    this.setupHandlers()
  }

  private setupHandlers() {
    // Handle all messages (DMs, channels, threads)
    this.app.message(async ({ message, say, client }) => {
      // Skip bot messages and messages without text
      if (message.subtype === 'bot_message' || !('text' in message)) {
        return
      }

      const channelId = message.channel
      const userId = 'user' in message ? message.user : undefined
      const text = message.text || ''
      const threadTs = 'thread_ts' in message ? message.thread_ts : undefined

      try {
        // Get or create session for this channel
        let sessionId = this.sessions.get(channelId)
        if (!sessionId) {
          const session = await this.opencode.createSession()
          sessionId = session.id
          this.sessions.set(channelId, sessionId)
          console.log(`Created new session ${sessionId} for channel ${channelId}`)
        }

        // Send initial response
        const initialResponse = await say({
          text: 'Thinking...',
          thread_ts: threadTs || undefined,
        })

        if (!initialResponse?.ts) {
          console.error('Failed to send initial response')
          return
        }

        // Start streaming from OpenCode
        await this.streamManager.startStream(
          channelId,
          initialResponse.ts,
          sessionId
        )

        // Send prompt (async - response comes via SSE)
        await this.opencode.sendPrompt(sessionId, text)

      } catch (error) {
        console.error('Error processing message:', error)
        await say({
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          thread_ts: threadTs || undefined,
        })
      }
    })

    // Handle file attachments
    this.app.message(async ({ message, say, client }) => {
      if (!('files' in message) || !message.files?.length) {
        return
      }

      const channelId = message.channel
      const threadTs = 'thread_ts' in message ? message.thread_ts : undefined

      try {
        let sessionId = this.sessions.get(channelId)
        if (!sessionId) {
          const session = await this.opencode.createSession()
          sessionId = session.id
          this.sessions.set(channelId, sessionId)
        }

        // Download files and include in context
        const fileContents: string[] = []
        for (const file of message.files) {
          if (file.url_private) {
            const response = await client.files.info({ file: file.id })
            const fileContent = (response.file as any)?.content
            if (fileContent) {
              fileContents.push(`File: ${file.name}\n${fileContent}`)
            }
          }
        }

        if (fileContents.length > 0) {
          const prompt = `I've attached ${fileContents.length} file(s):\n\n${fileContents.join('\n\n---\n\n')}`
          
          const initialResponse = await say({
            text: 'Processing files...',
            thread_ts: threadTs || undefined,
          })

          if (!initialResponse?.ts) {
            console.error('Failed to send initial response')
            return
          }

          // Start streaming
          await this.streamManager.startStream(
            channelId,
            initialResponse.ts,
            sessionId
          )

          // Send prompt (async - response comes via SSE)
          await this.opencode.sendPrompt(sessionId, prompt)
        }
      } catch (error) {
        console.error('Error processing files:', error)
        await say({
          text: `Error processing files: ${error instanceof Error ? error.message : 'Unknown error'}`,
          thread_ts: threadTs || undefined,
        })
      }
    })
  }

  async start() {
    await this.app.start()
    console.log('⚡️ OpenCode Slack Bridge is running!')
    console.log('Press Ctrl+C to stop')
  }
}
