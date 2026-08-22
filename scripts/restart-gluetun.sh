#!/usr/bin/env bash
# scripts/restart-gluetun.sh
#
# Riavvia il container gluetun dopo che l'addon ha aggiornato il config
# WireGuard sul volume condiviso.
#
# Funzionamento:
#   1. Controlla se il profilo `vpn` è attivo (container gluetun esiste).
#   2. Se sì → `docker compose --profile vpn restart gluetun`.
#   3. Attende che il tunnel sia UP (healthcheck passa).
#
# Da installare come hook systemd-path (opzionale) o come cron @reboot + al boot.
#
# Installazione hook automatico (opzionale):
#   sudo tee /etc/systemd/system/gluetun-restart.path <<'EOF'
#   [Unit]
#   Description=Watch WireGuard config for gluetun
#
#   [Path]
#   PathExists=/opt/paramount-stremio/.data/vpn/wireguard/proton.conf
#
#   [Install]
#   WantedBy=multi-user.target
#   EOF
#
#   sudo tee /etc/systemd/system/gluetun-restart.service <<'EOF'
#   [Unit]
#   Description=Restart gluetun after config change
#
#   [Service]
#   Type=oneshot
#   ExecStart=/opt/paramount-stremio/scripts/restart-gluetun.sh
#   EOF
#
#   sudo systemctl enable --now gluetun-restart.path
#

set -euo pipefail

ADDON_DIR="${ADDON_DIR:-/opt/paramount-stremio}"
CONF_FILE="${CONF_FILE:-${ADDON_DIR}/.data/vpn/wireguard/proton.conf}"

cd "${ADDON_DIR}"

echo "==> Checking gluetun container (profile vpn)…"
if ! docker compose --profile vpn ps --services 2>/dev/null | grep -q '^gluetun$'; then
    echo "❌ Container gluetun non presente. Avvialo con:"
    echo "   cd ${ADDON_DIR} && docker compose --profile vpn up -d --build gluetun"
    exit 1
fi

echo "==> Restarting gluetun…"
docker compose --profile vpn restart gluetun

echo "==> Waiting for tunnel healthcheck (max 60s)…"
for i in $(seq 1 30); do
    HEALTH=$(docker inspect --format='{{.State.Health.Status}}' gluetun 2>/dev/null || echo "starting")
    if [ "$HEALTH" = "healthy" ]; then
        echo "✅ Gluetun is healthy after ${i} attempts."
        echo "==> Verifying VPN IP…"
        docker exec gluetun sh -c 'wget -qO- https://ipinfo.io/json || echo "(ipinfo fetch failed)"' || true
        exit 0
    fi
    sleep 2
done

echo "⚠️ Gluetun non healthy dopo 60s. Log recenti:"
docker logs --tail=50 gluetun || true
exit 1
