# codex-discord

Discord bot that treats Discord channels as Codex workspaces and Discord conversations as Codex sessions.

## Behavior

- Each guild text channel owns one persisted `cwd`.
- Each Discord thread owns one Codex session, and inherits the parent channel `cwd`.
- Messages sent directly in a guild text channel use that channel's `cwd` and that channel's own Codex session.
- DMs also keep their own `cwd`, defaulting to `CODEX_WORKSPACE`.
- DMs are always handled.
- Discord thread channels work when the bot can read message content.
- Regular guild text channels are handled when the bot is mentioned or replied to.
- Turns are serialized per Discord conversation so the Codex session history stays coherent.
- Commands are handled in `!codex <command>` form.
- `!codex help` lists available commands.
- `!codex status` shows the current `cwd` and mapped Codex thread id.
- `!codex cwd` shows the current channel `cwd`.
- `!codex cwd <path>` sets the current channel `cwd`.
- `!codex cwd reset` resets the current channel `cwd` back to `CODEX_WORKSPACE`.
- `!codex access` shows the current sandbox access mode for the channel workspace.
- `!codex access workspace-write|read-only|full-access|reset` overrides the channel workspace sandbox mode.
- `!codex network` shows whether network access is enabled for the current channel workspace.
- `!codex network on|off|reset` overrides network access for the current channel workspace.
- `!codex reset` drops the current Discord-to-Codex mapping for that conversation.
- `!codex restart` exits the bot with code `75`, and the local runner started by `npm start` rebuilds and starts it again.
- Codex image results are delivered back to Discord from structured app-server items such as `imageView` and `imageGeneration`.
- When the user explicitly wants an image posted into Discord, Codex can call the MCP tool `send_discord_image`.

## Requirements

- Node.js 20+
- A preinstalled global `codex` CLI with `codex app-server`
- A working Codex auth/config setup for that `codex` installation
- A Discord bot token
- Optional: `MESSAGE CONTENT INTENT` enabled if you want the bot to read non-mention guild messages

## Setup

1. Install Node dependencies with `npm install`.
2. Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN`.
3. Start the bot with `npm start`.

## Quick Linux Setup

For a public GitHub repo, a Linux host can bootstrap directly from GitHub with:

```bash
curl -fsSL https://raw.githubusercontent.com/psm7177/codexbox/master/scripts/install-public-linux.sh | bash
```

This bootstrap script:

- clones or updates `https://github.com/psm7177/codexbox.git`
- runs `scripts/setup-linux.sh` with systemd registration enabled

The local setup script then:

- checks for `node`, `npm`, and `codex`
- runs `npm install`
- creates `.env` from `.env.example` if needed
- prompts for `DISCORD_TOKEN` from the terminal, even when run through `curl | bash`
- sets `CODEX_WORKSPACE=.`
- runs the first build
- registers a local Codex MCP server named `codex-discord-tools`
- installs a `codex-discord` systemd service
- starts that service immediately

By default it prefers a system service and falls back to a user service when sudo is unavailable in the current session.
When it installs a user service, it also tries to enable linger by default so the bot keeps running after logout.

After that, manage the bot with either:

```bash
sudo systemctl status codex-discord --no-pager
sudo journalctl -u codex-discord -f
```

or, for a user service:

```bash
systemctl --user status codex-discord --no-pager
journalctl --user -u codex-discord -f
```

If you already cloned the repo manually, you can still run:

```bash
bash scripts/setup-linux.sh
```

To install the same systemd service from an existing checkout:

```bash
INSTALL_SYSTEMD_SERVICE=1 bash scripts/setup-linux.sh
```

If you want to avoid the prompt entirely, this also works:

```bash
DISCORD_TOKEN=your_token_here bash scripts/setup-linux.sh
```

If you want to skip MCP registration:

```bash
INSTALL_CODEX_DISCORD_MCP=0 bash scripts/setup-linux.sh
```

You can override the generated systemd unit name or user when needed:

```bash
SYSTEMD_SERVICE_NAME=my-codex-bot SYSTEMD_SERVICE_USER=ubuntu INSTALL_SYSTEMD_SERVICE=1 bash scripts/setup-linux.sh
```

You can also force the service scope:

```bash
SYSTEMD_SERVICE_SCOPE=system INSTALL_SYSTEMD_SERVICE=1 bash scripts/setup-linux.sh
SYSTEMD_SERVICE_SCOPE=user INSTALL_SYSTEMD_SERVICE=1 bash scripts/setup-linux.sh
```

If you want to skip that behavior:

```bash
SYSTEMD_ENABLE_LINGER=0 SYSTEMD_SERVICE_SCOPE=user INSTALL_SYSTEMD_SERVICE=1 bash scripts/setup-linux.sh
```

Manual linger command:

```bash
sudo loginctl enable-linger "$USER"
```

TypeScript sources live under `src/` and compile to `dist/`.

## Project Layout

