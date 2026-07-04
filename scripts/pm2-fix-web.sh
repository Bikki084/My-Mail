#!/usr/bin/env bash
# Fix mymail-web crash loop (502 / PM2 errored). Run on the Lightsail server:
#   cd ~/mymail && git pull && bash scripts/pm2-fix-web.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo ""
echo "=== Fix mymail-web crash loop ==="
echo ""

if [[ ! -f .env.local ]]; then
  echo "ERROR: .env.local missing in $(pwd)"
  echo "Copy from .env.example and fill Supabase + SMTP_ENCRYPTION_KEY + REDIS_URL"
  exit 1
fi

echo "1) Stop crash loop..."
pm2 delete mymail-web 2>/dev/null || true
pm2 delete mymail-worker 2>/dev/null || true
sleep 2

echo ""
echo "2) Install deps..."
npm install

echo ""
echo "3) Production build..."
npm run build:prod

echo ""
echo "4) Start PM2 (new ecosystem — node runs start-prod.cjs directly)..."
pm2 start ecosystem.config.cjs
pm2 save

echo ""
echo "5) Wait for web to come up..."
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf --connect-timeout 3 http://127.0.0.1:3000/api/health >/dev/null; then
    echo "   OK — /api/health responds"
    break
  fi
  echo "   waiting... ($i/10)"
  sleep 3
  if [[ $i -eq 10 ]]; then
    echo "   FAIL — still not up. Logs:"
    pm2 logs mymail-web --lines 40 --nostream || true
    exit 1
  fi
done

echo ""
pm2 status
echo ""
echo "=== Done — test https://bulkfirepro.com ==="
echo ""
