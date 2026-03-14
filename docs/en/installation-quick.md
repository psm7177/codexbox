# Quick Setup

## Requirements

- Node.js 20+
- Global `codex` CLI with `codex app-server`
- Working Codex auth/config on the target machine
- Discord bot token

## Public GitHub Bootstrap on Linux

```bash
curl -fsSL https://raw.githubusercontent.com/psm7177/codexbox/master/scripts/install-public-linux.sh | bash
```

## What This Does

- clones or updates `https://github.com/psm7177/codexbox.git`
- runs `scripts/setup-linux.sh`
- installs dependencies
- creates `.env` if needed
- prompts for `DISCORD_TOKEN`
- builds the project
- registers the local MCP server `codexbox-tools`
- installs and starts the `codexbox` systemd service
