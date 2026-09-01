#!/bin/sh
set -e

# Inject runtime environment variables into the SPA.
# We use JSON.stringify-equivalent serialization (via jq) to safely escape
# env var values — the heredoc approach is vulnerable to shell injection if
# the values contain quotes or braces.
#
# jq is a required dependency (installed in the Dockerfile). We fail closed
# if it is missing rather than falling back to unsafe manual escaping, which
# previously missed newlines/CR/null and allowed JS injection.

OPEN_LIVE_URL="${OPEN_LIVE_URL:-}"
OSC_PAT="${OSC_PAT:-}"

if ! command -v jq > /dev/null 2>&1; then
  echo "docker-entrypoint.sh: fatal: jq is required but not installed" >&2
  exit 1
fi

# Safe: jq --arg passes values as literals, never interpolated
printf 'window._env_ = %s;\n' \
  "$(jq -n --arg u "$OPEN_LIVE_URL" --arg p "$OSC_PAT" \
    '{OPEN_LIVE_URL: $u, OSC_PAT: $p}')" \
  > /usr/share/nginx/html/env-config.js

# Render the nginx config from the template, tightening the CSP connect-src so
# the SPA can only reach the origins it actually talks to:
#   - 'self'                              static assets + /env-config.js
#   - $OPEN_LIVE_URL (https)              open-live REST API
#   - wss/ws origin of $OPEN_LIVE_URL     open-live controller WebSocket
#                                         (src derives ws(s) from the same origin)
#   - https://token.svc.prod.osaas.io     OSC SAT token exchange (hardcoded in src/lib/sat.ts)
# When OPEN_LIVE_URL is unset we cannot know the exact backend host, so we fall
# back to the OSC deployment origins rather than a bare wss:/https: wildcard.
PORT="${PORT:-8080}"
TOKEN_ORIGIN="https://token.svc.prod.osaas.io"
if [ -n "$OPEN_LIVE_URL" ]; then
  # Derive the WebSocket scheme/origin from the backend URL (https->wss, http->ws),
  # mirroring src/lib/base.ts + useControllerWs.ts (BASE.replace(/^http/, 'ws')).
  BACKEND_WS="$(printf '%s' "$OPEN_LIVE_URL" | sed -e 's|^https://|wss://|' -e 's|^http://|ws://|')"
  CSP_CONNECT_SRC="'self' $OPEN_LIVE_URL $BACKEND_WS $TOKEN_ORIGIN"
else
  CSP_CONNECT_SRC="'self' wss://*.osaas.io https://*.osaas.io"
fi

sed -e "s|%PORT%|$PORT|g" \
    -e "s|%CSP_CONNECT_SRC%|$CSP_CONNECT_SRC|g" \
  /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf

exec "$@"
