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
- `!codex reset` drops the current Discord-to-Codex mapping for that conversation.
- `!codex restart` exits the bot with code `75`, and the local runner started by `npm start` rebuilds and starts it again.

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
- runs `scripts/setup-linux.sh`

The local setup script then:

- checks for `node`, `npm`, and `codex`
- runs `npm install`
- creates `.env` from `.env.example` if needed
- prompts for `DISCORD_TOKEN`
- sets `CODEX_WORKSPACE=.`
- runs the first build

After that, start the bot with:

```bash
cd codexbox
npm start
```

If you already cloned the repo manually, you can still run:

```bash
bash scripts/setup-linux.sh
```

TypeScript sources live under `src/` and compile to `dist/`.

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
