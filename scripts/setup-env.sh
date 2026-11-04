#!/usr/bin/env bash
# Writes the local env file with the Slack tokens, as KEY='value' lines (the format APP_ENV_FILE expects).
# Input is hidden and never echoed or stored in shell history.
# Usage: scripts/setup-env.sh [target-file]   (default: ~/secrets/ddslack/local.env)
set -euo pipefail

target="${1:-$HOME/secrets/ddslack/local.env}"

read_secret() {
  local label="$1" prefix="$2" value
  while true; do
    echo -n "$label > " >&2
    read -r -s value
    echo >&2
    if [[ "$value" == *"'"* ]]; then
      echo "Values containing a single quote are not supported. Try again." >&2
      continue
    fi
    if [[ "$value" == "$prefix"* ]]; then
      printf '%s' "$value"
      return
    fi
    echo "The value must start with $prefix. Try again." >&2
  done
}

bot_token="$(read_secret 'Bot User OAuth Token (xoxb-...)' 'xoxb-')"
app_token="$(read_secret 'App-Level Token with connections:write (xapp-...)' 'xapp-')"

umask 077
# A new directory is made private; an existing one (such as the repository) is left as it is.
if [[ ! -d "$(dirname "$target")" ]]; then
  mkdir -p "$(dirname "$target")"
  chmod 700 "$(dirname "$target")"
fi
printf "SLACK_BOT_TOKEN='%s'\nSLACK_APP_TOKEN='%s'\n" "$bot_token" "$app_token" > "$target"
chmod 600 "$target"
unset bot_token app_token

echo "$target created with 600 permissions."
