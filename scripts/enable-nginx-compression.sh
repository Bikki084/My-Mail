#!/usr/bin/env bash
# Enable gzip (and brotli when available) for nginx — compresses JSON/text API
# responses in transit. Safe to re-run (idempotent).
#
# On the server:
#   cd ~/mymail && git pull && sudo bash scripts/enable-nginx-compression.sh
#
# After HTTPS setup:
#   sudo bash scripts/setup-https.sh   # also installs compression
set -euo pipefail

cd "$(dirname "$0")/.."

DOMAIN="${BULK_DOMAIN:-bulkfirepro.com}"
NGINX_SITE="/etc/nginx/sites-available/${DOMAIN}"
GZIP_CONF="/etc/nginx/conf.d/bulkfirepro-compression.conf"
BROTLI_CONF="/etc/nginx/conf.d/bulkfirepro-compression-brotli.conf"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: run with sudo: sudo bash scripts/enable-nginx-compression.sh"
  exit 1
fi

if ! command -v nginx >/dev/null 2>&1; then
  echo "ERROR: nginx not installed. Run: sudo bash scripts/setup-https.sh"
  exit 1
fi

echo ""
echo "=== Enable nginx response compression (${DOMAIN}) ==="
echo ""

echo "1) Install gzip snippet..."
cp scripts/nginx-compression.conf "${GZIP_CONF}"
chmod 644 "${GZIP_CONF}"

echo ""
echo "2) Optional brotli (when nginx brotli module is installed)..."
if nginx -V 2>&1 | grep -qi brotli || compgen -G "/etc/nginx/modules-enabled/*brotli*" >/dev/null 2>&1; then
  cat > "${BROTLI_CONF}" <<'EOF'
# Brotli — only loaded when the module exists (see enable-nginx-compression.sh)
brotli on;
brotli_comp_level 5;
brotli_min_length 256;
brotli_types
    application/json
    application/javascript
    application/xml
    text/css
    text/javascript
    text/plain
    text/xml
    image/svg+xml;
EOF
  echo "   brotli enabled"
else
  rm -f "${BROTLI_CONF}"
  echo "   brotli module not found — gzip only (install libnginx-mod-http-brotli-* to add)"
fi

echo ""
echo "3) Ensure upstream receives uncompressed bodies (prevent double compression)..."
if [[ -f "${NGINX_SITE}" ]]; then
  if grep -q 'proxy_set_header Accept-Encoding "";' "${NGINX_SITE}"; then
    echo "   Accept-Encoding strip already present in ${NGINX_SITE}"
  else
    # Insert after proxy_set_header Host line inside location /
    sed -i '/proxy_set_header Host \$host;/a\        proxy_set_header Accept-Encoding "";' "${NGINX_SITE}"
    echo "   Added proxy_set_header Accept-Encoding \"\" to ${NGINX_SITE}"
  fi
else
  echo "   WARN: ${NGINX_SITE} not found — run setup-https.sh first; gzip still applies globally."
fi

echo ""
echo "4) Test and reload nginx..."
nginx -t
systemctl reload nginx

echo ""
echo "5) Quick probe (local)..."
if curl -sf --connect-timeout 5 "http://127.0.0.1:3000/api/health" >/dev/null 2>&1; then
  bash scripts/verify-compression.sh "http://127.0.0.1/api/health" || true
else
  echo "   App not on :3000 — run verify after deploy: bash scripts/verify-compression.sh"
fi

echo ""
echo "=== Compression enabled ==="
echo "Verify externally: bash scripts/verify-compression.sh https://${DOMAIN}/api/health"
echo ""
