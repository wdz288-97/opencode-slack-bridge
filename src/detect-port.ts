// Detect working OpenCode port
export async function detectOpenCodePort(): Promise<string> {
  // Quick scan - 1s timeout, fewer ports
  const ports = [4097, 4096]
  
  for (const port of ports) {
    try {
      const url = `http://localhost:${port}`
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 1000)
      
      const response = await fetch(`${url}/global/health`, { signal: controller.signal })
      clearTimeout(timeout)
      
      if (response.ok) {
        const data = await response.json() as any
        console.log(`✓ OpenCode ${data.version} on port ${port}`)
        return url
      }
    } catch {
      // Try next
    }
  }
  
  // None found - start new
  console.log('Starting OpenCode on 4097...')
  const { spawn } = await import('child_process')
  spawn('opencode', ['serve', '--port', '4097'], {
    detached: true,
    stdio: 'ignore',
    shell: true,
    windowsHide: true
  }).unref()
  
  // Quick wait
  await new Promise(r => setTimeout(r, 8000))
  
  return 'http://localhost:4097'
}