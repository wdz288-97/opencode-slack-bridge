/**
 * Slack message formatting utilities
 * - Block quotes for prose
 * - Code blocks for code
 * - Message chunking for long output
 */

// Slack character limits
const MAX_MESSAGE_LENGTH = 3500 // Stay under 4,000
const MAX_BLOCK_TEXT = 2950 // Per block with overhead

/**
 * Format text as a block quote (> prefix)
 */
export function formatBlockQuote(text: string): string {
  return text
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n')
}

/**
 * Format code with triple backticks, handling fence collision
 */
export function formatCodeBlock(code: string, language?: string): string {
  // Dynamic fence to avoid collision
  let fence = '```'
  while (code.includes(fence)) {
    fence += '`'
  }
  
  const fenceEnd = fence.slice(0, 3) + (language ? language : '')
  return `${fenceEnd}\n${code}\n${fenceEnd.slice(0, 3)}`
}

/**
 * Detect if text looks like code (has indentation, brackets, semicolons, etc.)
 */
export function looksLikeCode(text: string): boolean {
  const codeIndicators = [
    /^\s{2,}\S/,           // indented line
    /[{}\[\]();]/,         // programming chars
    /;\s*$/m,              // ends with semicolon
    /^\s*(function|const|let|var|class|if|for|while|return)\s/m,
    /<\/?[a-z]+[^>]*>/i,   // HTML-like tags
    /^import\s+|^export\s+|^from\s+|^const\s+|^let\s+/m,
  ]
  
  return codeIndicators.some(pattern => pattern.test(text))
}

/**
 * Format content appropriately (code vs prose)
 */
export function formatContent(
  content: string,
  options: {
    isCode?: boolean
    useBlockQuote?: boolean
  } = {}
): string {
  const { isCode = looksLikeCode(content), useBlockQuote = false } = options
  
  if (isCode) {
    return formatCodeBlock(content)
  }
  
  if (useBlockQuote) {
    return formatBlockQuote(content)
  }
  
  return content
}

/**
 * Split long message into chunks that fit in Slack
 * Uses sentence boundaries when possible
 */
export function chunkMessage(text: string, maxLength = MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLength) {
    return [text]
  }

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > maxLength) {
    // Find last newline before limit
    let cut = remaining.lastIndexOf('\n', maxLength)
    
    // If no newline found, try sentence ending
    if (cut === -1) {
      cut = remaining.lastIndexOf('. ', maxLength)
      if (cut !== -1 && cut < maxLength - 10) {
        cut += 2 // Include the period and space
      }
    }
    
    // If still no boundary, try comma
    if (cut === -1) {
      cut = remaining.lastIndexOf(', ', maxLength)
      if (cut !== -1 && cut < maxLength - 10) {
        cut += 2
      }
    }
    
    // Last resort: hard cut at limit
    if (cut === -1 || cut > maxLength - 100) {
      cut = maxLength
    }

    chunks.push(remaining.slice(0, cut))
    remaining = remaining.slice(cut)
  }

  // Add remaining content
  if (remaining) {
    chunks.push(remaining)
  }

  return chunks
}

/**
 * Add chunk markers to split messages
 */
export function markChunks(chunks: string[]): string[] {
  if (chunks.length === 1) {
    return chunks
  }

  return chunks.map((chunk, i) => {
    const marker = `[${i + 1}/${chunks.length}]`
    // Add marker at start, after any existing block quote prefix
    if (chunk.startsWith('> ')) {
      return chunk.replace(/^> /, `> ${marker} `)
    }
    return `${marker}\n${chunk}`
  })
}

/**
 * Check if content needs chunking
 */
export function needsChunking(text: string, maxLength = MAX_MESSAGE_LENGTH): boolean {
  return text.length > maxLength
}

/**
 * Format a complete Slack message with proper formatting and chunking
 */
export interface FormattedMessage {
  chunks: string[]
  isChunked: boolean
}

export function formatSlackMessage(
  content: string,
  options: {
    maxLength?: number
    isCode?: boolean
    useBlockQuote?: boolean
    autoChunk?: boolean
  } = {}
): FormattedMessage {
  const {
    maxLength = MAX_MESSAGE_LENGTH,
    isCode = looksLikeCode(content),
    useBlockQuote = false,
    autoChunk = true,
  } = options

  // Format the content
  let formatted = formatContent(content, { isCode, useBlockQuote })

  // Fix Slack mrkdwn formatting
  // Bold: **text** → *text*
  formatted = formatted.replace(/\*\*/g, '*')
  // Strikethrough: ~~text~~ → ~text~
  formatted = formatted.replace(/~~/g, '~')

  // Check if we need to chunk
  if (!autoChunk || !needsChunking(formatted, maxLength)) {
    return {
      chunks: [formatted],
      isChunked: false,
    }
  }

  // Chunk and mark
  const rawChunks = chunkMessage(formatted, maxLength)
  const markedChunks = markChunks(rawChunks)

  return {
    chunks: markedChunks,
    isChunked: markedChunks.length > 1,
  }
}