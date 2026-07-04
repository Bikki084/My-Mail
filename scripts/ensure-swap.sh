#!/usr/bin/env bash
# Add 2GB swap on small Lightsail instances so `next build` does not OOM.
# Run once on the server:  sudo bash scripts/ensure-swap.sh
set -euo pipefail

SWAP_FILE="${SWAP_FILE:-/swapfile}"
SWAP_GB="${SWAP_GB:-2}"

if swapon --show 2>/dev/null | grep -q .; then
  echo "Swap already active:"
  swapon --show
  free -h
  exit 0
fi

echo "Creating ${SWAP_GB}G swap at ${SWAP_FILE} (needs sudo)..."
if [[ ! -f "${SWAP_FILE}" ]]; then
  if command -v fallocate >/dev/null 2>&1; then
    sudo fallocate -l "${SWAP_GB}G" "${SWAP_FILE}"
  else
    sudo dd if=/dev/zero of="${SWAP_FILE}" bs=1M count=$((SWAP_GB * 1024)) status=progress
  fi
fi

sudo chmod 600 "${SWAP_FILE}"
sudo mkswap "${SWAP_FILE}"
sudo swapon "${SWAP_FILE}"

if ! grep -q "${SWAP_FILE}" /etc/fstab 2>/dev/null; then
  echo "${SWAP_FILE} none swap sw 0 0" | sudo tee -a /etc/fstab
fi

echo ""
echo "Swap enabled:"
free -h
