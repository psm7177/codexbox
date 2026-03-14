#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
EXAMPLE_FILE="$ROOT_DIR/.env.example"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

prompt_value() {
  local prompt="$1"
  local value=""
  while [[ -z "$value" ]]; do
    read -r -p "$prompt" value
  done
  printf '%s' "$value"
}

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

DISCORD_TOKEN_VALUE="$(prompt_value 'Discord bot token: ')"

if grep -q '^DISCORD_TOKEN=' "$ENV_FILE"; then
  sed -i "s|^DISCORD_TOKEN=.*$|DISCORD_TOKEN=$DISCORD_TOKEN_VALUE|" "$ENV_FILE"
else
  printf '\nDISCORD_TOKEN=%s\n' "$DISCORD_TOKEN_VALUE" >>"$ENV_FILE"
fi

if grep -q '^CODEX_WORKSPACE=' "$ENV_FILE"; then
  sed -i "s|^CODEX_WORKSPACE=.*$|CODEX_WORKSPACE=.|" "$ENV_FILE"
else
  printf 'CODEX_WORKSPACE=.\n' >>"$ENV_FILE"
fi

echo "Building project..."
npm run build

cat <<'EOF'

Setup complete.

Next steps:
1. Verify Codex CLI authentication works on this machine.
2. Start the bot with: npm start
EOF
