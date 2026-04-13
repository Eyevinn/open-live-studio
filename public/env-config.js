// Default runtime environment config for local development.
// In production containers this file is overwritten by docker-entrypoint.sh
// which injects values from the OSC parameter store at container startup.
window._env_ = {
  OPEN_LIVE_URL: '',
  OSC_PAT: '',
}
