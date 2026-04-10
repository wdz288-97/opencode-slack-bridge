# Slack Formatting Reference Guide

This guide covers Slack message formatting using Slack's native markup. Reference: [Slack Message Formatting](https://docs.slack.dev/messaging/formatting-message-text/)

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

````
```javascript
function hello() {
  console.log("Hello!");
}
```
````

## Blockquotes

```
> This is a quote
> Multiple lines
```

Renders as:
> This is a quote

## Best Practices for Slack Bot Messages

1. **Use paragraph sections** - separate logical blocks with blank lines
2. **Code blocks for output** - wrap command output in triple backticks
3. **Use dividers** - separate tool output from final answer with `---` on its own line
4. **Keep length manageable** - Slack messages have a 40,000 character limit
5. **Use :emoji: shortcodes** - they're more reliable than Unicode emojis
6. **Use `<url|text>` for links** - cleaner than raw URLs

## Example: Tool Output + Divider + Answer Format

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

## Useful Emoji Shortcodes

| Shortcode | Display |
|-----------|---------|
| `:typing:` | :typing: |
| `:white_check_mark:` | :white_check_mark: |
| `:x:` | :x: |
| `:warning:` | :warning: |
| `:question:` | :question: |
| `:bulb:` | :bulb: |
| `:exclamation:` | :exclamation: |
| `:memo:` | :memo: |
| `:paperclip:` | :paperclip: |
| `:file_folder:` | :file_folder: |
| `:calendar:` | :calendar: |
| `:email:` | :email: |
| `:hourglass:` | :hourglass: |
| `:ok:` | :ok: |