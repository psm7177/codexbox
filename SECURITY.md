# Security Notes

## Operational Defaults

This project is intended to run with conservative defaults:

- `CODEX_APPROVAL_POLICY=never`
- `CODEX_SANDBOX_MODE=workspaceWrite` or `readOnly`
- `CODEX_SANDBOX_NETWORK=false` unless network access is explicitly required

## Before Publishing

- Do not commit `.env`
- Do not commit `.data/`
- Do not commit generated `dist/`
- Do not publish real Discord bot tokens or personal absolute filesystem paths
- Review any configured `CODEX_WORKSPACE` value and keep it scoped to the intended project only

## Deployment Guidance

- Use a dedicated Discord bot token
- Restrict `DISCORD_RESTART_ADMIN_USER_IDS` to trusted operators only
- Treat Discord users as untrusted input
- If you relax sandbox or approval settings, do so knowingly and document that change
