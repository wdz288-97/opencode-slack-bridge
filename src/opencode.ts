import { createOpencodeClient } from '@opencode-ai/sdk'
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

export class OpenCodeClient {
  private client: ReturnType<typeof createOpencodeClient>

  constructor(baseUrl: string) {
    this.client = createOpencodeClient({ baseUrl })
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

  async sendPrompt(sessionId: string, prompt: string): Promise<OpenCodeMessage> {
    // Use prompt_async for streaming support
    // The caller should subscribe to events separately
    await this.client.session.prompt({
      path: { id: sessionId },
      body: {
        parts: [{ type: 'text', text: prompt }],
      },
    })

    // Return placeholder - actual response comes via SSE
    return {
      role: 'assistant',
      content: '', // Will be filled by streaming
    }
  }

  async sendPromptSync(sessionId: string, prompt: string): Promise<OpenCodeMessage> {
    // Synchronous version (no streaming)
    const response = await this.client.session.prompt({
      path: { id: sessionId },
      body: {
        parts: [{ type: 'text', text: prompt }],
      },
    })

    if (!response.data) {
      throw new Error('No response from OpenCode')
    }

    const message = response.data.info
    const parts = response.data.parts || []

    // Extract text content from parts
    const textParts = parts
      .filter(p => p.type === 'text')
      .map(p => (p as { text: string }).text)
      .join('\n')

    // Extract tool calls
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

  async subscribeToEvents(): Promise<AsyncIterable<Event>> {
    const response = await this.client.event.subscribe()
    return response.stream as AsyncIterable<Event>
  }

  async listSessions(): Promise<OpenCodeSession[]> {
    const response = await this.client.session.list()
    return (response.data || []).map(s => ({
      id: s.id,
      title: s.title,
    }))
  }

  async abortSession(sessionId: string): Promise<void> {
    await this.client.session.abort({
      path: { id: sessionId }
    })
  }
}
