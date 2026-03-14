can_use_system_service() {
  if [[ "$EUID" -eq 0 ]]; then
    return 0
  fi

  if ! command -v sudo >/dev/null 2>&1; then
    return 1
  fi

  if sudo -n true >/dev/null 2>&1; then
    return 0
  fi

  has_interactive_tty
}

run_as_root() {
  if [[ "$EUID" -eq 0 ]]; then
    "$@"
    return
  fi

  require_command sudo

  if sudo -n true >/dev/null 2>&1; then
    sudo "$@"
    return
  fi

  if has_interactive_tty; then
    sudo "$@" </dev/tty
    return
  fi

  echo "System-level service installation requires sudo access. Re-run from an interactive terminal or set SYSTEMD_SERVICE_SCOPE=user." >&2
  exit 1
}

resolve_service_scope() {
  case "$SYSTEMD_SERVICE_SCOPE" in
    auto)
      if can_use_system_service; then
        printf 'system'
      else
        printf 'user'
      fi
      ;;
    system|user)
      printf '%s' "$SYSTEMD_SERVICE_SCOPE"
      ;;
    *)
      echo "Invalid SYSTEMD_SERVICE_SCOPE: $SYSTEMD_SERVICE_SCOPE (expected auto, system, or user)" >&2
      exit 1
      ;;
  esac
}

print_service_summary() {
  local scope="$1"
  local service_name="$2"
  local unit_path="$3"
  local service_user="$4"
  local npm_bin="$5"
  local codex_bin="$6"
  local status_command=""
  local logs_command=""

  if [[ "$scope" == "system" ]]; then
    status_command="sudo systemctl status $service_name --no-pager"
    logs_command="sudo journalctl -u $service_name -f"
  else
    status_command="systemctl --user status $service_name --no-pager"
    logs_command="journalctl --user -u $service_name -f"
  fi

  cat <<EOF

Systemd service installed.

- Scope: $scope
- Service name: $service_name
- Service file: $unit_path
- Run as user: $service_user
- Working directory: $ROOT_DIR
- Start command: $npm_bin start
- Codex binary: $codex_bin

Useful commands:
$status_command
$logs_command
EOF
}

ensure_user_linger() {
  local service_user="$1"

  if ! is_truthy "$SYSTEMD_ENABLE_LINGER"; then
    return 0
  fi

  if loginctl show-user "$service_user" -p Linger 2>/dev/null | grep -q 'Linger=yes'; then
    return 0
  fi

  if ! can_use_system_service; then
    echo "Warning: could not enable linger for $service_user. The user service will stop on logout until you run: sudo loginctl enable-linger $service_user" >&2
    return 0
  fi

  if ( run_as_root loginctl enable-linger "$service_user" ); then
    echo "Enabled linger for user service persistence across logout: $service_user"
    return 0
  fi

  echo "Warning: could not enable linger for $service_user. The user service will stop on logout until you run: sudo loginctl enable-linger $service_user" >&2
  return 0
}

