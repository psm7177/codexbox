# Advanced Setup

## Manual Setup From an Existing Checkout

```bash
npm install
cp .env.example .env
npm run build
npm start
```

## Run the Setup Script Manually

```bash
bash scripts/setup-linux.sh
```

## Install a systemd Service

```bash
INSTALL_SYSTEMD_SERVICE=1 bash scripts/setup-linux.sh
```

## Skip MCP Registration

```bash
INSTALL_CODEX_DISCORD_MCP=0 bash scripts/setup-linux.sh
```

## Avoid the Interactive Token Prompt

```bash
DISCORD_TOKEN=your_token_here bash scripts/setup-linux.sh
```

## Force systemd Scope

```bash
SYSTEMD_SERVICE_SCOPE=system INSTALL_SYSTEMD_SERVICE=1 bash scripts/setup-linux.sh
SYSTEMD_SERVICE_SCOPE=user INSTALL_SYSTEMD_SERVICE=1 bash scripts/setup-linux.sh
```

## Override Service Name or User

```bash
SYSTEMD_SERVICE_NAME=my-codex-bot SYSTEMD_SERVICE_USER=ubuntu INSTALL_SYSTEMD_SERVICE=1 bash scripts/setup-linux.sh
```

## Disable Linger for User Services

```bash
SYSTEMD_ENABLE_LINGER=0 SYSTEMD_SERVICE_SCOPE=user INSTALL_SYSTEMD_SERVICE=1 bash scripts/setup-linux.sh
```

## Useful Service Commands

```bash
sudo systemctl status codexbox --no-pager
sudo journalctl -u codexbox -f
systemctl --user status codexbox --no-pager
journalctl --user -u codexbox -f
```
