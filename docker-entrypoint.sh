#!/bin/sh
set -e

# Inject runtime environment variables into the SPA.
# We use JSON.stringify-equivalent serialization (via jq) to safely escape
# env var values — the heredoc approach is vulnerable to shell injection if
# the values contain quotes or braces.
#
# nginx:alpine ships with jq available via the base image.
# If jq is not present, fall back to printf with manual hex-escaping.

OPEN_LIVE_URL="${OPEN_LIVE_URL:-}"
OSC_PAT="${OSC_PAT:-}"

if command -v jq > /dev/null 2>&1; then
  # Safe: jq --arg passes values as literals, never interpolated
  printf 'window._env_ = %s;\n' \
    "$(jq -n --arg u "$OPEN_LIVE_URL" --arg p "$OSC_PAT" \
      '{OPEN_LIVE_URL: $u, OSC_PAT: $p}')" \
    > /usr/share/nginx/html/env-config.js
else
  # Fallback: manual JSON encoding (escape backslash, double-quote, control chars)
  escape_json() {
    printf '%s' "$1" | sed \
      -e 's/\\/\\\\/g' \
      -e 's/"/\\"/g' \
      -e 's/	/\\t/g'
  }
  U="$(escape_json "$OPEN_LIVE_URL")"
  P="$(escape_json "$OSC_PAT")"
  printf 'window._env_ = {"OPEN_LIVE_URL":"%s","OSC_PAT":"%s"};\n' "$U" "$P" \
    > /usr/share/nginx/html/env-config.js
fi

# Generate nginx config, locking CSP connect-src to the backend origin when known.
# Falling back to broad wildcards only when OPEN_LIVE_URL is not set.
PORT="${PORT:-8080}"
if [ -n "$OPEN_LIVE_URL" ]; then
  BACKEND_WSS="$(printf '%s' "$OPEN_LIVE_URL" | sed 's|^https:|wss:|; s|^http:|ws:|')"
  CSP_CONNECT_SRC="'self' $OPEN_LIVE_URL $BACKEND_WSS https://token.svc.prod.osaas.io"
else
  CSP_CONNECT_SRC="'self' wss: https:"
fi
sed -e "s|%PORT%|$PORT|g" \
    -e "s|%CSP_CONNECT_SRC%|$CSP_CONNECT_SRC|g" \
  /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf

exec "$@"
