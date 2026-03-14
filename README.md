# codex-discord

Discord bot that treats each Discord conversation as a Codex app-server session.

## Behavior

- One Codex thread is persisted per Discord DM, Discord thread, or guild text channel.
- DMs are always handled.
- Discord thread channels are always handled.
- Regular guild text channels are handled when the bot is mentioned or replied to.
- Turns are serialized per Discord conversation so the Codex session history stays coherent.
- `!codex reset` drops the current Discord-to-Codex mapping for that conversation.
- `!codex status` shows the mapped Codex thread id.

## Requirements

- Node.js 20+
- Rust toolchain with `cargo`
- A working Codex auth/config setup for `codex app-server`
- A Discord bot token with the `MESSAGE CONTENT INTENT` enabled

## Setup

1. Install Node dependencies.
2. Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN`.
3. Start the bot with `npm start`.

By default the bot starts Codex from the vendored submodule by running:

```bash
node scripts/run-codex-app-server.js
```

If you already have a built app-server binary, set:

```bash
CODEX_APP_SERVER_BIN=/path/to/codex-app-server
CODEX_APP_SERVER_ARGS="--listen stdio://"
```

## Safety

The default config is intentionally conservative:

- `CODEX_APPROVAL_POLICY=never`
- command/file approvals requested by app-server are declined by the bot
- sandbox mode defaults to `workspaceWrite` rooted at `CODEX_WORKSPACE`

If you want Codex to edit files or run commands through Discord, change those settings deliberately.
