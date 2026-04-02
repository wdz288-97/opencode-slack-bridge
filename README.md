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
- **File attachments** - Attach code files, images, docs
- **Tool output display** - See what tools OpenCode used
- **Session persistence** - Each channel maintains its own session
- **Thread support** - Bot responds in threads

## Prerequisites

1. **Node.js** 18+ installed
2. **OpenCode** running with server enabled (`opencode serve`)
3. **Slack workspace** where you can install apps

## Setup

### 1. Create Slack App

Go to [api.slack.com/apps](https://api.slack.com/apps):

1. Click **"Create New App"** → **"From scratch"**
2. Name: `opencode-bridge` (or your preference)
3. Select your workspace

### 2. Enable Socket Mode

- Left sidebar → **Socket Mode** → Enable
- Generate token with `connections:write` scope
- Copy the `xapp-...` token

### 3. Add Bot Scopes

- Left sidebar → **OAuth & Permissions** → **Scopes**
- Add these **Bot Token Scopes**:
  - `app_mentions:read`
  - `channels:history`
  - `channels:read`
  - `chat:write`
  - `files:read`
  - `files:write`
  - `groups:history`
  - `groups:read`
  - `im:history`
  - `im:read`
  - `im:write`
  - `users:read`

### 4. Subscribe to Events

- Left sidebar → **Event Subscriptions** → Enable
- Subscribe to bot events:
  - `app_mention`
  - `message.channels`
  - `message.groups`
  - `message.im`

### 5. Install App

- Left sidebar → **Install App** → Install to Workspace
- Copy the `xoxb-...` token

### 6. Enable DMs (Optional)

- Left sidebar → **App Home** → **Messages Tab**
- Enable **Messages Tab** and check **Allow users to send Slash commands and messages**

## Installation

```bash
# Clone or navigate to project
cd opencode-slack-bridge

# Install dependencies
npm install

# Create .env file from example
cp .env.example .env

# Edit .env with your tokens
```

## Configuration

Edit `.env`:

```env
SLACK_APP_TOKEN=xapp-your-app-level-token
SLACK_BOT_TOKEN=xoxb-your-bot-user-oauth-token
OPENCODE_URL=http://localhost:4096
```

## Usage

### Start OpenCode Server

```bash
# In your project directory
opencode serve
```

### Start the Bridge

```bash
# Development (with auto-reload)
npm run dev

# Production
npm run build
npm start
```

### Chat in Slack

1. **DM the bot** - Send any message
2. **Mention in channel** - `@opencode-bridge your message`
3. **Reply in thread** - Continue conversations in threads

## How It Works

1. **Message arrives** → Slack Bolt receives via Socket Mode
2. **Session lookup** → Get or create OpenCode session for this channel
3. **Send to OpenCode** → POST prompt to `/session/:id/message`
4. **Format response** → Convert OpenCode response to Slack blocks
5. **Update message** → Edit the "Thinking..." message with the result

## File Structure

```
opencode-slack-bridge/
├── src/
│   ├── index.ts        # Entry point
│   ├── slack.ts        # Slack Bolt setup & handlers
│   ├── opencode.ts     # OpenCode SDK client
│   ├── sessions.ts     # Session management
│   └── formatter.ts    # Response formatting
├── .env.example        # Environment template
├── package.json
└── tsconfig.json
```

## Session Model

- Each Slack channel/DM → one OpenCode session
- Messages in that channel → continue the same session
- New session created automatically on first message

## Troubleshooting

### "Missing required environment variables"

Check your `.env` file has both tokens set.

### "Failed to send initial response"

Bot might not have `chat:write` scope. Check OAuth permissions.

### "No response from OpenCode"

Ensure `opencode serve` is running on the configured port.

### Messages not received

1. Verify Socket Mode is enabled
2. Check Event Subscriptions are configured
3. Ensure bot is added to the channel

## License

MIT
