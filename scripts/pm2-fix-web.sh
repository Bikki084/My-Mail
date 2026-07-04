#!/usr/bin/env bash
# Fix mymail-web on small Lightsail VPS (502 / OOM during build / crash loop).
#   cd ~/mymail && git pull && bash scripts/pm2-fix-web.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo ""
echo "=== Fix mymail-web (build + PM2) ==="
echo ""

if [[ ! -f .env.local ]]; then
  echo "ERROR: .env.local missing in $(pwd)"
  exit 1
fi

echo "1) Stop PM2..."
pm2 delete all 2>/dev/null || true
sleep 2

echo ""
echo "2) Ensure swap (prevents 'JavaScript heap out of memory' during build)..."
if swapon --show 2>/dev/null | grep -q .; then
  echo "   swap already on"
  free -h | head -3
else
  echo "   enabling 2GB swap (sudo password may be required)..."
  sudo bash scripts/ensure-swap.sh || {
    echo "   WARN: could not enable swap — build may still OOM on very small instances"
  }
fi

echo ""
echo "3) Install deps..."
npm install

echo ""
echo "4) Production build (low-memory VPS mode)..."
export LOW_MEMORY_BUILD=1
export NODE_BUILD_HEAP_MB=1024
npm run build:prod

if [[ ! -f .next/BUILD_ID ]]; then
  echo ""
  echo "ERROR: build did not produce .next/BUILD_ID"
  echo "Try: sudo bash scripts/ensure-swap.sh && LOW_MEMORY_BUILD=1 NODE_BUILD_HEAP_MB=1024 npm run build:prod"
  exit 1
fi

echo ""
echo "5) Start PM2..."
pm2 start ecosystem.config.cjs
pm2 save

echo ""
echo "6) Wait for /api/health..."
for i in $(seq 1 15); do
  if curl -sf --connect-timeout 3 http://127.0.0.1:3000/api/health >/dev/null; then
    echo "   OK"
    break
  fi
  echo "   waiting... ($i/15)"
  sleep 2
  if [[ $i -eq 15 ]]; then
    pm2 logs mymail-web --lines 30 --nostream || true
    exit 1
  fi
done

echo ""
pm2 status
echo ""
echo "=== Done — open https://bulkfirepro.com ==="
echo ""
