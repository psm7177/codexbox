#!/usr/bin/env bash
set -euo pipefail

REPO_HTTPS_URL="${REPO_HTTPS_URL:-https://github.com/psm7177/codexbox.git}"
REPO_DIR="${REPO_DIR:-codexbox}"
REPO_BRANCH="${REPO_BRANCH:-master}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_command git
require_command bash

if [[ -d "$REPO_DIR/.git" ]]; then
  echo "Updating existing checkout in $REPO_DIR..."
  git -C "$REPO_DIR" fetch origin "$REPO_BRANCH"
  git -C "$REPO_DIR" checkout "$REPO_BRANCH"
  git -C "$REPO_DIR" pull --ff-only origin "$REPO_BRANCH"
else
  echo "Cloning $REPO_HTTPS_URL into $REPO_DIR..."
  git clone --branch "$REPO_BRANCH" "$REPO_HTTPS_URL" "$REPO_DIR"
fi

cd "$REPO_DIR"
bash scripts/setup-linux.sh
