#!/usr/bin/env bash
# Ensure Redis + PM2 web + PM2 worker are all running (fixes "no email worker connected").
#   cd ~/mymail && bash scripts/ensure-email-stack.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo ""
echo "=== Ensure email stack (Redis + web + worker) ==="
echo ""

if [[ ! -f .env.local ]]; then
  echo "ERROR: .env.local missing"
  exit 1
fi

REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"

echo "1) Redis..."
if command -v redis-cli >/dev/null 2>&1; then
  if redis-cli ping 2>/dev/null | grep -qi PONG; then
    echo "   OK — Redis responds (REDIS_URL=${REDIS_URL})"
  else
    echo "   Starting redis-server..."
    sudo systemctl enable redis-server 2>/dev/null || true
    sudo systemctl start redis-server 2>/dev/null || sudo service redis-server start 2>/dev/null || true
    sleep 2
    if redis-cli ping 2>/dev/null | grep -qi PONG; then
      echo "   OK after start"
    else
      echo "   WARN: Redis not responding — install: sudo apt install -y redis-server"
    fi
  fi
else
  echo "   WARN: redis-cli not found — sudo apt install -y redis-server"
fi

echo ""
echo "2) PM2 processes..."
if ! pm2 describe mymail-web >/dev/null 2>&1 || ! pm2 describe mymail-worker >/dev/null 2>&1; then
  if [[ -f .next/BUILD_ID ]]; then
    pm2 start ecosystem.config.cjs
  else
    echo "   No .next build — run: bash scripts/pm2-fix-web.sh"
    exit 1
  fi
else
  pm2 restart ecosystem.config.cjs
fi
pm2 save

echo ""
echo "3) Wait for web health..."
for i in $(seq 1 20); do
  if curl -sf --connect-timeout 2 http://127.0.0.1:3000/api/health >/dev/null; then
    echo "   OK"
    break
  fi
  sleep 2
  if [[ $i -eq 20 ]]; then
    echo "   FAIL — pm2 logs mymail-web --nostream --lines 30"
    pm2 logs mymail-web --nostream --lines 30 2>/dev/null || true
    exit 1
  fi
done

echo ""
echo "4) Wait for email worker heartbeat on Redis (up to 30s)..."
for i in $(seq 1 15); do
  if redis-cli GET mymail:email-worker:heartbeat 2>/dev/null | grep -qE '^[0-9]+$'; then
    echo "   OK — worker heartbeat in Redis"
    break
  fi
  HEALTH=$(curl -sf --connect-timeout 3 http://127.0.0.1:3000/api/health 2>/dev/null || echo "")
  if echo "$HEALTH" | grep -q '"workerConnected":true'; then
    echo "   OK — worker connected (health API)"
    break
  fi
  echo "   waiting... ($i/15)"
  sleep 2
  if [[ $i -eq 15 ]]; then
    echo "   FAIL — worker not registered. Logs:"
    pm2 logs mymail-worker --nostream --lines 40 2>/dev/null || true
    exit 1
  fi
done

echo ""
pm2 status
echo ""
echo "=== Email stack ready — you can send campaigns ==="
echo ""
