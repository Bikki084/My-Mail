#!/usr/bin/env bash
# Puppeteer / Chromium system libraries for Ubuntu (AWS Lightsail 22.04+).
# Run on the VPS: sudo bash scripts/install-chromium-deps.sh
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Re-run with sudo: sudo bash scripts/install-chromium-deps.sh"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq

# Shared libraries required by Chromium/Puppeteer (fixes libatk-1.0.so.0 etc.)
apt-get install -y --no-install-recommends \
  ca-certificates \
  fonts-liberation \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libgbm1 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxrandr2 \
  libxrender1 \
  libxss1 \
  libxtst6 \
  wget \
  xdg-utils

if apt-cache show chromium-browser &>/dev/null; then
  apt-get install -y --no-install-recommends chromium-browser
elif apt-cache show chromium &>/dev/null; then
  apt-get install -y --no-install-recommends chromium
fi

CHROME="$(command -v chromium-browser || command -v chromium || true)"
if [[ -n "$CHROME" ]]; then
  echo ""
  echo "Chromium: $CHROME"
  echo "Add to ~/mymail/.env.local then: pm2 restart mymail-worker"
  echo "PUPPETEER_EXECUTABLE_PATH=$CHROME"
else
  echo "Libraries installed. Puppeteer may use its bundled Chrome after npm ci."
fi
