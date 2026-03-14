require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

is_truthy() {
  case "${1,,}" in
    1|true|yes|on)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

prompt_value() {
  local prompt="$1"
  local value=""
  while [[ -z "$value" ]]; do
    if [[ -t 0 ]]; then
      read -r -p "$prompt" value
    elif [[ -r /dev/tty ]]; then
      read -r -p "$prompt" value </dev/tty
    else
      echo "Unable to prompt for input. Set DISCORD_TOKEN in the environment before running this script." >&2
      exit 1
    fi
  done
  printf '%s' "$value"
}

set_env_value() {
  local key="$1"
  local value="$2"

  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*$|${key}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"
  fi
}

get_env_value() {
  local key="$1"

  if [[ ! -f "$ENV_FILE" ]]; then
    return 0
  fi

  sed -n "s/^${key}=//p" "$ENV_FILE" | head -n 1
}

has_interactive_tty() {
  if [[ -t 0 || -t 1 || -t 2 ]]; then
    return 0
  fi
  return 1
}

resolve_user_home() {
  local user="$1"
  local home_dir=""

  if command -v getent >/dev/null 2>&1; then
    home_dir="$(getent passwd "$user" | cut -d: -f6)"
  fi

  if [[ -z "$home_dir" && -r /etc/passwd ]]; then
    home_dir="$(awk -F: -v name="$user" '$1 == name { print $6 }' /etc/passwd)"
  fi

  printf '%s' "$home_dir"
}
