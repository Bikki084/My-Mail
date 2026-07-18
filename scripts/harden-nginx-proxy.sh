#!/usr/bin/env bash
# Fix intermittent 502s from nginx:
#  - "upstream sent too big header" (small proxy buffers)
#  - duplicate gzip on; breaking nginx -t / reload
#  - thin Certbot SSL proxy block missing timeouts
#
#   sudo bash scripts/harden-nginx-proxy.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "${SCRIPT_DIR}/.."

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: run with sudo: sudo bash scripts/harden-nginx-proxy.sh"
  exit 1
fi

PROXY_SNIPPET="/etc/nginx/snippets/bulkfirepro-proxy.conf"
GZIP_CONF="/etc/nginx/conf.d/bulkfirepro-compression.conf"

echo ""
echo "=== Harden nginx proxy (anti-502) ==="
echo ""

mkdir -p /etc/nginx/snippets

cat > "${PROXY_SNIPPET}" <<'EOF'
# Shared upstream settings for Next.js on :3000 (BulkFirePro)
proxy_pass http://127.0.0.1:3000;
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_set_header Host $host;
proxy_set_header Accept-Encoding "";
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_cache_bypass $http_upgrade;

# Large Set-Cookie / RSC headers from Next.js otherwise cause 502:
#   "upstream sent too big header while reading response header from upstream"
proxy_buffer_size 128k;
proxy_buffers 8 128k;
proxy_busy_buffers_size 256k;
proxy_temp_file_write_size 256k;

proxy_connect_timeout 10s;
proxy_send_timeout 300s;
proxy_read_timeout 300s;

# If Next is briefly restarting, retry once instead of hard 502.
proxy_next_upstream error timeout http_502 http_503;
proxy_next_upstream_tries 2;
proxy_next_upstream_timeout 10s;
EOF

chmod 644 "${PROXY_SNIPPET}"
echo "1) Wrote ${PROXY_SNIPPET}"

# Fix duplicate gzip on; — Ubuntu nginx.conf already has `gzip on;`
if [[ -f "${GZIP_CONF}" ]]; then
  if grep -qE '^\s*gzip on;' "${GZIP_CONF}"; then
    sed -i 's/^\s*gzip on;/# gzip on;  # already enabled in nginx.conf — duplicate breaks nginx -t/' "${GZIP_CONF}"
    echo "2) Removed duplicate gzip on from ${GZIP_CONF}"
  else
    echo "2) Compression conf OK (no duplicate gzip on)"
  fi
else
  echo "2) No compression conf — skipping"
fi

patch_site() {
  local site="$1"
  [[ -f "$site" ]] || return 0

  # Backup once per day name.
  cp -a "$site" "${site}.bak.$(date +%Y%m%d)" 2>/dev/null || true

  # Replace the location / { ... } proxy block with an include of our snippet.
  # Use python for reliable multi-line rewrite across Certbot/custom layouts.
  python3 - "$site" "${PROXY_SNIPPET}" <<'PY'
import pathlib, re, sys
site = pathlib.Path(sys.argv[1])
snippet = sys.argv[2]
text = site.read_text(encoding="utf-8")
replacement = (
    "    location / {\n"
    f"        include {snippet};\n"
    "    }"
)
new, n = re.subn(
    r"location\s+/\s*\{(?:[^{}]|\{[^{}]*\})*\}",
    replacement,
    text,
    count=0,
    flags=re.S,
)
if n == 0:
    print(f"   WARN: no location / block found in {site}")
else:
    site.write_text(new, encoding="utf-8")
    print(f"   Patched {n} location / block(s) in {site}")
PY
}

echo "3) Patching site configs..."
for site in /etc/nginx/sites-available/bulkfirepro /etc/nginx/sites-available/bulkfirepro.com; do
  patch_site "$site"
done

echo ""
echo "4) Test + reload nginx..."
nginx -t
systemctl reload nginx

echo ""
echo "=== nginx hardened ==="
echo "Probe: curl -I https://bulkfirepro.com/"
echo ""
