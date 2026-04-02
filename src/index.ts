import { config } from 'dotenv'
import { SlackBridge } from './slack.js'

// Load environment variables
config()

async function main() {
  const slackAppToken = process.env.SLACK_APP_TOKEN
  const slackBotToken = process.env.SLACK_BOT_TOKEN
  const opencodeUrl = process.env.OPENCODE_URL || 'http://localhost:4096'

  if (!slackAppToken || !slackBotToken) {
    console.error('Missing required environment variables:')
    console.error('  SLACK_APP_TOKEN - from api.slack.com/apps (Socket Mode)')
    console.error('  SLACK_BOT_TOKEN - from api.slack.com/apps (OAuth)')
    console.error('')
    console.error('See .env.example for details')
    process.exit(1)
  }

  console.log('Starting OpenCode Slack Bridge...')
  console.log(`OpenCode server: ${opencodeUrl}`)

  const bridge = new SlackBridge({
    appToken: slackAppToken,
    botToken: slackBotToken,
    opencodeUrl,
  })

  await bridge.start()
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
