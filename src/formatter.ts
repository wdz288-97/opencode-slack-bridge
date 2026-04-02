import type { OpenCodeMessage, MessagePart } from './opencode.js'

export interface SlackMessage {
  text: string
  blocks?: unknown[]
}

export function formatForSlack(message: OpenCodeMessage): SlackMessage {
  const blocks: unknown[] = []

  // Add main text content
  if (message.content) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: message.content,
      },
    })
  }

  // Add tool outputs if present
  if (message.parts && message.parts.length > 0) {
    const toolBlocks = message.parts
      .filter(p => p.type === 'tool')
      .map(p => formatToolOutput(p))
    
    if (toolBlocks.length > 0) {
      blocks.push({
        type: 'divider',
      })
      blocks.push(...toolBlocks)
    }
  }

  return {
    text: message.content || 'Response from OpenCode',
    blocks: blocks.length > 0 ? blocks : undefined,
  }
}

export function formatToolOutput(part: MessagePart): unknown {
  const toolName = part.tool || 'Unknown Tool'
  const status = part.status || 'completed'
  const statusEmoji = status === 'completed' ? '✅' : status === 'error' ? '❌' : '⏳'

  let outputText = `*${statusEmoji} ${toolName}*\n`
  
  if (part.input) {
    const inputStr = typeof part.input === 'string' 
      ? part.input 
      : JSON.stringify(part.input, null, 2)
    outputText += `Input: \`${inputStr.slice(0, 200)}${inputStr.length > 200 ? '...' : ''}\`\n`
  }

  if (part.output) {
    const outputStr = part.output.slice(0, 500)
    outputText += `Output:\n\`\`\`\n${outputStr}${part.output.length > 500 ? '\n...' : ''}\n\`\`\``
  }

  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: outputText,
    },
  }
}

export function formatForSlackStreaming(text: string, isComplete: boolean): SlackMessage {
  // For streaming, just return the text as-is
  // The caller will update the message with chat.update
  return {
    text: isComplete ? text : `${text}▌`, // Add cursor for incomplete
  }
}
