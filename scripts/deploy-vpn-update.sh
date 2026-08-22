#!/usr/bin/env bash
# scripts/deploy-vpn-update.sh
#
# One-shot deploy sul VPS Oracle Cloud (o qualsiasi docker host) per
# applicare l'ultimo commit del repo, ribuildare l'immagine e
# installare/aggiornare il watcher systemd che riavvia gluetun
# automaticamente ad ogni cambio credenziali dall'UI.
#
# Da eseguire sull'host (con sudo):
#   sudo bash scripts/deploy-vpn-update.sh
#
# Prerequisiti: deploy-docker.sh già eseguito (Docker + repo in
# /opt/paramount-stremio).

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/paramount-stremio}"
cd "${APP_DIR}"

if [ "$(id -u)" -ne 0 ]; then
    echo "ERRORE: esegui come root (sudo bash $0)" >&2
    exit 1
fi

if [ ! -d .git ]; then
    echo "ERRORE: ${APP_DIR} non è un repo git. Esegui prima scripts/deploy-docker.sh." >&2
    exit 1
fi

echo "==> [1/4] Pull ultimo main"
git fetch --depth 1 origin main
git checkout main
git reset --hard origin/main

echo "==> [2/4] Rebuild + restart addon (mantiene profilo VPN spento finché non configuri)"
docker compose up -d --build

echo "==> [3/4] Crea dir vpn-data se mancante (per gluetun.env)"
mkdir -p vpn-data
chmod 700 vpn-data || true

echo "==> [4/4] Installa/aggiorna watcher systemd per auto-restart gluetun"
bash scripts/install-gluetun-watcher.sh

echo ""
echo "================================================================"
echo "  ✅ Deploy VPN completato"
echo "================================================================"
echo ""
echo "Ora apri nel browser:"
echo "  https://para.khnum.duckdns.org/configure"
echo ""
echo "Vai alla card 🌐 VPN / Proxy → tab 🔐 Login Proton:"
echo "  - Username: tuo_username+pmp"
echo "  - Password: password OpenVPN/IKEv2 da account.protonvpn.com"
echo "  - Country:  United States (default)"
echo "  - Click    Save"
echo ""
echo "Dopo 3-5 secondi il tunnel OpenVPN è attivo. Verifica con:"
echo "  docker logs --tail 50 gluetun | grep -i 'vpn is up\\|public ip'"
echo ""
echo "Test live:"
echo "  Clicca 🧪 Test connection nella stessa card."
echo "================================================================"