install_system_service() {
  local service_name="$SYSTEMD_SERVICE_NAME"
  local service_user="${SYSTEMD_SERVICE_USER:-${SUDO_USER:-$(id -un)}}"
  local service_group="${SYSTEMD_SERVICE_GROUP:-}"
  local service_home=""
  local npm_bin=""
  local codex_bin=""
  local unit_path="/etc/systemd/system/${service_name}.service"
  local temp_unit=""
  local unit_exists=0
  local path_entries=""

  require_command systemctl

  if [[ ! -d /run/systemd/system ]]; then
    echo "systemd is not available on this host. Set INSTALL_SYSTEMD_SERVICE=0 to skip service registration." >&2
    exit 1
  fi

  if ! id -u "$service_user" >/dev/null 2>&1; then
    echo "Unknown systemd service user: $service_user" >&2
    exit 1
  fi

  if [[ -z "$service_group" ]]; then
    service_group="$(id -gn "$service_user")"
  fi

  service_home="$(resolve_user_home "$service_user")"
  if [[ -z "$service_home" ]]; then
    echo "Unable to resolve home directory for service user: $service_user" >&2
    exit 1
  fi

  npm_bin="$(command -v npm)"
  codex_bin="$(command -v codex)"
  path_entries="$(dirname "$npm_bin"):$(dirname "$codex_bin"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  temp_unit="$(mktemp)"

  cat >"$temp_unit" <<EOF
[Unit]
Description=Codexbox
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$service_user
Group=$service_group
WorkingDirectory=$ROOT_DIR
Environment=HOME=$service_home
Environment=PATH=$path_entries
Environment=CODEX_APP_SERVER_BIN=$codex_bin
ExecStart=$npm_bin start
Restart=always
RestartSec=5
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
EOF

  if run_as_root test -f "$unit_path"; then
    unit_exists=1
  fi

  run_as_root install -m 0644 "$temp_unit" "$unit_path"
  rm -f "$temp_unit"

  run_as_root systemctl daemon-reload
  run_as_root systemctl enable "$service_name"

  if is_truthy "$SYSTEMD_ENABLE_NOW"; then
    if [[ "$unit_exists" -eq 1 ]]; then
      run_as_root systemctl restart "$service_name"
    else
      run_as_root systemctl start "$service_name"
    fi

    if ! run_as_root systemctl is-active --quiet "$service_name"; then
      echo "systemd service '$service_name' failed to start. Check logs with: sudo journalctl -u $service_name -n 100 --no-pager" >&2
      exit 1
    fi
  fi

  print_service_summary "system" "$service_name" "$unit_path" "$service_user" "$npm_bin" "$codex_bin"
}

install_user_service() {
  local service_name="$SYSTEMD_SERVICE_NAME"
  local current_user
  local service_user="${SYSTEMD_SERVICE_USER:-$(id -un)}"
  local service_home=""
  local npm_bin=""
  local codex_bin=""
  local unit_path=""
  local temp_unit=""
  local unit_exists=0
  local path_entries=""

  current_user="$(id -un)"
  if [[ "$service_user" != "$current_user" ]]; then
    echo "User-level service installation only supports the current user ($current_user). Use SYSTEMD_SERVICE_SCOPE=system for another account." >&2
    exit 1
  fi

  if ! systemctl --user is-active default.target >/dev/null 2>&1; then
    echo "A user systemd instance is not available. Re-run from a login session or set SYSTEMD_SERVICE_SCOPE=system." >&2
    exit 1
  fi

  service_home="$(resolve_user_home "$service_user")"
  if [[ -z "$service_home" ]]; then
    echo "Unable to resolve home directory for service user: $service_user" >&2
    exit 1
  fi

  npm_bin="$(command -v npm)"
  codex_bin="$(command -v codex)"
  path_entries="$(dirname "$npm_bin"):$(dirname "$codex_bin"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  unit_path="$service_home/.config/systemd/user/${service_name}.service"
  temp_unit="$(mktemp)"

  mkdir -p "$(dirname "$unit_path")"

  cat >"$temp_unit" <<EOF
[Unit]
Description=Codexbox
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$ROOT_DIR
Environment=HOME=$service_home
Environment=PATH=$path_entries
Environment=CODEX_APP_SERVER_BIN=$codex_bin
ExecStart=$npm_bin start
Restart=always
RestartSec=5
TimeoutStopSec=20

[Install]
WantedBy=default.target
EOF

  if [[ -f "$unit_path" ]]; then
    unit_exists=1
  fi

  install -m 0644 "$temp_unit" "$unit_path"
  rm -f "$temp_unit"

  systemctl --user daemon-reload
  systemctl --user enable "$service_name"

  if is_truthy "$SYSTEMD_ENABLE_NOW"; then
    if [[ "$unit_exists" -eq 1 ]]; then
      systemctl --user restart "$service_name"
    else
      systemctl --user start "$service_name"
    fi

    if ! systemctl --user is-active --quiet "$service_name"; then
      echo "user service '$service_name' failed to start. Check logs with: journalctl --user -u $service_name -n 100 --no-pager" >&2
      exit 1
    fi
  fi

  print_service_summary "user" "$service_name" "$unit_path" "$service_user" "$npm_bin" "$codex_bin"
  ensure_user_linger "$service_user"
}

install_systemd_service() {
  local service_scope=""

  service_scope="$(resolve_service_scope)"
  INSTALLED_SYSTEMD_SERVICE_SCOPE="$service_scope"
  if [[ "$service_scope" == "system" ]]; then
    install_system_service
  else
    install_user_service
  fi
}
