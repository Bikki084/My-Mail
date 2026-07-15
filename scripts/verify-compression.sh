#!/usr/bin/env bash
# Verify gzip/brotli negotiation for JSON API responses.
# Usage:
#   bash scripts/verify-compression.sh
#   bash scripts/verify-compression.sh https://bulkfirepro.com/api/health
set -euo pipefail

URL="${1:-https://bulkfirepro.com/api/health}"

echo ""
echo "=== Compression verify: ${URL} ==="
echo ""

if ! command -v curl >/dev/null 2>&1; then
  echo "ERROR: curl required"
  exit 1
fi

echo "A) Response without Accept-Encoding (baseline):"
BASE_HEADERS="$(mktemp)"
BASE_BODY="$(mktemp)"
curl -sS -D "${BASE_HEADERS}" -o "${BASE_BODY}" "${URL}" || {
  echo "   FAIL — could not reach ${URL}"
  rm -f "${BASE_HEADERS}" "${BASE_BODY}"
  exit 1
}
BASE_LEN="$(wc -c < "${BASE_BODY}" | tr -d ' ')"
BASE_CE="$(grep -i '^content-encoding:' "${BASE_HEADERS}" || true)"
echo "   body bytes: ${BASE_LEN}"
echo "   content-encoding: ${BASE_CE:-none}"

echo ""
echo "B) Response with Accept-Encoding: gzip, deflate, br"
ENC_HEADERS="$(mktemp)"
ENC_BODY="$(mktemp)"
curl -sS -D "${ENC_HEADERS}" -o "${ENC_BODY}" \
  -H "Accept-Encoding: gzip, deflate, br" \
  "${URL}"
WIRE_LEN="$(wc -c < "${ENC_BODY}" | tr -d ' ')"
ENC_CE="$(grep -i '^content-encoding:' "${ENC_HEADERS}" || true)"
echo "   wire bytes (may be compressed): ${WIRE_LEN}"
echo "   content-encoding: ${ENC_CE:-none}"

echo ""
echo "C) Client parse test (--compressed auto-decompresses):"
PARSED="$(mktemp)"
if curl -sS --compressed -H "Accept-Encoding: gzip, deflate, br" "${URL}" > "${PARSED}"; then
  if node -e "
    const fs = require('fs');
    const t = fs.readFileSync('${PARSED}', 'utf8');
    JSON.parse(t);
    console.log('   JSON parse: OK');
  " 2>/dev/null; then
    :
  elif grep -q '"ok"' "${PARSED}" 2>/dev/null; then
    echo "   JSON parse: OK (grep fallback)"
  else
    echo "   WARN: response may not be JSON at this URL"
  fi
else
  echo "   FAIL — --compressed request failed"
  rm -f "${BASE_HEADERS}" "${BASE_BODY}" "${ENC_HEADERS}" "${ENC_BODY}" "${PARSED}"
  exit 1
fi

rm -f "${BASE_HEADERS}" "${BASE_BODY}" "${ENC_HEADERS}" "${ENC_BODY}" "${PARSED}"

if echo "${ENC_CE}" | grep -qiE 'gzip|br'; then
  if [[ "${WIRE_LEN}" -lt "${BASE_LEN}" ]] || [[ "${BASE_LEN}" -lt 256 ]]; then
    echo ""
    echo "OK — Content-Encoding negotiated; transfer size acceptable."
    exit 0
  fi
  echo ""
  echo "OK — Content-Encoding present (${ENC_CE})."
  exit 0
fi

if [[ "${BASE_LEN}" -lt 256 ]]; then
  echo ""
  echo "OK — Response smaller than gzip_min_length (256); compression may be skipped by design."
  exit 0
fi

echo ""
echo "WARN — No Content-Encoding header for a ${BASE_LEN}-byte response."
echo "Run on the server: sudo bash scripts/enable-nginx-compression.sh"
exit 1
