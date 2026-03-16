#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
EXAMPLE_FILE="$ROOT_DIR/.env.example"
INSTALL_SYSTEMD_SERVICE="${INSTALL_SYSTEMD_SERVICE:-0}"
INSTALL_CODEX_DISCORD_MCP="${INSTALL_CODEX_DISCORD_MCP:-1}"
SYSTEMD_SERVICE_NAME="${SYSTEMD_SERVICE_NAME:-codexbox}"
SYSTEMD_ENABLE_NOW="${SYSTEMD_ENABLE_NOW:-1}"
SYSTEMD_SERVICE_SCOPE="${SYSTEMD_SERVICE_SCOPE:-auto}"
SYSTEMD_ENABLE_LINGER="${SYSTEMD_ENABLE_LINGER:-1}"
INSTALLED_SYSTEMD_SERVICE_SCOPE=""

source "$ROOT_DIR/scripts/lib/common.sh"
source "$ROOT_DIR/scripts/lib/codex-mcp.sh"
source "$ROOT_DIR/scripts/lib/systemd.sh"

require_command node
require_command npm
require_command codex

if [[ ! -f "$EXAMPLE_FILE" ]]; then
  echo "Missing $EXAMPLE_FILE" >&2
  exit 1
fi

cd "$ROOT_DIR"

echo "Installing npm dependencies..."
npm install

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$EXAMPLE_FILE" "$ENV_FILE"
fi

DISCORD_TOKEN_VALUE="${DISCORD_TOKEN:-}"
if [[ -z "$DISCORD_TOKEN_VALUE" ]]; then
  DISCORD_TOKEN_VALUE="$(get_env_value 'DISCORD_TOKEN')"
fi
if [[ -z "$DISCORD_TOKEN_VALUE" ]]; then
  DISCORD_TOKEN_VALUE="$(prompt_value 'Discord bot token: ' 'DISCORD_TOKEN')"
fi

INSTALLER_USER="${SUDO_USER:-$(id -un)}"
INSTALLER_HOME="$(resolve_user_home "$INSTALLER_USER")"
if [[ -z "$INSTALLER_HOME" ]]; then
  INSTALLER_HOME="${HOME:-}"
fi
if [[ -z "$INSTALLER_HOME" ]]; then
  echo "Unable to resolve installer home directory for user: $INSTALLER_USER" >&2
  exit 1
fi

DISCORD_ADMIN_IDS_VALUE="${DISCORD_RESTART_ADMIN_USER_IDS:-}"
if [[ -z "$DISCORD_ADMIN_IDS_VALUE" ]]; then
  DISCORD_ADMIN_IDS_VALUE="$(get_env_value 'DISCORD_RESTART_ADMIN_USER_IDS')"
fi
if [[ -z "$DISCORD_ADMIN_IDS_VALUE" ]]; then
  DISCORD_ADMIN_IDS_VALUE="$(
    prompt_value 'Discord admin user ID(s), comma-separated: ' 'DISCORD_RESTART_ADMIN_USER_IDS'
  )"
fi

set_env_value "DISCORD_TOKEN" "$DISCORD_TOKEN_VALUE"
set_env_value "DISCORD_RESTART_ADMIN_USER_IDS" "$DISCORD_ADMIN_IDS_VALUE"
set_env_value "CODEX_WORKSPACE" "$INSTALLER_HOME"

echo "Building project..."
npm run build

if is_truthy "$INSTALL_CODEX_DISCORD_MCP"; then
  echo "Registering Codex MCP server..."
  install_codex_mcp_server
fi

if is_truthy "$INSTALL_SYSTEMD_SERVICE"; then
  echo "Installing systemd service..."
  install_systemd_service
fi

cat <<'EOF'

Setup complete.

Next steps:
1. Verify Codex CLI authentication works on this machine.
EOF

if is_truthy "$INSTALL_SYSTEMD_SERVICE"; then
  if is_truthy "$SYSTEMD_ENABLE_NOW"; then
    if [[ "$INSTALLED_SYSTEMD_SERVICE_SCOPE" == "user" ]]; then
      echo "2. Check the service with: systemctl --user status $SYSTEMD_SERVICE_NAME --no-pager"
    else
      echo "2. Check the service with: sudo systemctl status $SYSTEMD_SERVICE_NAME --no-pager"
    fi
  else
    if [[ "$INSTALLED_SYSTEMD_SERVICE_SCOPE" == "user" ]]; then
      echo "2. Start the service with: systemctl --user start $SYSTEMD_SERVICE_NAME"
    else
      echo "2. Start the service with: sudo systemctl start $SYSTEMD_SERVICE_NAME"
    fi
  fi
else
  echo "2. Start the bot with: npm start"
fi
