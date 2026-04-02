# Slack App Setup (Step-by-Step)

Follow these steps to create a Slack app for OpenCode Slack Bridge.

## Step 1: Create App

1. Go to **https://api.slack.com/apps**
2. Click **"Create New App"**
3. Select **"From scratch"**
4. Enter name: `OpenCode Bridge` (or anything you like)
5. Select your workspace
6. Click **"Create App"**

## Step 2: Enable Socket Mode

1. In the left sidebar, click **"Socket Mode"**
2. Toggle **"Enable Socket Mode"** to On
3. You'll be prompted to generate an App-Level Token:
   - Token Name: `default`
   - Scope: Select `connections:write`
   - Click **"Generate"**
4. **COPY THE TOKEN** (starts with `xapp-`) — this is your `SLACK_APP_TOKEN`
5. Click **"Save Changes"**

## Step 3: Add Bot Token Scopes

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

## Step 4: Subscribe to Events

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

## Step 5: Install to Workspace

1. In the left sidebar, click **"Install App"**
2. Click **"Install to Workspace"**
3. Review permissions and click **"Allow"**
4. **COPY THE TOKEN** (starts with `xoxb-`) — this is your `SLACK_BOT_TOKEN`

## Step 6: Enable DMs (Optional)

1. In the left sidebar, click **"App Home"**
2. Scroll to **"Show Tabs"**
3. Check **"Messages Tab"**
4. Check **"Allow users to send Slash commands and messages from the messages tab"**

## Step 7: Configure .env

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

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Bot not responding | Check Socket Mode is enabled |
| "missing_scope" error | Add the required OAuth scope |
| Bot doesn't see messages | Subscribe to the correct events |
| DMs not working | Enable Messages Tab in App Home |

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
