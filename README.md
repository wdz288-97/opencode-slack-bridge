# OpenCode Slack Bridge

Chat with your OpenCode coding agent directly from Slack.

## Architecture

```
┌─────────────────┐         ┌──────────────────────────────────────┐
│     Slack        │         │  Bridge Service                      │
│                  │         │  (@slack/bolt + @opencode-ai/sdk)    │
│  You send msg    │─────────▶  1. Receive message                  │
│  in DM/channel   │         │  2. Map channel → session            │
│                  │◀────────│  3. POST /session/:id/message        │
│  Bot responds    │         │  4. Format response for Slack        │
└─────────────────┘         └──────────────┬───────────────────────┘
                                           │
                                           ▼
                                   ┌──────────────────┐
                                   │ OpenCode Server   │
                                   │ localhost:4096    │
                                   └──────────────────┘
```

## Features

- **Text in/out** — Send messages, get AI responses
- **Streaming** — Real-time token-by-token updates
- **File attachments** — Attach code files, images, docs
- **Tool output display** — See what tools OpenCode used
- **Session persistence** — SQLite-backed, survives restarts
- **Thread support** — Bot responds in threads
- **Block Kit formatting** — Uses Slack markdown blocks for better rendering
- **Auto-chunking** — Splits long messages (>11,000 chars) into threaded messages
- **Thinking filter** — Event-level filtering removes model reasoning from output

## Prerequisites

1. **Node.js** 18+ installed
2. **OpenCode** installed
3. **Slack workspace** where you can install apps

## Quick Start

```bash
# Clone
git clone https://github.com/wdz288-97/opencode-slack-bridge.git
cd opencode-slack-bridge

# Install
npm install

# Create .env from example
cp .env.example .env

# Follow the Slack app setup guide
open SETUP.md

# Fill in your tokens in .env

# Verify setup
npm run setup

# Start everything using the launcher (auto-detects OpenCode port)
run.bat

# OR start manually:
# Terminal 1: OpenCode server (port auto-detected)
opencode serve

# Terminal 2: Bridge
npm run dev
```

## Setup

See **[SETUP.md](SETUP.md)** for detailed Slack app creation steps.

## Windows Launcher (run.bat)

On Windows, use `run.bat` to automatically:
1. Find existing OpenCode server on common ports (4096, 5000, 6000, 61108, etc.)
2. Start OpenCode if not running (auto-detects the port it uses)
3. Update `.env` with the correct port
4. Start the bridge

```bash
run.bat
```

This solves the issue where OpenCode may start on a random port instead of 4096 (common since OpenCode v1.3+ where HTTP server is disabled by default).

## Multiple Clients / Shared Server

### Can Multiple Bridges Connect to the Same OpenCode Server?

**Yes.** OpenCode server (`opencode serve`) is a stateless HTTP API server. Multiple clients can connect simultaneously:

```
┌─────────────────┐
│ Slack Bridge     │──┐
└─────────────────┘  │
                     ▼
┌─────────────────┐  ┌──────────────────┐
│ Discord Bridge  │──▶│ OpenCode Server  │
└─────────────────┘  │ localhost:4096    │
                     └──────────────────┘
┌─────────────────┐  ▲
│ Web UI          │──┘
└─────────────────┘
```

### How Sessions Work

- Each bridge creates its own sessions via `POST /session`
- Sessions are isolated — your Slack sessions don't interfere with Discord sessions
- The server manages all sessions independently

### Running Multiple Bridges

```bash
# Terminal 1: OpenCode server
opencode serve

# Terminal 2: Slack bridge
cd opencode-slack-bridge
npm run dev

# Terminal 3: Discord bridge (like kimaki)
cd kimaki
npm run dev
```

### Different Project Directories

If you need separate OpenCode servers for different projects:

```bash
# Project A
cd ~/project-a
opencode serve --port 4096

# Project B
cd ~/project-b
opencode serve --port 4097
```

Then configure each bridge to point to its server:

```env
# Bridge for Project A
OPENCODE_URL=http://localhost:4096

# Bridge for Project B
OPENCODE_URL=http://localhost:4097
```

### Security Note

If connecting to a remote OpenCode server (not localhost), use HTTPS:

```env
# Remote server (use HTTPS)
OPENCODE_URL=https://your-server.example.com:4096
```

**Never expose OpenCode server to the internet without authentication.**

## Session Storage

Session data is stored in SQLite at `./data/sessions.db`:

| Table | Purpose |
|-------|---------|
| `channel_sessions` | Maps Slack channel → OpenCode session |
| `channel_directories` | Maps channel → project directory |

Data persists across restarts. Delete the `./data` folder to reset.

## Usage

### Chat in Slack

1. **DM the bot** — Find it under "Apps" in sidebar, send a message
2. **Mention in channel** — `@OpenCode Bridge your message`
3. **Reply in thread** — Continue conversations in threads

### Slash Commands

| Command | Description |
|---------|-------------|
| `/abort` | Stop the current running session |
| `/resume` | List and resume a previous session |
| `/queue` | View the message queue |
| `/queue clear` | Clear all queued messages |
| `/sessions` | Show current session info |
| `/help` | List all available commands |

### Tips

