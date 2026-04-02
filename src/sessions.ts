import { SessionDatabase } from './database.js'

export class SessionManager {
  private db: SessionDatabase

  constructor(dbPath?: string) {
    this.db = new SessionDatabase(dbPath)
  }

  get(channelId: string): string | undefined {
    const row = this.db.getSession(channelId)
    return row?.session_id
  }

  set(channelId: string, sessionId: string): void {
    this.db.setSession(channelId, sessionId)
  }

  delete(channelId: string): boolean {
    const existed = this.get(channelId) !== undefined
    this.db.deleteSession(channelId)
    return existed
  }

  list(): Array<{ channelId: string; sessionId: string }> {
    return this.db.listSessions().map(row => ({
      channelId: row.channel_id,
      sessionId: row.session_id,
    }))
  }

  // Directory mapping for multi-project support
  getDirectory(channelId: string): string | undefined {
    const row = this.db.getDirectory(channelId)
    return row?.directory
  }

  setDirectory(channelId: string, directory: string): void {
    this.db.setDirectory(channelId, directory)
  }

  close(): void {
    this.db.close()
  }
}
