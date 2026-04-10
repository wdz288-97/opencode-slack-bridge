import { config } from 'dotenv'
import { SlackBridge } from './slack.js'

// Load environment variables
config()

async function main() {
  const slackAppToken = process.env.SLACK_APP_TOKEN
  const slackBotToken = process.env.SLACK_BOT_TOKEN
  const opencodeUrl = process.env.OPENCODE_URL || 'http://localhost:4096'
  const opencodeAgent = process.env.OPENCODE_AGENT || 'slack-agent'
  const allowedUsers = process.env.ALLOWED_USERS?.split(',').filter(Boolean) || []
  const allowedChannels = process.env.ALLOWED_CHANNELS?.split(',').filter(Boolean) || []

  if (!slackAppToken || !slackBotToken) {
    console.error('Missing required environment variables:')
    console.error('  SLACK_APP_TOKEN - from api.slack.com/apps (Socket Mode)')
    console.error('  SLACK_BOT_TOKEN - from api.slack.com/apps (OAuth)')
    console.error('')
    console.error('See SETUP.md for details')
    process.exit(1)
  }

  console.log('Starting OpenCode Slack Bridge...')
  console.log(`OpenCode server: ${opencodeUrl}`)
  console.log(`Agent: ${opencodeAgent}`)
  if (allowedUsers.length > 0) {
    console.log(`Allowed users: ${allowedUsers.length} configured`)
  }
  if (allowedChannels.length > 0) {
    console.log(`Allowed channels: ${allowedChannels.length} configured`)
  }

  const bridge = new SlackBridge({
    appToken: slackAppToken,
    botToken: slackBotToken,
    opencodeUrl,
    opencodeAgent,
    allowedUsers: allowedUsers.length > 0 ? allowedUsers : undefined,
    allowedChannels: allowedChannels.length > 0 ? allowedChannels : undefined,
  })

  // Graceful shutdown
  const shutdown = async () => {
    await bridge.stop()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  await bridge.start()
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
