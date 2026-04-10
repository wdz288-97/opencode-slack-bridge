import { createOpencodeClient } from '@opencode-ai/sdk'
import { EventEmitter } from 'events'
import type { Event } from '@opencode-ai/sdk'

export interface OpenCodeSession {
  id: string
  title?: string
}

export interface OpenCodeMessage {
  role: 'user' | 'assistant'
  content: string
  parts?: MessagePart[]
}

export interface MessagePart {
  type: string
  text?: string
  tool?: string
  input?: unknown
  output?: string
  status?: string
}

type EventHandler = (event: Record<string, unknown>) => void

export class OpenCodeClient {
  private client: ReturnType<typeof createOpencodeClient>
  private eventBus = new EventEmitter()
  private subscribed = false
  private subscribePromise: Promise<void> | null = null
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
    this.client = createOpencodeClient({ baseUrl })
  }

  async checkHealth(): Promise<{ healthy: boolean; version: string }> {
    const url = `${this.baseUrl}/global/health`
    console.log(`[checkHealth] ${url}`)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    try {
      const response = await fetch(url, { signal: controller.signal })
      const data = await response.json() as { healthy?: boolean; version?: string }
      return {
        healthy: data.healthy === true,
        version: data.version || 'unknown',
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  async createSession(): Promise<OpenCodeSession> {
    const response = await this.client.session.create({
      body: { title: 'Slack Session' }
    })
    
    if (!response.data) {
      throw new Error('Failed to create session')
    }

    return {
      id: response.data.id,
      title: response.data.title,
    }
  }

  async sendPrompt(sessionId: string, prompt: string, agent?: string): Promise<void> {
    await this.client.session.prompt({
      path: { id: sessionId },
      body: {
        parts: [{ type: 'text', text: prompt }],
        ...(agent ? { agent } : {}),
      },
    })
  }

  async sendPromptSync(sessionId: string, prompt: string, agent?: string): Promise<OpenCodeMessage> {
    const response = await this.client.session.prompt({
      path: { id: sessionId },
      body: {
        parts: [{ type: 'text', text: prompt }],
        ...(agent ? { agent } : {}),
      },
    })

    if (!response.data) {
      throw new Error('No response from OpenCode')
    }

    const parts = response.data.parts || []

    const textParts = parts
      .filter(p => p.type === 'text')
      .map(p => (p as { text: string }).text)
      .join('\n')

    const toolParts = parts
      .filter(p => p.type === 'tool')
      .map(p => ({
        type: 'tool' as const,
        tool: (p as { name?: string }).name || 'unknown',
        input: (p as { input?: unknown }).input,
        output: (p as { output?: string }).output,
        status: (p as { status?: string }).status,
      }))

    return {
      role: 'assistant',
      content: textParts,
      parts: toolParts.length > 0 ? toolParts : undefined,
    }
  }

  // Single global SSE subscriber with promise-based lock
  private async ensureSubscribed(): Promise<void> {
    if (this.subscribed) return

    // Promise-based singleton: multiple callers share the same subscription
    if (!this.subscribePromise) {
      this.subscribePromise = this.doSubscribe().catch((error) => {
        // Reset on any error to allow re-subscription
        this.subscribed = false
        this.subscribePromise = null
        throw error
      })
    }

    return this.subscribePromise
  }

  private async doSubscribe(): Promise<void> {
    const response = await this.client.event.subscribe()
    const stream = response.stream as AsyncIterable<Event>
    this.subscribed = true

    ;(async () => {
      try {
        for await (const event of stream) {
          const evt = event as Record<string, unknown>
          const props = evt.properties as Record<string, unknown> | undefined
          const sessionId = props?.sessionID as string | undefined

          // Emit to session-specific listeners
          if (sessionId) {
            this.eventBus.emit(`session:${sessionId}`, evt)
          }

          // Also emit to global listeners
          this.eventBus.emit('all', evt)
        }
      } catch (error) {
        console.error('SSE stream error:', error)
        this.subscribed = false
        this.subscribePromise = null  // Allow re-subscription
      }
    })()
  }

  // Register handler for session events
  async onSessionEvent(sessionId: string, handler: EventHandler): Promise<void> {
    await this.ensureSubscribed()
    this.eventBus.on(`session:${sessionId}`, handler)
  }

  // Unregister handler
  offSessionEvent(sessionId: string, handler: EventHandler): void {
    this.eventBus.off(`session:${sessionId}`, handler)
  }

  // Remove all handlers for a session
  removeAllSessionListeners(sessionId: string): void {
    this.eventBus.removeAllListeners(`session:${sessionId}`)
  }

  async listSessions(): Promise<OpenCodeSession[]> {
    const response = await this.client.session.list()
    return (response.data || []).map(s => ({
      id: s.id,
      title: s.title,
    }))
  }

  async getSession(sessionId: string): Promise<OpenCodeSession | null> {
    const response = await this.client.session.get({
      path: { id: sessionId }
    })
    if (!response.data) return null
    return {
      id: response.data.id,
      title: response.data.title,
    }
  }

  async abortSession(sessionId: string): Promise<void> {
    await this.client.session.abort({
      path: { id: sessionId }
    })
  }

  async getSessionStatus(sessionId: string): Promise<string> {
    try {
      const response = await (this.client.session as any).status({
        path: { id: sessionId }
      })
      return (response.data as { type?: string })?.type || 'unknown'
    } catch (error) {
      console.error(`Failed to get session status for ${sessionId}:`, error)
      return 'unknown'
    }
  }
}
