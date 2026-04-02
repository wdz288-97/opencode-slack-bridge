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

- **Text in/out** - Send messages, get AI responses
- **Streaming** - Real-time token-by-token updates
- **File attachments** - Attach code files, images, docs
- **Tool output display** - See what tools OpenCode used
- **Session persistence** - Each channel maintains its own session
- **Thread support** - Bot responds in threads

## Prerequisites

1. **Node.js** 18+ installed
2. **OpenCode** installed (`npm install -g opencode` or via your package manager)
3. **Slack workspace** where you can install apps

## Quick Start

```bash
# Clone
git clone https://github.com/wdz288-97/opencode-slack-bridge.git
cd opencode-slack-bridge

# Install dependencies
npm install

# Create .env from example
cp .env.example .env

# Verify setup (checks tokens + OpenCode connection)
npm run setup

# Start OpenCode server (in another terminal)
opencode serve

# Start the bridge
npm run dev
```

---

## Slack App Setup (Step-by-Step)

### Step 1: Create App

1. Go to **https://api.slack.com/apps**
2. Click **"Create New App"**
3. Select **"From scratch"**
4. Enter name: `OpenCode Bridge` (or anything you like)
5. Select your workspace
6. Click **"Create App"**

### Step 2: Enable Socket Mode

1. In the left sidebar, click **"Socket Mode"**
2. Toggle **"Enable Socket Mode"** to On
3. You'll be prompted to generate an App-Level Token:
   - Token Name: `default`
   - Scope: Select `connections:write`
   - Click **"Generate"**
4. **COPY THE TOKEN** (starts with `xapp-`) — this is your `SLACK_APP_TOKEN`
5. Click **"Save Changes"**

### Step 3: Add Bot Token Scopes

1. In the left sidebar, click **"OAuth & Permissions"**
2. Scroll to **"Scopes"** → **"Bot Token Scopes"**
3. Click **"Add an OAuth Scope"** for each of these:

| Scope | Why |
|-------|-----|
| `app_mentions:read` | See when bot is @mentioned |
| `channels:history` | Read messages in public channels |
| `channels:read` | List public channels |
| `chat:write` | Send messages as bot |
| `files:read` | Read uploaded files |
| `files:write` | Upload files |
| `groups:history` | Read messages in private channels |
| `groups:read` | List private channels |
| `im:history` | Read DM messages |
| `im:read` | List DM conversations |
| `im:write` | Start DM conversations |
| `users:read` | List workspace users |

### Step 4: Subscribe to Events

1. In the left sidebar, click **"Event Subscriptions"**
2. Toggle **"Enable Events"** to On
3. Scroll to **"Subscribe to bot events"**
4. Click **"Add Bot User Event"** for each:

| Event | Why |
|-------|-----|
| `app_mention` | Triggered when someone @mentions bot |
| `message.channels` | Messages in public channels |
| `message.groups` | Messages in private channels |
| `message.im` | Direct messages |

5. Click **"Save Changes"**

### Step 5: Install to Workspace

1. In the left sidebar, click **"Install App"**
2. Click **"Install to Workspace"**
3. Review permissions and click **"Allow"**
4. **COPY THE TOKEN** (starts with `xoxb-`) — this is your `SLACK_BOT_TOKEN`

### Step 6: Enable DMs (Optional)

1. In the left sidebar, click **"App Home"**
2. Scroll to **"Show Tabs"**
3. Check **"Messages Tab"**
4. Check **"Allow users to send Slash commands and messages from the messages tab"**

### Step 7: Configure .env

Create `.env` file with your tokens:

```env
SLACK_APP_TOKEN=xapp-xxxxxxxxxx
SLACK_BOT_TOKEN=xoxb-xxxxxxxxxx
OPENCODE_URL=http://localhost:4096
```

Verify everything works:

```bash
npm run setup
```

---

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

Both bridges connect to the same OpenCode server on port 4096 without conflicts.

### Custom Server URL

If you run OpenCode on a different port or host:

```env
OPENCODE_URL=http://localhost:3000
```

Or for a remote server:

```env
OPENCODE_URL=http://192.168.1.100:4096
```

---

## Usage

### Chat in Slack

1. **DM the bot** — Find it under "Apps" in sidebar, send a message
2. **Mention in channel** — `@OpenCode Bridge your message`
3. **Reply in thread** — Continue conversations in threads

### Commands

The bot responds to any message. Session persists per channel.

---

## File Structure

```
opencode-slack-bridge/
├── src/
│   ├── index.ts        # Entry point
│   ├── slack.ts        # Slack Bolt handlers
│   ├── opencode.ts     # OpenCode SDK client
│   ├── sessions.ts     # Channel → session mapping
│   ├── streaming.ts    # SSE → Slack message updates
│   ├── formatter.ts    # Response formatting
│   └── setup.ts        # Verification script
├── .env.example        # Token template
├── README.md           # This file
└── package.json
```

## Session Model

- Each Slack channel/DM → one OpenCode session
- Messages in that channel → continue the same session
- New session created automatically on first message
- Sessions are independent per bridge instance

## Troubleshooting

### Run the setup checker first

```bash
npm run setup
```

This checks:
- Slack tokens are valid format
- OpenCode server is reachable

### Common Issues

| Problem | Fix |
|---------|-----|
| Bot not responding | Check Socket Mode is enabled |
| "missing_scope" error | Add the required OAuth scope |
| Bot doesn't see messages | Subscribe to the correct events |
| DMs not working | Enable Messages Tab in App Home |
| "No response from OpenCode" | Start `opencode serve` in another terminal |

### Slack Side

1. Go to https://api.slack.com/apps → Your App
2. Check **Socket Mode** is enabled
3. Check **Event Subscriptions** has all 4 events
4. Check **OAuth & Permissions** has all 12 scopes
5. Reinstall if you changed scopes

### OpenCode Side

```bash
# Check server is running
curl http://localhost:4096/global/health

# Should return: {"healthy":true,"version":"..."}
```

## License

MIT
