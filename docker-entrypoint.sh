#!/bin/sh
set -e

# Inject runtime environment variables into the SPA.
# Vite bakes VITE_* vars at build time, so we use a runtime-loaded script
# (/env-config.js) that docker-entrypoint.sh regenerates on every container
# start from the current process environment.

# Use jq to safely encode env vars as JSON (handles quotes, newlines, special chars)
cat > /usr/share/nginx/html/env-config.js <<EOF
window._env_ = $(jq -n --arg open_live_url "${OPEN_LIVE_URL:-}" --arg osc_pat "${OSC_PAT:-}" '{OPEN_LIVE_URL: $open_live_url, OSC_PAT: $osc_pat}');
EOF

exec "$@"
