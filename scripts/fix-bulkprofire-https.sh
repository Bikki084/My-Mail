#!/usr/bin/env bash
# One-shot fix: bulkprofire.com HTTPS on Lightsail Ubuntu-1 @ 13.203.176.51
#
# Fixes:
#   - Removes old bulkfirepro.com nginx vhosts (cert name mismatch)
#   - Issues Let's Encrypt for bulkprofire.com (www only if DNS OK)
#   - Reloads nginx + PM2
#
# DNS (Lightsail zone for bulkprofire.com, if using Lightsail nameservers):
#   A     @    13.203.176.51
#   CNAME www  bulkprofire.com   (must NOT point to 2.57.91.91)
#
# Run ON the server:
#   cd ~/mymail && sudo bash scripts/fix-bulkprofire-https.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "${SCRIPT_DIR}/.."

DOMAIN="bulkprofire.com"
WWW="www.${DOMAIN}"
EXPECTED_IP="${LIGHTSAIL_PUBLIC_IP:-13.203.176.51}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: run with sudo: sudo bash scripts/fix-bulkprofire-https.sh"
  exit 1
fi

echo ""
echo "=== Fix HTTPS for ${DOMAIN} (expected IP ${EXPECTED_IP}) ==="
echo ""

resolve_v4() {
  dig +short "$1" A 2>/dev/null | grep -E '^[0-9.]+$' | head -1 || true
}

APEX_IP="$(resolve_v4 "${DOMAIN}")"
WWW_IP="$(resolve_v4 "${WWW}")"

echo "DNS check:"
echo "  ${DOMAIN}     → ${APEX_IP:-<none>}"
echo "  ${WWW} → ${WWW_IP:-<none>} (CNAME targets count as A lookup here)"
echo ""

if [[ "${APEX_IP}" != "${EXPECTED_IP}" ]]; then
  echo "ERROR: ${DOMAIN} must resolve to ${EXPECTED_IP} before certbot can succeed."
  echo "       Fix Lightsail Domains & DNS (or Hostinger if nameservers point there)."
  exit 1
fi

INCLUDE_WWW=1
if [[ -n "${WWW_IP}" && "${WWW_IP}" != "${EXPECTED_IP}" ]]; then
  echo "WARN: ${WWW} resolves to ${WWW_IP}, not ${EXPECTED_IP}."
  echo "      Cert will be issued for ${DOMAIN} only (skip www until DNS fixed)."
  INCLUDE_WWW=0
fi

echo "1) Remove old nginx sites (bulkfirepro + duplicates)..."
for old in bulkfirepro bulkfirepro.com "${DOMAIN}" "${WWW}"; do
  rm -f "/etc/nginx/sites-enabled/${old}" 2>/dev/null || true
done
# Keep sites-available backups but disable conflicting old domain
for old in bulkfirepro bulkfirepro.com; do
  if [[ -f "/etc/nginx/sites-available/${old}" ]]; then
    mv "/etc/nginx/sites-available/${old}" "/etc/nginx/sites-available/${old}.disabled.$(date +%Y%m%d)" 2>/dev/null || true
  fi
done

echo ""
echo "2) Write nginx vhost for ${DOMAIN}..."
bash "${SCRIPT_DIR}/harden-nginx-proxy.sh" || true

NGINX_SITE="/etc/nginx/sites-available/${DOMAIN}"
cat > "${NGINX_SITE}" <<EOF
# ${DOMAIN} — fix-bulkprofire-https.sh
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN}${INCLUDE_WWW:+ ${WWW}};

    location /.well-known/acme-challenge/ {
        root /var/www/html;
        try_files \$uri =404;
    }

    location / {
        include /etc/nginx/snippets/bulkprofire-proxy.conf;
    }
}
EOF

mkdir -p /var/www/html
ln -sf "${NGINX_SITE}" "/etc/nginx/sites-enabled/${DOMAIN}"
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
nginx -t
systemctl reload nginx

echo ""
echo "3) Let's Encrypt certificate..."
CERTBOT_ARGS=(-d "${DOMAIN}" --nginx --redirect --agree-tos --non-interactive)
if [[ "${INCLUDE_WWW}" -eq 1 ]]; then
  CERTBOT_ARGS=(-d "${DOMAIN}" -d "${WWW}" --nginx --redirect --agree-tos --non-interactive)
fi
if [[ -n "${CERTBOT_EMAIL:-}" ]]; then
  CERTBOT_ARGS+=(--email "${CERTBOT_EMAIL}")
else
  CERTBOT_ARGS+=(--register-unsafely-without-email)
fi

if ! certbot "${CERTBOT_ARGS[@]}"; then
  echo ""
  echo "ERROR: certbot failed. Ensure port 80 is open in Lightsail Networking."
  exit 1
fi

nginx -t && systemctl reload nginx

echo ""
echo "4) Restart app (PM2) as ubuntu user..."
if id ubuntu &>/dev/null; then
  sudo -u ubuntu bash -lc "cd ${PWD} && bash scripts/restart-web.sh" || true
fi

if curl -sf --connect-timeout 10 "https://${DOMAIN}/api/health" >/dev/null; then
  echo ""
  echo "OK — https://${DOMAIN}/api/health"
else
  echo ""
  echo "WARN: HTTPS probe failed — check: curl -sI https://${DOMAIN}/api/health"
fi

cat <<EOF

============================================================
Done. Open: https://${DOMAIN}/login

If ${WWW} was skipped, fix DNS in Lightsail:
  CNAME www → ${DOMAIN}
Then: sudo certbot --nginx -d ${DOMAIN} -d ${WWW} --expand
============================================================
EOF
