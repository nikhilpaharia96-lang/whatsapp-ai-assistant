#!/usr/bin/env bash
# One-time server prep for Ubuntu (e.g. Oracle Cloud Always Free). Run as the normal user:
#   bash scripts/server-setup.sh
set -euo pipefail

echo "Architecture: $(uname -m)"

# 1. Docker
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
  echo "Docker installed. Log out and back in once so the docker group applies, then re-run this script."
  exit 0
fi

# 2. 2 GB swap (safety net against out-of-memory kills)
if ! swapon --show | grep -q .; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  echo "Swap enabled."
fi

# 3. Can this CPU run every image? (Oracle free tier is ARM64)
ok=1
for img in postgres:16-alpine redis:7-alpine n8nio/n8n:latest evoapicloud/evolution-api:v2.3.7; do
  if docker manifest inspect "$img" 2>/dev/null | grep -q "\"architecture\": \"$(dpkg --print-architecture)\""; then
    echo "OK   $img supports $(dpkg --print-architecture)"
  else
    echo "FAIL $img has no $(dpkg --print-architecture) build (or registry unreachable)"; ok=0
  fi
done
[[ $ok -eq 1 ]] || { echo "Fix the images above before starting the stack."; exit 1; }
echo "Server ready. Next: bash scripts/setup.sh, then cd docker && docker compose --env-file ../.env up -d"
