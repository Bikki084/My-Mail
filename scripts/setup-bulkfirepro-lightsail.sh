#!/usr/bin/env bash
# Single Lightsail instance cutover for bulkfirepro.com
#
# Instance: Ubuntu-1 (Mumbai) — public IPv4 13.203.176.51
# Domain DNS (Lightsail): A @ → 13.203.176.51, CNAME www → bulkfirepro.com
#
# Run ON the Lightsail instance (browser SSH or ssh ubuntu@13.203.176.51):
#   cd ~/mymail && git pull && bash scripts/setup-bulkfirepro-lightsail.sh
#
# Requires: .env.local with Supabase + SMTP_ENCRYPTION_KEY (+ REDIS_URL for queue)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "${SCRIPT_DIR}/.."

export BULK_DOMAIN="bulkfirepro.com"
export LIGHTSAIL_PUBLIC_IP="13.203.176.51"

echo ""
echo "=== BulkProFire — single Lightsail instance (${LIGHTSAIL_PUBLIC_IP}) ==="
echo "    Domain: https://${BULK_DOMAIN}"
echo ""

if [[ ! -f .env.local ]]; then
  echo "ERROR: .env.local missing in $(pwd)"
  echo "Copy from .env.example and fill Supabase + SMTP_ENCRYPTION_KEY first."
  exit 1
fi

ensure_env() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" .env.local 2>/dev/null; then
    if grep -q "^${key}=.*bulkprofire" .env.local 2>/dev/null; then
      sed -i.bak "s|^${key}=.*|${key}=${value}|" .env.local
      echo "   updated ${key} (was bulkprofire.com)"
    else
      echo "   ${key} already set"
    fi
  else
    echo "${key}=${value}" >> .env.local
    echo "   appended ${key}"
  fi
}

echo "1) Ensure production domain in .env.local..."
ensure_env "NEXT_PUBLIC_APP_URL" "https://${BULK_DOMAIN}"
ensure_env "MAILER_PUBLIC_URL" "https://${BULK_DOMAIN}"
ensure_env "DKIM_DOMAIN" "${BULK_DOMAIN}"

echo ""
echo "2) HTTPS + nginx for ${BULK_DOMAIN}..."
if [[ "$(id -u)" -eq 0 ]]; then
  BULK_DOMAIN="${BULK_DOMAIN}" bash "${SCRIPT_DIR}/setup-https.sh"
else
  sudo BULK_DOMAIN="${BULK_DOMAIN}" bash "${SCRIPT_DIR}/setup-https.sh"
fi

echo ""
echo "3) Deploy app (PM2 web + worker)..."
bash "${SCRIPT_DIR}/deploy-production.sh"

echo ""
echo "4) Health checks..."
if curl -sf --connect-timeout 5 "http://127.0.0.1:3000/api/health" >/dev/null; then
  echo "   OK  http://127.0.0.1:3000/api/health"
else
  echo "   FAIL local :3000 — run: pm2 logs mymail-web --lines 40"
fi

if curl -sf --connect-timeout 8 "https://${BULK_DOMAIN}/api/health" >/dev/null 2>&1; then
  echo "   OK  https://${BULK_DOMAIN}/api/health"
else
  echo "   WARN https://${BULK_DOMAIN}/api/health (DNS may still propagate — wait up to 24h)"
  echo "        Direct IP probe:"
  curl -sI --connect-timeout 5 -H "Host: ${BULK_DOMAIN}" "http://${LIGHTSAIL_PUBLIC_IP}/api/health" | head -3 || true
fi

cat <<EOF

============================================================
Single-instance configuration complete.

Lightsail DNS zone for ${BULK_DOMAIN}:
  A     @    ${LIGHTSAIL_PUBLIC_IP}
  CNAME www  ${BULK_DOMAIN}

Supabase → Authentication → URL Configuration:
  Site URL: https://${BULK_DOMAIN}
  Redirect: https://${BULK_DOMAIN}/auth/update-password

SendGrid DNS (Lightsail → ${BULK_DOMAIN}) — required for inbox:
  TXT  @    v=spf1 include:sendgrid.net ~all
  CNAME em*, s1._domainkey, s2._domainkey → copy from SendGrid Sender Authentication
  Run: bash scripts/fix-bulkfirepro-deliverability.sh  (checks DNS + redeploys)

SendGrid Event Webhook URL:
  https://${BULK_DOMAIN}/api/webhooks/email-events

Open: https://${BULK_DOMAIN}/login
============================================================
EOF
