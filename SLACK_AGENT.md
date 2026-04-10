# Slack Agent - Google Workspace CLI Integration

This document serves as the reference guide for the `slack-agent` subagent in OpenCode. It provides instructions for formatting Slack messages and using the Google Workspace CLI (gws).

## Agent Configuration

- **Name**: `slack-agent`
- **Model**: `opencode/minimax-m2.5-free`
- **Tools**: `read`, `bash`
- **Default Command**: `/slack`

## Default Prompt

```
You are a Google Workspace expert. Use the gws CLI tool to interact with Google Workspace services.

Available services:
- drive: Manage files, folders, and shared drives
- gmail: Send, read, and manage email
- calendar: Manage calendars and events
- sheets: Read and write spreadsheets
- docs: Read and write Google Docs
- slides: Read and write presentations
- tasks: Manage task lists and tasks
- chat: Manage Chat spaces and messages
- admin: Directory, users, groups, org units
- classroom: Manage classes, rosters, and coursework
- forms: Read and write Google Forms
- keep: Manage Google Keep notes
- meet: Manage Google Meet conferences
- workflow: Cross-service productivity workflows

Key patterns:
- Use gws <service> <resource> <method> --params '{}' for API calls
- Use helper commands: gws drive +upload, gws gmail +send, gws calendar +agenda
- Use --format table for human-readable output, --format json for scripting
- Use --page-all to auto-paginate results as NDJSON
- Check gws schema <service.resource.method> for API schema

Response ORDER (STRICT - follow exactly):
1. FIRST: Show the command you ran and its output
2. SECOND: Add a divider line with exactly "---"
3. THIRD: After the divider, give your final answer/explanation

Example of correct format:
$ gws drive files list --params '{"pageSize": 5}'
{tool output here}

---

Here are your 5 most recent files: ...

When responding:
- NEVER show thinking or reasoning in the output
- Just give the final answer directly after the divider
- Be concise
- Use single asterisks for bold in Slack: *bold* not **bold**
```

---

# Slack Formatting Reference Guide

Reference: [Slack Message Formatting](https://docs.slack.dev/messaging/formatting-message-text/)

## Basic Text Formatting

| Style | Syntax | Example |
|-------|--------|---------|
| Bold | `*text*` | *bold* |
| Italic | `_text_` | _italic_ |
| Strikethrough | `~text~` | ~strikethrough~ |
| Code (inline) | `` `code` `` | `code` |
| Code block | ``` ``` | ```code block``` |

## Links

| Type | Syntax |
|------|--------|
| URL auto-link | `https://example.com` (auto-converts) |
| Named link | `<https://example.com|text>` |
| Channel link | `<#C1234567|#channel>` |
| User link | `<@U1234567|@username>` |

## Special Mentions

| Type | Syntax | Display |
|------|--------|---------|
| User mention | `<@U1234567>` | @username (with notification) |
| Channel mention | `<#C1234567>` | #channel |
| Here mention | `<!here>` | @here |
| Everyone mention | `<!everyone>` | @everyone |

## Emoji

| Type | Syntax |
|------|--------|
| Shortcode | `:typing:` (Slack emoji) |
| Unicode | 🤖 (native unicode) |
| Custom | `:custom-emoji:` |

## Lists

### Bulleted Lists
```
• First item
• Second item
  - Nested item
```

### Numbered Lists
```
1. First item
2. Second item
```

## Code Blocks with Syntax Highlighting

```
```javascript
function hello() {
  console.log("Hello!");
}
```
```

## Blockquotes

```
> This is a quote
> Multiple lines
```

Renders as:
> This is a quote

---

# Google Workspace CLI (gws) Guide

Reference: [gws CLI Documentation](https://github.com/googleworkspace/cli)

## Installation

```bash
npm install -g @googleworkspace/cli
```

Verify installation:
```bash
gws --version
```

## Authentication

### Quick Setup (requires gcloud CLI)
```bash
gws auth setup
```

### Manual Setup (without gcloud)
1. Create a project in Google Cloud Console
2. Enable required APIs (Drive, Gmail, Calendar, etc.)
3. Create OAuth 2.0 Desktop credentials
4. Download the client secret JSON
5. Save to `~/.config/gws/client_secret.json`
6. Run `gws auth login`

## Basic Usage

### Common Commands

```bash
# List files in Drive
gws drive files list --params '{"pageSize": 10}'

# List recent emails
gws gmail messages list --params '{"maxResults": 10}'

# List upcoming events
gws calendar events list --params '{"maxResults": 10}'

# List spreadsheets
gws sheets spreadsheets list

# Read a spreadsheet
gws sheets spreadsheets values get --params '{"spreadsheetId": "YOUR_ID", "range": "Sheet1!A1:D10"}'
```

### Helper Commands (Shortcuts)

```bash
gws drive +upload          # Upload a file
gws gmail +send            # Send an email
gws calendar +agenda       # Show today's agenda
gws calendar +create       # Create an event
```

### Output Formats

```bash
# Table format (human-readable)
gws drive files list --format table

# JSON format (for scripting)
gws drive files list --format json

# NDJSON format (for auto-pagination)
gws drive files list --page-all
```

## API Schema

Check available methods for any service:
```bash
gws schema drive.files
gws schema gmail.messages
gws schema calendar.events
```

Get detailed method info:
```bash
gws schema drive.files.list
```

## Response Output Pattern

When responding to users, ALWAYS follow this format:

```
$ gws <command>
{tool output here}

---

Your final answer here
```

Example:
```
$ gws drive files list --params '{"pageSize": 5}'
id: abc123
name: Document.pdf
mimeType: application/pdf

---

Here are your 5 most recent files:
• Document.pdf
• Report.xlsx
• Notes.txt
```

## Important Notes

1. **Single asterisks for bold** - Slack uses `*text*`, NOT `**text**`
2. **Never show thinking** - Strip any `<thinking>` tags or reasoning from output
3. **Use dividers** - Separate command output from final answer with `---`
4. **Keep it concise** - Slack has a 40,000 character limit per message

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE` | Path to OAuth credentials JSON |
| `GOOGLE_WORKSPACE_CLI_TOKEN` | Pre-obtained OAuth2 access token |