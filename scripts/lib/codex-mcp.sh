install_codex_mcp_server() {
  local server_name="${CODEX_DISCORD_MCP_SERVER_NAME:-codex-discord-tools}"
  local server_script="$ROOT_DIR/scripts/mcp-discord-server.mjs"

  require_command codex

  if [[ ! -f "$server_script" ]]; then
    echo "Missing MCP server script: $server_script" >&2
    exit 1
  fi

  if codex mcp get "$server_name" >/dev/null 2>&1; then
    codex mcp remove "$server_name" >/dev/null 2>&1 || true
  fi

  codex mcp add "$server_name" -- node "$server_script"

  echo "Registered Codex MCP server: $server_name"
}
