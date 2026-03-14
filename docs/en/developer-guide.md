# Developer Guide

## Architecture

- `src/index.ts`: bootstrap and wiring
- `src/chat/`: Discord message routing and Codex turn execution
- `src/codex/`: JSON-RPC transport for the Codex app-server process
- `src/commands/`: per-command handlers for `!codex ...`
- `src/discord/`: Discord delivery helpers
- `src/startup/`: admin startup status logging
- `src/state/`: conversation and workspace domain services
- `scripts/lib/`: shared shell helpers for setup, MCP registration, and systemd installation

## Project Layout

```text
.
├── README.md
├── REFACTOR_TODO.md
├── docs
│   ├── en
│   │   ├── developer-guide.md
│   │   ├── installation-advanced.md
│   │   ├── installation-quick.md
│   │   └── user-manual.md
│   └── ko
│       ├── developer-guide.md
│       ├── installation-advanced.md
│       ├── installation-quick.md
│       └── user-manual.md
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
    ├── restart-coordinator.test.ts
    ├── session-store.test.ts
    ├── turn-runner.test.ts
    └── workspace-service.test.ts
```

## MCP Integration

- Setup registers a local MCP server named `codexbox-tools`
- The server exposes `send_discord_image(channel_id, image, caption?)`
- The bot injects the current Discord `channel_id` into each Codex turn
- The MCP server reads the repository `.env` on startup, so `DISCORD_TOKEN` does not need to be passed via `codex mcp add --env ...`
- Supported image inputs:
  - local image paths
  - `https://...` image URLs
  - `data:image/...` URLs
- Local access is restricted to `CODEX_WORKSPACE`, `$HOME`, `/tmp`, and `DISCORD_MCP_ALLOWED_ROOTS`

## Safety and Deployment Notes

- Do not commit `.env`, `.data/`, or `dist/`
- Review `CODEX_WORKSPACE` before publishing configs
- Keep `CODEX_APPROVAL_POLICY=never` unless you intentionally want higher-risk execution
- Keep `CODEX_SANDBOX_MODE=workspaceWrite` or `readOnly` unless broader access is deliberate
- If you enable Discord Message Content Intent in the developer portal, also set:

```bash
DISCORD_MESSAGE_CONTENT_INTENT=true
```

- Restart permission is restricted by:

```bash
DISCORD_RESTART_ADMIN_USER_IDS=123456789012345678,234567890123456789
```

- If your Codex binary is not on the default path:

```bash
CODEX_APP_SERVER_BIN=/path/to/codex
CODEX_APP_SERVER_ARGS="app-server --listen stdio://"
```

## Useful Developer Commands

```bash
npm run build
npm test
npm start
codex mcp get codexbox-tools
```
