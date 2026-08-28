#!/usr/bin/env bash
# scripts/update-oracle.sh
# Aggiorna un'installazione esistente: pull, npm ci, next build, restart.
# Uso: sudo bash scripts/update-oracle.sh [branch]

set -euo pipefail

BRANCH="${1:-main}"

if [ "$(id -u)" -ne 0 ]; then
    echo "ERRORE: esegui come root (sudo bash $0)" >&2
    exit 1
fi

if [ ! -d /home/ubuntu/paramount-stremio ]; then
    echo "ERRORE: installazione non trovata in /home/ubuntu/paramount-stremio" >&2
    echo "       esegui prima: sudo bash scripts/install-oracle.sh" >&2
    exit 1
fi

cd /home/ubuntu/paramount-stremio

echo "==> Fetch + reset su origin/${BRANCH}"
sudo -u addon git fetch --depth 1 origin "${BRANCH}"
sudo -u addon git checkout "${BRANCH}"
sudo -u addon git reset --hard "origin/${BRANCH}"

echo "==> npm ci"
sudo -u addon HOME=/home/ubuntu/paramount-stremio npm ci --no-audit --no-fund

echo "==> next build"
sudo -u addon HOME=/home/ubuntu/paramount-stremio env NODE_ENV=production npx next build

echo "==> Restart servizio"
systemctl restart paramount-stremio
sleep 2
systemctl is-active --quiet paramount-stremio.service && echo "✅ Servizio ATTIVO" || {
    echo "❌ Servizio NON attivo. Controlla: sudo journalctl -u paramount-stremio -n 50"
    exit 1
}