```text
.
├── README.md
├── REFACTOR_TODO.md
├── scripts
│   ├── install-public-linux.sh
│   ├── lib
│   │   ├── common.sh
│   │   ├── codex-mcp.sh
│   │   └── systemd.sh
│   ├── mcp-discord-server.mjs
│   ├── run-bot.mjs
│   └── setup-linux.sh
├── src
│   ├── chat
│   │   ├── message-router.ts
│   │   └── turn-runner.ts
│   ├── codex
│   │   └── jsonrpc-transport.ts
│   ├── commands
│   │   ├── access.ts
│   │   ├── cwd.ts
│   │   ├── format.ts
│   │   ├── help.ts
│   │   ├── network.ts
│   │   ├── reset.ts
│   │   ├── restart.ts
│   │   ├── status.ts
│   │   └── types.ts
│   ├── discord
│   │   └── message-sender.ts
│   ├── lifecycle
│   │   └── restart-coordinator.ts
│   ├── startup
│   │   ├── admin-startup-log.ts
│   │   └── ready-handler.ts
│   ├── state
│   │   ├── conversation-service.ts
│   │   └── workspace-service.ts
│   ├── codex-app-server-client.ts
│   ├── commands.ts
│   ├── config.ts
│   ├── discord-context.ts
│   ├── discord-images.ts
│   ├── index.ts
│   ├── response-status.ts
│   └── session-store.ts
└── test
    ├── admin-startup-log.test.ts
    ├── discord-context.test.ts
    ├── discord-images.test.ts
    ├── message-router.test.ts
    ├── response-status.test.ts
    ├── session-store.test.ts
    ├── turn-runner.test.ts
    └── workspace-service.test.ts
```

High-level responsibilities:

- `src/index.ts`: bootstrap and wiring
- `src/chat/`: Discord message routing and Codex turn execution
- `src/codex/`: JSON-RPC transport for the Codex app-server process
- `src/commands/`: per-command handlers for `!codex ...`
- `src/discord/`: Discord delivery helpers
- `src/startup/`: admin startup status logging
- `src/state/`: conversation and workspace domain services
- `scripts/lib/`: shared shell helpers for setup and systemd installation

## Discord MCP Tool

The setup script registers a local MCP server named `codex-discord-tools` with Codex:

```bash
codex mcp get codex-discord-tools
```

That server exposes:

- `send_discord_image(channel_id, image, caption?)`

The bot injects the current Discord `channel_id` into each Codex turn so the model can call this tool when the user explicitly asks for an image to be posted into Discord.

The MCP server reads the repository `.env` on startup, so `DISCORD_TOKEN` does not need to be passed manually through `codex mcp add --env ...`.

Supported `image` inputs:

- absolute or relative local image paths
- `https://...` image URLs
- `data:image/...` URLs

Local file access is limited to `CODEX_WORKSPACE`, `$HOME`, `/tmp`, and any extra roots listed in `DISCORD_MCP_ALLOWED_ROOTS`.

Notes:

- long captions are truncated to fit Discord's 2000-character message limit
- bot-side bridge error replies are also truncated so Discord does not reject them

Useful commands:

```bash
npm run build
npm test
npm start
```

## Publishing Safety

- Do not commit `.env`, `.data/`, or any generated session files.
- Do not commit `dist/`; build artifacts are environment-specific and should be reproduced locally or in CI.
- Review `CODEX_WORKSPACE` before publishing configs. It should usually be a relative path like `.` or a non-sensitive project path, not a personal absolute path.
- Keep `CODEX_APPROVAL_POLICY=never` unless you intentionally want Discord users to trigger higher-risk actions.
- Keep `CODEX_SANDBOX_MODE=workspaceWrite` or `readOnly` for public deployments unless you have a strong reason to allow broader access.

If you want Discord-triggered restart, allow specific Discord user IDs:

```bash
DISCORD_RESTART_ADMIN_USER_IDS=123456789012345678,234567890123456789
```

`!codex restart` only works for those users. If you launch with `npm start`, the included runner will rebuild and relaunch the bot automatically. External supervisors like `pm2` or `systemd` are still fine, but no longer required for basic restart support.

If you enable the Discord privileged Message Content intent in the developer portal, also set:

```bash
DISCORD_MESSAGE_CONTENT_INTENT=true
```

Without that intent, the bot can still work in DMs and when directly mentioned in guild channels, but it cannot reliably read arbitrary guild/thread message text.

By default the bot starts the globally installed Codex CLI:

```bash
codex app-server --listen stdio://
```

If your Codex binary is somewhere else, set:

```bash
CODEX_APP_SERVER_BIN=/path/to/codex
CODEX_APP_SERVER_ARGS="app-server --listen stdio://"
```

## Safety

The default config is intentionally conservative:

- `CODEX_APPROVAL_POLICY=never`
- command/file approvals requested by app-server are declined by the bot
- sandbox mode defaults to `workspaceWrite` rooted at `CODEX_WORKSPACE`

If you want Codex to edit files or run commands through Discord, change those settings deliberately.
