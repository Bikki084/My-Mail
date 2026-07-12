#!/usr/bin/env bash
# Fix 502 Bad Gateway on bulkfirepro.com (nginx up, app on :3000 down).
#   cd ~/mymail && git pull && bash scripts/fix-502.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo ""
echo "=== Fix 502 (bulkfirepro.com) ==="
echo ""

if [[ ! -f .env.local ]]; then
  echo "ERROR: .env.local missing in $(pwd)"
  exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "ERROR: pm2 not installed. Run: npm i -g pm2"
  exit 1
fi

if [[ ! -f .next/BUILD_ID ]]; then
  echo "No production build — running full rebuild (pm2-fix-web)..."
  exec bash scripts/pm2-fix-web.sh
fi

echo "1) Restart mymail-web..."
bash scripts/restart-web.sh

echo ""
echo "2) Reload nginx (if installed)..."
if command -v nginx >/dev/null 2>&1; then
  sudo nginx -t 2>&1 && sudo systemctl reload nginx 2>/dev/null || sudo service nginx reload 2>/dev/null || true
fi

echo ""
echo "=== Site should be back — open https://bulkfirepro.com/client ==="
echo ""
