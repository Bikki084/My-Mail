#!/usr/bin/env bash
# Safe production deploy — keeps the site up while building, then swaps + reloads PM2.
#   cd ~/mymail && git pull && bash scripts/deploy-production.sh
#
# Why this exists: `pm2 delete all` or `pm2 restart` BEFORE `npm run build:prod` leaves
# nginx with nothing on :3000 for several minutes → 502 Bad Gateway.
set -euo pipefail
cd "$(dirname "$0")/.."

APP_WEB="mymail-web"
APP_WORKER="mymail-worker"
STAGING_DIR=".next-staging"
BACKUP_DIR=".next-backup"

echo ""
echo "=== Deploy production (minimal downtime) ==="
echo ""

if [[ ! -f .env.local ]]; then
  echo "ERROR: .env.local missing in $(pwd)"
  exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "ERROR: pm2 not found. Install: npm i -g pm2"
  exit 1
fi

echo "1) Ensure swap (prevents build OOM on small VPS)..."
if swapon --show 2>/dev/null | grep -q .; then
  echo "   swap already on"
else
  echo "   enabling 2GB swap (sudo password may be required)..."
  sudo bash scripts/ensure-swap.sh || {
    echo "   WARN: could not enable swap — build may OOM"
  }
fi

echo ""
echo "2) Install dependencies (site stays up)..."
npm install

echo ""
echo "3) Build to ${STAGING_DIR} (old site keeps serving .next)..."
rm -rf "${STAGING_DIR}"
export NEXT_DIST_DIR="${STAGING_DIR}"
export LOW_MEMORY_BUILD=1
export NODE_BUILD_HEAP_MB="${NODE_BUILD_HEAP_MB:-1024}"

if ! npm run build:prod; then
  echo ""
  echo "ERROR: build failed — production .next was NOT replaced; site should still be on the previous build."
  rm -rf "${STAGING_DIR}"
  exit 1
fi

if [[ ! -f "${STAGING_DIR}/BUILD_ID" ]]; then
  echo "ERROR: ${STAGING_DIR}/BUILD_ID missing after build"
  rm -rf "${STAGING_DIR}"
  exit 1
fi

echo ""
echo "4) Swap build (${STAGING_DIR} → .next)..."
rm -rf "${BACKUP_DIR}"
if [[ -d .next ]]; then
  mv .next "${BACKUP_DIR}"
fi
mv "${STAGING_DIR}" .next

echo ""
echo "5) Reload PM2 (graceful — only a few seconds of downtime)..."
if pm2 describe "${APP_WEB}" >/dev/null 2>&1; then
  WEB_STATUS="$(pm2 jlist 2>/dev/null | node -e "
    const apps = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    const app = apps.find((a) => a.name === '${APP_WEB}');
    console.log(app?.pm2_env?.status || 'stopped');
  " 2>/dev/null || echo "stopped")"
  if [[ "${WEB_STATUS}" == "online" ]]; then
    pm2 reload "${APP_WEB}" --update-env
  else
    pm2 delete "${APP_WEB}" 2>/dev/null || true
    pm2 start ecosystem.config.cjs --only "${APP_WEB}"
  fi
else
  echo "   ${APP_WEB} not running — starting ecosystem..."
  pm2 start ecosystem.config.cjs
fi

if pm2 describe "${APP_WORKER}" >/dev/null 2>&1; then
  pm2 reload "${APP_WORKER}" --update-env
fi
pm2 save

echo ""
echo "6) Wait for /api/health..."
for i in $(seq 1 25); do
  if curl -sf --connect-timeout 3 http://127.0.0.1:3000/api/health >/dev/null; then
    echo "   OK"
    break
  fi
  echo "   waiting... ($i/25)"
  sleep 2
  if [[ $i -eq 25 ]]; then
    echo "   FAIL — rolling back to previous .next"
    rm -rf .next
    if [[ -d "${BACKUP_DIR}" ]]; then
      mv "${BACKUP_DIR}" .next
      pm2 delete "${APP_WEB}" 2>/dev/null || true
      pm2 start ecosystem.config.cjs --only "${APP_WEB}" || pm2 start ecosystem.config.cjs
      pm2 save
      echo "   Rolled back — check logs: pm2 logs ${APP_WEB} --lines 40"
    else
      echo "   No backup — run: bash scripts/pm2-fix-web.sh"
    fi
    exit 1
  fi
done

rm -rf "${BACKUP_DIR}"

echo ""
pm2 status
echo ""
echo "=== Deploy complete — https://bulkfirepro.com ==="
echo ""
