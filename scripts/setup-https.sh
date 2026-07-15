#!/usr/bin/env bash
# Enable HTTPS (Let's Encrypt) for bulkfirepro.com on Ubuntu Lightsail + nginx.
# Run ON the server (once, or after nginx breaks):
#   cd ~/mymail && git pull && sudo bash scripts/setup-https.sh
#
# Requires: DNS A record for bulkfirepro.com → this server's public IP, port 80 open.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "${SCRIPT_DIR}/.."

DOMAIN="${BULK_DOMAIN:-bulkfirepro.com}"
WWW_DOMAIN="www.${DOMAIN}"
EMAIL="${CERTBOT_EMAIL:-}"
APP_PORT="${APP_PORT:-3000}"
NGINX_SITE="/etc/nginx/sites-available/${DOMAIN}"
NGINX_ENABLED="/etc/nginx/sites-enabled/${DOMAIN}"

echo ""
echo "=== Setup HTTPS for ${DOMAIN} ==="
echo ""

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: run with sudo: sudo bash scripts/setup-https.sh"
  exit 1
fi

echo "1) Install nginx + certbot (if missing)..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y nginx certbot python3-certbot-nginx

echo ""
echo "2) Ensure app responds on 127.0.0.1:${APP_PORT}..."
if ! curl -sf --connect-timeout 5 "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null; then
  echo "   WARN: app not responding on :${APP_PORT} — start PM2 first:"
  echo "   cd ~/mymail && bash scripts/restart-web.sh"
  echo "   Continuing anyway (nginx can still be configured)..."
fi

echo ""
echo "3) Write nginx site config..."
cat > "${NGINX_SITE}" <<EOF
# ${DOMAIN} — managed by scripts/setup-https.sh
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} ${WWW_DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header Accept-Encoding "";
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
}
EOF

ln -sf "${NGINX_SITE}" "${NGINX_ENABLED}"
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
nginx -t
systemctl enable nginx
systemctl reload nginx

echo ""
echo "4) Obtain / renew Let's Encrypt certificate..."
CERTBOT_ARGS=(-d "${DOMAIN}" -d "${WWW_DOMAIN}" --nginx --redirect --agree-tos --non-interactive)
if [[ -n "${EMAIL}" ]]; then
  CERTBOT_ARGS+=(--email "${EMAIL}")
else
  CERTBOT_ARGS+=(--register-unsafely-without-email)
  echo "   Tip: set CERTBOT_EMAIL=you@example.com for renewal notices."
fi

if ! certbot "${CERTBOT_ARGS[@]}"; then
  echo ""
  echo "ERROR: certbot failed. Common causes:"
  echo "  • DNS A record for ${DOMAIN} does not point to this server's public IP"
  echo "  • Port 80 blocked (Lightsail firewall / ufw)"
  echo "  • Domain not propagated yet (wait 5–30 min after GoDaddy DNS change)"
  echo ""
  echo "Check: curl -I http://${DOMAIN}/api/health"
  exit 1
fi

echo ""
echo "5) Reload nginx + verify HTTPS..."
nginx -t
systemctl reload nginx

echo ""
echo "5b) Enable gzip/brotli compression for JSON API responses..."
bash "${SCRIPT_DIR}/enable-nginx-compression.sh"

echo ""
echo "6) Auto-renewal timer..."
systemctl enable certbot.timer 2>/dev/null || true
systemctl start certbot.timer 2>/dev/null || true
certbot renew --dry-run 2>/dev/null || echo "   (dry-run skipped — cert is new)"

if curl -sf --connect-timeout 10 "https://${DOMAIN}/api/health" >/dev/null; then
  echo "   OK — https://${DOMAIN}/api/health"
else
  echo "   WARN: HTTPS probe failed from this server — check firewall / DNS externally."
fi

echo ""
cat <<EOF
============================================================
HTTPS enabled for ${DOMAIN}

Browser: https://${DOMAIN}

Add to ~/mymail/.env.local (then redeploy):
  NEXT_PUBLIC_APP_URL=https://${DOMAIN}
  MAILER_PUBLIC_URL=https://${DOMAIN}

Supabase Dashboard → Authentication → URL Configuration:
  Site URL: https://${DOMAIN}
  Redirect URLs: https://${DOMAIN}/auth/update-password

Then:
  cd ~/mymail && bash scripts/deploy-production.sh
============================================================
EOF
echo ""
