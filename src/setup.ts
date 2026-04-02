import { config } from 'dotenv'

config()

interface CheckResult {
  name: string
  ok: boolean
  message: string
}

async function checkEnvironment(): Promise<CheckResult[]> {
  const results: CheckResult[] = []

  // Check Slack tokens
  const appToken = process.env.SLACK_APP_TOKEN
  const botToken = process.env.SLACK_BOT_TOKEN

  results.push({
    name: 'SLACK_APP_TOKEN',
    ok: !!appToken && appToken.startsWith('xapp-'),
    message: appToken
      ? appToken.startsWith('xapp-')
        ? 'Valid format'
        : 'Invalid format (should start with xapp-)'
      : 'Missing - add to .env file',
  })

  results.push({
    name: 'SLACK_BOT_TOKEN',
    ok: !!botToken && botToken.startsWith('xoxb-'),
    message: botToken
      ? botToken.startsWith('xoxb-')
        ? 'Valid format'
        : 'Invalid format (should start with xoxb-)'
      : 'Missing - add to .env file',
  })

  // Check OpenCode connection
  const opencodeUrl = process.env.OPENCODE_URL || 'http://localhost:4096'
  
  try {
    const response = await fetch(`${opencodeUrl}/global/health`)
    const data = await response.json() as { healthy?: boolean; version?: string }
    
    results.push({
      name: 'OpenCode Server',
      ok: data.healthy === true,
      message: data.healthy
        ? `Connected - version ${data.version || 'unknown'}`
        : 'Server not healthy',
    })
  } catch (error) {
    results.push({
      name: 'OpenCode Server',
      ok: false,
      message: `Cannot connect to ${opencodeUrl} - is 'opencode serve' running?`,
    })
  }

  return results
}

async function main() {
  console.log('\n=== OpenCode Slack Bridge - Setup Check ===\n')

  const results = await checkEnvironment()

  let allOk = true
  for (const result of results) {
    const icon = result.ok ? '\u2705' : '\u274C'
    console.log(`${icon} ${result.name}: ${result.message}`)
    if (!result.ok) allOk = false
  }

  console.log('')

  if (allOk) {
    console.log('All checks passed! Run the bridge with:')
    console.log('  npm run dev')
  } else {
    console.log('Fix the issues above, then run this check again:')
    console.log('  npx tsx src/setup.ts')
    
    if (!results.find(r => r.name === 'SLACK_APP_TOKEN')?.ok) {
      console.log('')
      console.log('To create a Slack app:')
      console.log('  1. Go to https://api.slack.com/apps')
      console.log('  2. Create New App > From scratch')
      console.log('  3. Enable Socket Mode (get xapp- token)')
      console.log('  4. Add OAuth scopes (see README.md)')
      console.log('  5. Subscribe to bot events')
      console.log('  6. Install to workspace (get xoxb- token)')
    }

    if (!results.find(r => r.name === 'OpenCode Server')?.ok) {
      console.log('')
      console.log('To start OpenCode server:')
      console.log('  opencode serve')
    }
  }

  console.log('')
}

main().catch(console.error)
