#!/usr/bin/env bash
# Fix bulkprofire.com deliverability: env vars, DNS checklist, Brevo SMTP sanity.
# Run ON Lightsail: cd ~/mymail && git pull && bash scripts/fix-bulkprofire-deliverability.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "${SCRIPT_DIR}/.."

DOMAIN="${BULK_DOMAIN:-bulkprofire.com}"
PUBLIC_IP="${LIGHTSAIL_PUBLIC_IP:-13.203.176.51}"
SPF_VALUE="v=spf1 include:spf.brevo.com ~all"

echo ""
echo "=== BulkProFire deliverability fix (${DOMAIN}) ==="
echo ""

if [[ ! -f .env.local ]]; then
  echo "ERROR: .env.local missing in $(pwd)"
  exit 1
fi

ensure_env() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" .env.local 2>/dev/null; then
    if grep -q "^${key}=.*bulkfirepro" .env.local 2>/dev/null; then
      sed -i.bak "s|^${key}=.*|${key}=${value}|" .env.local
      echo "   updated ${key} (was old domain)"
    else
      echo "   ${key} already set"
    fi
  else
    echo "${key}=${value}" >> .env.local
    echo "   appended ${key}"
  fi
}

echo "1) Ensure production mail env in .env.local..."
ensure_env "NEXT_PUBLIC_APP_URL" "https://${DOMAIN}"
ensure_env "MAILER_PUBLIC_URL" "https://${DOMAIN}"
ensure_env "DKIM_DOMAIN" "${DOMAIN}"
ensure_env "MAILER_POSTAL_ADDRESS" "BulkProFire, India"

echo ""
echo "2) Check DNS (public resolvers)..."
check_dns() {
  local name="$1"
  local type="$2"
  local url="https://dns.google/resolve?name=${name}&type=${type}"
  local data
  data="$(curl -sf "$url" | node -e "
    let j=''; process.stdin.on('data',d=>j+=d); process.stdin.on('end',()=>{
      const o=JSON.parse(j);
      const a=o.Answer&&o.Answer[0]&&o.Answer[0].data;
      console.log(a||'MISSING');
    });
  " 2>/dev/null || echo "MISSING")"
  if [[ "$data" == "MISSING" ]]; then
    echo "   FAIL  ${name} (${type})"
    return 1
  fi
  echo "   OK    ${name} → ${data}"
  return 0
}

FAIL=0
check_dns "${DOMAIN}" "TXT" || FAIL=1
check_dns "_dmarc.${DOMAIN}" "TXT" || FAIL=1
check_dns "brevo1._domainkey.${DOMAIN}" "CNAME" || FAIL=1
check_dns "brevo2._domainkey.${DOMAIN}" "CNAME" || FAIL=1
check_dns "mail.${DOMAIN}" "CNAME" || FAIL=1
check_dns "r.mail.${DOMAIN}" "CNAME" || FAIL=1

SPF_OK=0
TXT_ALL="$(curl -sf "https://dns.google/resolve?name=${DOMAIN}&type=TXT" | node -e "
  let j=''; process.stdin.on('data',d=>j+=d); process.stdin.on('end',()=>{
    const o=JSON.parse(j);
    (o.Answer||[]).forEach(a=>console.log(a.data||''));
  });
" 2>/dev/null || true)"
if echo "$TXT_ALL" | grep -q "spf1"; then
  echo "   OK    SPF TXT on ${DOMAIN}"
  SPF_OK=1
else
  echo "   FAIL  SPF missing on ${DOMAIN} — add TXT @ : ${SPF_VALUE}"
  FAIL=1
fi

echo ""
echo "3) Redeploy app (one-click unsubscribe + From domain)..."
bash "${SCRIPT_DIR}/deploy-production.sh"

cat <<EOF

============================================================
Deliverability checklist

IN LIGHTSAIL DNS (${DOMAIN}) — add if missing:

  TXT  @         ${SPF_VALUE}
       (keep existing brevo-code TXT — multiple TXT on @ is OK)

  CNAME mail     → copy from Brevo Domains page
  CNAME r.mail   → copy from Brevo Domains page
  CNAME img.mail → copy from Brevo Domains page

IN BREVO:
  SMTP host: smtp-relay.brevo.com:587
  Login:     your *@smtp-brevo.com login (NOT noreply@)
  Password:  SMTP key (Settings → SMTP & API)
  From:      noreply@${DOMAIN}  (verified sender)
  Security → Authorized IPs → add ${PUBLIC_IP}

IN THE APP:
  Delete any SMTP row using 127.0.0.1:25 or @gmail.com for bulk sends.
  Use Brevo SMTP only for campaigns.

WARM-UP (new domain — required):
  Start 20–50 emails/day to engaged inboxes; ramp over 2–4 weeks.
  100% spam on seed tests is normal until reputation builds.

VERIFY:
  Send test → Gmail → Show original → spf=pass dkim=pass dmarc=pass
  Or use https://www.mail-tester.com (aim 9+/10)
============================================================
EOF

if [[ "$FAIL" -ne 0 ]]; then
  echo ""
  echo "WARN: Some DNS records are still missing — fix in Lightsail, wait 30 min, re-run this script."
  exit 1
fi

echo ""
echo "DNS looks good. If mail still hits spam, warm up volume and check mail-tester.com."
