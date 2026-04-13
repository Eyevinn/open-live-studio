#!/bin/sh
set -e

# Inject runtime environment variables into the SPA.
# Vite bakes VITE_* vars at build time, so we use a runtime-loaded script
# (/env-config.js) that docker-entrypoint.sh regenerates on every container
# start from the current process environment.
cat > /usr/share/nginx/html/env-config.js <<EOF
window._env_ = {
  OPEN_LIVE_URL: "${OPEN_LIVE_URL:-}",
  OSC_PAT: "${OSC_PAT:-}",
};
EOF

exec "$@"
