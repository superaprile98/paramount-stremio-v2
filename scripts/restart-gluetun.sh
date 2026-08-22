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

cd "${ADDON_DIR}"

echo "==> Ensuring gluetun container (profile vpn)…"
# `up -d` crea il container se non esiste ancora e lo ricrea se la config
# è cambiata. `restart` fallirebbe se il container non è mai stato avviato.
docker compose --profile vpn up -d gluetun

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
