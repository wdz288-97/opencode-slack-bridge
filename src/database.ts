import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { join, dirname } from 'path'

export interface ChannelSession {
  channel_id: string
  session_id: string
  created_at: string
  updated_at: string
}

export interface ChannelDirectory {
  channel_id: string
  directory: string
  created_at: string
}

export class SessionDatabase {
  private db: Database.Database

  constructor(dbPath: string = './data/sessions.db') {
    // Ensure directory exists
    const dir = dirname(dbPath)
    mkdirSync(dir, { recursive: true })

    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL') // Better concurrent read performance
    this.init()
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS channel_sessions (
        channel_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS channel_directories (
        channel_id TEXT PRIMARY KEY,
        directory TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_session_id ON channel_sessions(session_id);
    `)
  }

  // Channel → Session mapping
  getSession(channelId: string): ChannelSession | undefined {
    return this.db
      .prepare('SELECT * FROM channel_sessions WHERE channel_id = ?')
      .get(channelId) as ChannelSession | undefined
  }

  setSession(channelId: string, sessionId: string): void {
    this.db
      .prepare(`
        INSERT INTO channel_sessions (channel_id, session_id, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(channel_id) DO UPDATE SET
          session_id = excluded.session_id,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(channelId, sessionId)
  }

  deleteSession(channelId: string): void {
    this.db
      .prepare('DELETE FROM channel_sessions WHERE channel_id = ?')
      .run(channelId)
  }

  listSessions(): ChannelSession[] {
    return this.db
      .prepare('SELECT * FROM channel_sessions ORDER BY updated_at DESC')
      .all() as ChannelSession[]
  }

  // Channel → Directory mapping (for multi-project support)
  getDirectory(channelId: string): ChannelDirectory | undefined {
    return this.db
      .prepare('SELECT * FROM channel_directories WHERE channel_id = ?')
      .get(channelId) as ChannelDirectory | undefined
  }

  setDirectory(channelId: string, directory: string): void {
    this.db
      .prepare(`
        INSERT INTO channel_directories (channel_id, directory)
        VALUES (?, ?)
        ON CONFLICT(channel_id) DO UPDATE SET
          directory = excluded.directory
      `)
      .run(channelId, directory)
  }

  deleteDirectory(channelId: string): void {
    this.db
      .prepare('DELETE FROM channel_directories WHERE channel_id = ?')
      .run(channelId)
  }

  listDirectories(): ChannelDirectory[] {
    return this.db
      .prepare('SELECT * FROM channel_directories ORDER BY created_at DESC')
      .all() as ChannelDirectory[]
  }

  // Cleanup
  close(): void {
    this.db.close()
  }
}
