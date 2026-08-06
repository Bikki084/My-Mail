#!/usr/bin/env bash
# Run ON the Lightsail server (SSH) when bulkfirepro.com / :3000 times out.
#   chmod +x scripts/recover-site.sh && ./scripts/recover-site.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo ""
echo "=== MyMail site recovery ==="
echo ""

echo "1) Re-attach primary Lightsail static IP (website URL)..."
if npm run lightsail:ensure-primary 2>&1; then
  echo "   Primary IP attach OK"
else
  echo "   WARN: lightsail:ensure-primary failed — attach StaticIp-1 manually in AWS console"
fi

echo ""
echo "2) PM2 process status..."
if ! command -v pm2 >/dev/null 2>&1; then
  echo "   ERROR: pm2 not found. Install: npm i -g pm2"
  exit 1
fi
pm2 status || true

echo ""
echo "3) Restart app if port 3000 is not listening..."
if ss -tlnp 2>/dev/null | grep -q ':3000' || netstat -tlnp 2>/dev/null | grep -q ':3000'; then
  echo "   Port 3000 already listening"
else
  echo "   Port 3000 down — restarting PM2..."
  pm2 restart all 2>/dev/null || pm2 start npm --name mymail -- start
  sleep 3
fi

echo ""
echo "4) Local HTTP probe (127.0.0.1:3000)..."
if curl -sf --connect-timeout 5 http://127.0.0.1:3000/api/health >/dev/null; then
  echo "   OK — app responds locally (/api/health)"
else
  echo "   FAIL — app not responding. Restarting PM2..."
  pm2 restart mymail-web 2>/dev/null || pm2 restart all 2>/dev/null || pm2 start ecosystem.config.cjs
  sleep 4
  if curl -sf --connect-timeout 5 http://127.0.0.1:3000/api/health >/dev/null; then
    echo "   OK after restart"
  else
    echo "   Still failing. Run: pm2 logs mymail-web --lines 50"
    pm2 logs mymail-web --lines 25 --nostream 2>/dev/null || true
    exit 1
  fi
fi

echo ""
echo "5) Nginx (if installed)..."
if command -v nginx >/dev/null 2>&1; then
  sudo nginx -t 2>&1 && sudo systemctl reload nginx 2>/dev/null || sudo service nginx reload 2>/dev/null || true
  if curl -sf --connect-timeout 5 -H "Host: bulkfirepro.com" http://127.0.0.1/api/health >/dev/null 2>&1; then
    echo "   OK — nginx → app proxy works"
  else
    echo "   WARN — nginx up but proxy may not reach :3000 (502 in browser). Check: sudo nginx -T | grep proxy_pass"
  fi
else
  echo "   nginx not installed — skip"
fi

echo ""
echo "6) OS firewall (ufw) — allow web ports..."
if command -v ufw >/dev/null 2>&1; then
  sudo ufw allow 3000/tcp comment 'MyMail app' 2>/dev/null || true
  sudo ufw allow 80/tcp comment 'HTTP' 2>/dev/null || true
  sudo ufw allow 443/tcp comment 'HTTPS' 2>/dev/null || true
  sudo ufw status 2>/dev/null | head -20 || true
else
  echo "   ufw not installed — skip"
fi

echo ""
echo "7) Public IP on this instance:"
curl -sf --connect-timeout 5 http://checkip.amazonaws.com 2>/dev/null || echo "   (could not probe — check Lightsail Networking tab)"

echo ""
echo "=== Done ==="
echo "Test in browser:"
echo "  http://$(curl -sf --connect-timeout 3 http://checkip.amazonaws.com 2>/dev/null || echo 'YOUR_IP'):3000/client"
echo ""
echo "If still unreachable from outside:"
echo "  • Lightsail → Ubuntu-1 → Networking → attach StaticIp-1 (13.203.176.51)"
echo "  • Lightsail → Ubuntu-1 → Networking → Firewall → allow TCP 3000 (and 80/443 if using Nginx)"
echo "  • Confirm instance status is Running (not Stopped)"
echo ""
