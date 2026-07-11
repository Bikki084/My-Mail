#!/usr/bin/env bash
# Start or restart mymail-web when PM2 shows "stopped" or the site returns 502.
#   cd ~/mymail && bash scripts/restart-web.sh
set -euo pipefail
cd "$(dirname "$0")/.."

APP_WEB="mymail-web"
APP_WORKER="mymail-worker"

echo ""
echo "=== Restart mymail-web ==="
echo ""

if [[ ! -f .env.local ]]; then
  echo "ERROR: .env.local missing in $(pwd)"
  exit 1
fi

if [[ ! -f .next/BUILD_ID ]]; then
  echo "ERROR: No production build (.next/BUILD_ID missing)."
  echo "Run: bash scripts/pm2-fix-web.sh"
  exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "ERROR: pm2 not found. Install: npm i -g pm2"
  exit 1
fi

pm2_web_status() {
  pm2 jlist 2>/dev/null | node -e "
    const apps = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    const app = apps.find((a) => a.name === '${APP_WEB}');
    if (!app) { console.log('missing'); process.exit(0); }
    console.log(app.pm2_env?.status || 'unknown');
  " 2>/dev/null || echo "unknown"
}

WEB_STATUS="$(pm2_web_status)"
echo "1) Current ${APP_WEB} status: ${WEB_STATUS}"

if [[ "${WEB_STATUS}" == "missing" ]]; then
  echo "   Starting ecosystem..."
  pm2 start ecosystem.config.cjs
elif [[ "${WEB_STATUS}" == "stopped" || "${WEB_STATUS}" == "errored" ]]; then
  echo "   Deleting stopped process and starting fresh..."
  pm2 delete "${APP_WEB}" 2>/dev/null || true
  pm2 start ecosystem.config.cjs --only "${APP_WEB}"
else
  echo "   Reloading ${APP_WEB}..."
  pm2 reload "${APP_WEB}" --update-env || pm2 restart "${APP_WEB}" --update-env
fi

if pm2 describe "${APP_WORKER}" >/dev/null 2>&1; then
  WORKER_STATUS="$(pm2 jlist 2>/dev/null | node -e "
    const apps = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    const app = apps.find((a) => a.name === '${APP_WORKER}');
    console.log(app?.pm2_env?.status || 'missing');
  " 2>/dev/null || echo "unknown")"
  if [[ "${WORKER_STATUS}" == "stopped" || "${WORKER_STATUS}" == "errored" ]]; then
    pm2 restart "${APP_WORKER}" --update-env || pm2 start ecosystem.config.cjs --only "${APP_WORKER}"
  fi
fi

pm2 save

echo ""
echo "2) Wait for /api/health..."
for i in $(seq 1 20); do
  if curl -sf --connect-timeout 3 http://127.0.0.1:3000/api/health >/dev/null; then
    echo "   OK — site is up"
    break
  fi
  echo "   waiting... ($i/20)"
  sleep 2
  if [[ $i -eq 20 ]]; then
    echo ""
    echo "   FAIL — last logs:"
    pm2 logs "${APP_WEB}" --nostream --lines 40 2>/dev/null || true
    echo ""
    echo "If you see '.next/BUILD_ID missing', run: bash scripts/pm2-fix-web.sh"
    exit 1
  fi
done

echo ""
pm2 status
echo ""
echo "=== Done — https://bulkfirepro.com ==="
echo ""
