# User Manual

## What It Does

`codexbox` is a bridge between Discord and Codex. Its purpose is to let a person use Codex from a Discord conversation instead of a local terminal window.

This project is meant for teams or individuals who want to:

- work with Codex from a familiar chat interface
- keep ongoing task context inside a Discord channel, thread, or DM
- use Codex for coding, file inspection, command execution, and image-related workflows without leaving Discord
- run a self-hosted bot that stays connected to the local machine where Codex is installed

In short, this project turns Discord into a practical front end for an existing Codex environment.

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
