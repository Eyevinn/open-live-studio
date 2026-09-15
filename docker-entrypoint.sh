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

# NOTE: OSC_PAT is deliberately NOT injected here. The long-lived OSC PAT must
# never reach a browser-served asset (open-live-studio#10). The studio obtains a
# short-lived SAT at runtime from the open-live backend's server-side exchange
# endpoint (POST /api/v1/auth/token) instead — see src/lib/sat.ts.

if ! command -v jq > /dev/null 2>&1; then
  echo "docker-entrypoint.sh: fatal: jq is required but not installed" >&2
  exit 1
fi

# Safe: jq --arg passes values as literals, never interpolated.
# Only non-secret runtime config (the backend base URL) is exposed to the SPA.
printf 'window._env_ = %s;\n' \
  "$(jq -n --arg u "$OPEN_LIVE_URL" \
    '{OPEN_LIVE_URL: $u}')" \
  > /usr/share/nginx/html/env-config.js

# Render the nginx config from the template, tightening the CSP connect-src so
# the SPA can only reach the origins it actually talks to:
#   - 'self'                              static assets + /env-config.js
#   - $OPEN_LIVE_URL (https)              open-live REST API + SAT exchange
#                                         (POST /api/v1/auth/token)
#   - wss/ws origin of $OPEN_LIVE_URL     open-live controller WebSocket
#                                         (src derives ws(s) from the same origin)
# The studio no longer talks to the OSC token service directly — the PAT→SAT
# exchange now happens server-side on the open-live backend (open-live#228) — so
# token.svc.prod.osaas.io is no longer in connect-src.
# When OPEN_LIVE_URL is unset we cannot know the exact backend host, so we fall
# back to the OSC deployment origins rather than a bare wss:/https: wildcard.
PORT="${PORT:-8080}"
if [ -n "$OPEN_LIVE_URL" ]; then
  # Derive the WebSocket scheme/origin from the backend URL (https->wss, http->ws),
  # mirroring src/lib/base.ts + useControllerWs.ts (BASE.replace(/^http/, 'ws')).
  BACKEND_WS="$(printf '%s' "$OPEN_LIVE_URL" | sed -e 's|^https://|wss://|' -e 's|^http://|ws://|')"
  CSP_CONNECT_SRC="'self' $OPEN_LIVE_URL $BACKEND_WS"
else
  CSP_CONNECT_SRC="'self' wss://*.osaas.io https://*.osaas.io"
fi

sed -e "s|%PORT%|$PORT|g" \
    -e "s|%CSP_CONNECT_SRC%|$CSP_CONNECT_SRC|g" \
  /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf

exec "$@"
