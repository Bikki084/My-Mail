#!/usr/bin/env bash
# One-shot reliability install for Lightsail:
#  - harden nginx (buffers + gzip fix)
#  - PM2 start on reboot
#  - cron watchdog every minute
#
#   cd ~/mymail && git pull && bash scripts/install-site-reliability.sh
set -euo pipefail

cd "$(dirname "$0")/.."
APP_DIR="$(pwd)"

echo ""
echo "=== Install site reliability (anti-random-502) ==="
echo ""

if [[ ! -f .env.local ]]; then
  echo "ERROR: .env.local missing in ${APP_DIR}"
  exit 1
fi

if [[ ! -f .next/BUILD_ID ]]; then
  echo "ERROR: no production build. Run: bash scripts/pm2-fix-web.sh"
  exit 1
fi

echo "1) Harden nginx proxy (sudo)..."
if command -v nginx >/dev/null 2>&1; then
  sudo bash scripts/harden-nginx-proxy.sh
else
  echo "   WARN: nginx not installed — skip"
fi

echo ""
echo "2) Ensure swap..."
if ! swapon --show 2>/dev/null | grep -q .; then
  sudo bash scripts/ensure-swap.sh || true
else
  echo "   swap already on"
fi

echo ""
echo "3) PM2 processes online + save..."
if ! command -v pm2 >/dev/null 2>&1; then
  echo "ERROR: pm2 not found. Install: npm i -g pm2"
  exit 1
fi
bash scripts/ensure-email-stack.sh || bash scripts/restart-web.sh
pm2 save

echo ""
echo "4) PM2 startup on reboot..."
# Idempotent: generate systemd unit for this user.
STARTUP_CMD="$(pm2 startup systemd -u "$(whoami)" --hp "$HOME" 2>/dev/null | tail -n 1 || true)"
if echo "${STARTUP_CMD}" | grep -q "sudo "; then
  echo "   Running: ${STARTUP_CMD}"
  # shellcheck disable=SC2086
  eval ${STARTUP_CMD} || true
else
  # Fallback paste form from pm2.
  sudo env "PATH=$PATH" "$(command -v pm2)" startup systemd -u "$(whoami)" --hp "$HOME" || true
fi
pm2 save

echo ""
echo "5) Install cron watchdog (every minute)..."
chmod +x scripts/site-watchdog.sh
CRON_LINE="* * * * * APP_DIR=${APP_DIR} /bin/bash ${APP_DIR}/scripts/site-watchdog.sh >/dev/null 2>&1"
# Remove old watchdog lines, append fresh.
EXISTING="$(crontab -l 2>/dev/null || true)"
FILTERED="$(printf '%s\n' "${EXISTING}" | grep -v 'site-watchdog.sh' || true)"
{
  printf '%s\n' "${FILTERED}"
  printf '%s\n' "${CRON_LINE}"
} | grep -v '^$' | crontab -
echo "   crontab installed:"
crontab -l | grep site-watchdog || true

echo ""
echo "6) Smoke test watchdog once..."
bash scripts/site-watchdog.sh || true
if curl -sf --connect-timeout 5 http://127.0.0.1:3000/api/health >/dev/null; then
  echo "   OK — local health"
else
  echo "   WARN — local health still failing"
fi

echo ""
echo "=== Reliability installed ==="
echo "Watchdog log: ${APP_DIR}/logs/site-watchdog.log"
echo "If the site drops, it should self-heal within ~1 minute."
echo ""