- End a message with `. queue` to manually queue it while session is busy
- Messages sent while busy are automatically queued and processed in order
- Sessions persist across bridge restarts (stored in SQLite)

### Debug Mode

Enable debug logging to see what's happening:

```bash
DEBUG=true npm run dev
```

Or use `run.bat` which enables DEBUG by default.

This shows:
- OpenCode events (step-start, step-finish, tool calls, etc.)
- Session status changes
- Reasoning/thinking filtering

Useful when troubleshooting why the bot isn't responding or is doing unexpected things.

## Slack Formatting

The bridge uses **Slack Block Kit** with markdown blocks for rich formatting:

| Feature | Syntax | Example |
|---------|--------|---------|
| Bold | `*text*` | *bold* |
| Italic | `_text_` | _italic_ |
| Code | ``` `code` ``` | `code` |
| Code block | ```` ```lang ``` ```` | ```js |
| Block quote | `> text` | > quote |

### Message Chunking

Long messages (>11,000 characters) are automatically split and sent as threaded follow-up messages with `[1/3]`, `[2/3]`, etc. markers.

### Code Detection

The bridge automatically detects code sections and formats them appropriately for Slack.

## Agent Configuration (OpenCode Only)

The bridge uses the `slack-agent` agent which is pre-configured to use Google Workspace (gws) CLI tools.

### Default Agent

```env
OPENCODE_AGENT=slack-agent
```

The agent name must match one defined in your OpenCode config. The bridge expects a `slack-agent` to be defined in `~/.config/opencode/opencode.json`:

```json
{
  "agent": {
    "slack-agent": {
      "description": "Expert in Google Workspace CLI (gws) for managing Drive, Gmail, Calendar, Sheets, Docs, and more via Slack.",
      "mode": "subagent",
      "prompt": "{file:~/.config/opencode/agents/slack-agent.md}",
      "tools": {
        "read": true,
        "bash": true
      },
      "model": "opencode/minimax-m2.5-free"
    }
  }
}
```

> **Important:** The agent only has `read` and `bash` permissions — no `write` or `edit`. This ensures safety when running via Slack.

### Available Models

The bridge uses MiniMax M2.5 Free by default which has a known behavior: it outputs thinking/reasoning content that needs to be filtered. The bridge handles this automatically.

Common models from oh-my-opencode.json:

| Agent | Model | Best For |
|-------|-------|----------|
| `slack-agent` | minimax-m2.5-free | Google Workspace tasks (default) |
| `sisyphus` | qwen3.6-plus-free | General reasoning |
| `junior` | minimax-m2.5-free | Fast responses |

### Thinking/Reasoning Filtering

The bridge filters out model thinking from Slack output using **event-level filtering** (not regex). This is more reliable and works even when the model doesn't use `<thinking>` tags.

How it works:
1. OpenCode emits `message.part.updated` events with `part.type: "reasoning"`
2. Bridge tracks reasoning part IDs
3. Filters out `message.part.delta` events from reasoning parts

This is particularly useful for models like MiniMax M2.5 that don't have a built-in "thinking disable" API parameter.

> **Note:** If you're connecting to an external service other than OpenCode, agent configuration may not apply. Check that service's documentation for how to specify AI models.

## File Structure

```
opencode-slack-bridge/
├── src/
│   ├── index.ts        # Entry point
│   ├── slack.ts        # Slack Bolt handlers + slash commands
│   ├── opencode.ts     # OpenCode SDK client + SSE event bus
│   ├── sessions.ts     # Session management
│   ├── database.ts     # SQLite persistence (better-sqlite3)
│   ├── streaming.ts    # SSE → Slack message updates (with thinking filter)
│   ├── queue.ts       # Message queue for busy sessions
│   ├── formatting.ts # Slack formatting utilities
│   ├── detect-port.ts # Dynamic port detection
│   └── setup.ts       # Environment check
├── data/              # SQLite database (gitignored)
├── docs/
│   └── TECHNICAL.md   # Architecture + implementation details
├── .env.example       # Token template
├── run.bat            # Windows launcher (auto port detection)
├── SETUP.md          # Slack app setup guide
├── SLACK_AGENT.md     # Agent prompt for gws tools
├── README.md         # This file
└── package.json
```

For detailed technical documentation, see `docs/TECHNICAL.md`.
opencode-slack-bridge/
├── src/
│   ├── index.ts        # Entry point
│   ├── slack.ts        # Slack Bolt handlers + slash commands
│   ├── opencode.ts     # OpenCode SDK client + SSE event bus
│   ├── sessions.ts     # Session management
│   ├── database.ts     # SQLite persistence (better-sqlite3)
│   ├── streaming.ts    # SSE → Slack message updates (with thinking filter)
│   ├── queue.ts        # Message queue for busy sessions
│   └── setup.ts        # Verification script
├── data/               # SQLite database (gitignored)
├── .env.example        # Token template
├── run.bat             # Windows launcher (auto port detection)
├── SLACK_AGENT.md      # Agent prompt for gws tools
├── SLACK_FORMATTING.md # Slack formatting rules
├── SETUP.md            # Slack app setup guide
├── README.md           # This file
└── package.json
```

## License

MIT
