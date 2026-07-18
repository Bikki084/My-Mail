#!/usr/bin/env bash
# Keep bulkfirepro.com online: if the app is down, restart PM2 (+ optional IP restore).
# Installed as a cron job by scripts/install-site-reliability.sh
#
# Safe to run repeatedly. Logs to ~/mymail/logs/site-watchdog.log
set -uo pipefail

APP_DIR="${APP_DIR:-$HOME/mymail}"
cd "$APP_DIR" || exit 0

LOG_DIR="${APP_DIR}/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="${LOG_DIR}/site-watchdog.log"
LOCK_FILE="${LOG_DIR}/site-watchdog.lock"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
PUBLIC_URL="${PUBLIC_URL:-https://bulkfirepro.com/api/health}"

log() {
  echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') $*" >>"$LOG_FILE"
}

# Avoid overlapping runs (cron + manual).
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  exit 0
fi

# Keep log file small (~last ~500 lines).
if [[ -f "$LOG_FILE" ]] && [[ "$(wc -l <"$LOG_FILE" 2>/dev/null || echo 0)" -gt 800 ]]; then
  tail -n 400 "$LOG_FILE" >"${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "$LOG_FILE"
fi

health_ok() {
  curl -sf --connect-timeout 3 --max-time 8 "$HEALTH_URL" >/dev/null 2>&1
}

if health_ok; then
  exit 0
fi

log "WARN local health failed — attempting recovery"

# 1) Ensure Redis (worker/stack depends on it; cheap to check).
if command -v redis-cli >/dev/null 2>&1; then
  if ! redis-cli ping 2>/dev/null | grep -qi PONG; then
    log "Redis down — starting redis-server"
    sudo systemctl start redis-server 2>/dev/null || sudo service redis-server start 2>/dev/null || true
  fi
fi

# 2) Re-attach primary Lightsail IP if AWS rotation left the site unreachable.
if [[ -f "${APP_DIR}/package.json" ]] && command -v npm >/dev/null 2>&1; then
  if ! curl -sf --connect-timeout 4 --max-time 8 "$PUBLIC_URL" >/dev/null 2>&1; then
    log "Public health failed — ensuring primary Lightsail IP"
    npm run lightsail:ensure-primary >>"$LOG_FILE" 2>&1 || true
  fi
fi

# 3) Restart web if build exists.
if [[ ! -f "${APP_DIR}/.next/BUILD_ID" ]]; then
  log "ERROR .next/BUILD_ID missing — cannot auto-recover (run bash scripts/pm2-fix-web.sh)"
  exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
  log "ERROR pm2 not installed"
  exit 1
fi

if pm2 describe mymail-web >/dev/null 2>&1; then
  log "Restarting mymail-web"
  pm2 restart mymail-web --update-env >>"$LOG_FILE" 2>&1 || true
else
  log "Starting ecosystem (mymail-web missing)"
  pm2 start "${APP_DIR}/ecosystem.config.cjs" >>"$LOG_FILE" 2>&1 || true
fi

# Worker helps campaigns but is not required for the public site.
if pm2 describe mymail-worker >/dev/null 2>&1; then
  WORKER_STATUS="$(pm2 jlist 2>/dev/null | node -e "
    const apps = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    const app = apps.find((a) => a.name === 'mymail-worker');
    console.log(app?.pm2_env?.status || 'missing');
  " 2>/dev/null || echo missing)"
  if [[ "$WORKER_STATUS" == "stopped" || "$WORKER_STATUS" == "errored" ]]; then
    log "Restarting mymail-worker (status=${WORKER_STATUS})"
    pm2 restart mymail-worker --update-env >>"$LOG_FILE" 2>&1 || true
  fi
fi

pm2 save >/dev/null 2>&1 || true

# 4) Wait for recovery.
for i in 1 2 3 4 5 6 7 8 9 10; do
  if health_ok; then
    log "OK recovered after ${i} probe(s)"
    exit 0
  fi
  sleep 2
done

log "ERROR still unhealthy after restart — check: pm2 logs mymail-web --lines 40"
exit 1
