export class SessionManager {
  private channelSessions = new Map<string, string>()

  get(channelId: string): string | undefined {
    return this.channelSessions.get(channelId)
  }

  set(channelId: string, sessionId: string): void {
    this.channelSessions.set(channelId, sessionId)
  }

  delete(channelId: string): boolean {
    return this.channelSessions.delete(channelId)
  }

  list(): Array<{ channelId: string; sessionId: string }> {
    return Array.from(this.channelSessions.entries()).map(([channelId, sessionId]) => ({
      channelId,
      sessionId,
    }))
  }
}
