#!/bin/sh
set -e

# Write runtime env vars to env-config.js.
# OSC_PAT is intentionally excluded — secrets must never reach the browser.
# sed escapes backslashes and double-quotes so the URL value is valid JSON.
_url=$(printf '%s' "${OPEN_LIVE_URL:-}" | sed 's/\\/\\\\/g; s/"/\\"/g')
printf 'window._env_ = {"OPEN_LIVE_URL":"%s"};\n' "$_url" > /usr/share/nginx/html/env-config.js

exec "$@"
