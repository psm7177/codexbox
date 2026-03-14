# User Manual

## What It Does

- Each guild text channel has its own persisted `cwd`
- Each Discord thread has its own Codex session and inherits the parent channel `cwd`
- DMs also keep their own `cwd`, defaulting to `CODEX_WORKSPACE`
- Turns are serialized per Discord conversation so Codex session history stays coherent
- In guild text channels, the bot responds when mentioned or replied to
- In DMs, the bot always responds

## Commands

- `!codex help`
- `!codex status`
- `!codex cwd`
- `!codex cwd <path>`
- `!codex cwd reset`
- `!codex access`
- `!codex access workspace-write|read-only|full-access|reset`
- `!codex network`
- `!codex network on|off|reset`
- `!codex reset`
- `!codex restart`

## Images in Discord

- Codex image results can be delivered back to Discord from structured app-server items such as `imageView` and `imageGeneration`
- If the user explicitly wants an image posted into Discord, Codex can call the MCP tool `send_discord_image`
- Long captions are truncated to fit Discord's 2000-character limit
