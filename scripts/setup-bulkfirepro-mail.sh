#!/usr/bin/env bash
# Configure Postfix on this Lightsail VPS for bulkfirepro.com (local relay on 127.0.0.1:25).
# Run on the server: sudo bash scripts/setup-bulkfirepro-mail.sh
set -euo pipefail

DOMAIN="${MAIL_DOMAIN:-bulkfirepro.com}"
FROM="${MAIL_FROM:-noreply@${DOMAIN}}"

echo "==> Setting up Postfix for ${DOMAIN} (From: ${FROM})"

if ! command -v postfix >/dev/null 2>&1; then
  echo "Installing Postfix..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  echo "postfix postfix/main_mailer_type select Internet Site" | debconf-set-selections
  echo "postfix postfix/mailname string ${DOMAIN}" | debconf-set-selections
  apt-get install -y postfix mailutils
fi

postconf -e "myhostname = ${DOMAIN}"
postconf -e "mydomain = ${DOMAIN}"
postconf -e "myorigin = \$mydomain"
postconf -e "inet_interfaces = loopback-only"
postconf -e "inet_protocols = ipv4"
postconf -e "mynetworks = 127.0.0.0/8 [::1]/128"
postconf -e "smtpd_relay_restrictions = permit_mynetworks,reject"
postconf -e "smtp_tls_security_level = may"

systemctl enable postfix
systemctl restart postfix

echo ""
echo "==> Checking port 25..."
if ss -tlnp | grep -q ':25 '; then
  echo "OK: Postfix listening on port 25"
else
  echo "FAIL: nothing on port 25 — check: journalctl -u postfix -n 30"
  exit 1
fi

echo ""
echo "==> Local SMTP test..."
if command -v node >/dev/null 2>&1 && [ -f package.json ]; then
  node -e "
const nodemailer = require('nodemailer');
nodemailer.createTransport({ host: '127.0.0.1', port: 25, secure: false, ignoreTLS: true })
  .verify().then(() => console.log('OK: nodemailer verify passed'))
  .catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
" || true
fi

cat <<EOF

============================================================
Postfix is ready for the MyMail app.

NEXT — in the app (https://${DOMAIN}/client → SMTP Configuration):

  Host:     127.0.0.1
  Port:     25
  Username: ${FROM}
  Password: (any — not used for local Postfix)
  Secure:   OFF
  → Test SMTP → Save SMTP

NEXT — .env.local on this server (from Deliverability page):

  DKIM_DOMAIN=${DOMAIN}
  DKIM_KEY_SELECTOR=mail
  DKIM_PRIVATE_KEY="..."   # copy from /client/deliverability
  MAILER_PUBLIC_URL=https://${DOMAIN}
  MAILER_POSTAL_ADDRESS=BulkFire Pro, Your City, Country

  npm run build && pm2 restart mymail-web mymail-worker

Remove old Gmail SMTP rows in the app (delete from Saved SMTP list).

AWS may block OUTBOUND port 25 to Gmail/Yahoo. If mail does not deliver,
request removal: https://aws.amazon.com/forms/ec2-email-limit-rdns-request
Or use Brevo SMTP on port 587 instead of Postfix for delivery.
============================================================
EOF
