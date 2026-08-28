#!/usr/bin/env bash
# scripts/restart-sing-box.sh
#
# Riavvia il container sing-box dopo che l'addon ha aggiornato il config
# (vpn-data/sing-box/config.json) dalla UI /configure.
#
# Funzionamento:
#   1. Crea un config.json placeholder se manca (il container sing-box
#      fallisce all'avvio se il file non esiste).
#   2. `docker compose --profile vpn up -d sing-box` (crea/ricrea il container).
#   3. Attende che il container sia healthy (porta 8888 in ascolto).
#
# Da installare come hook systemd-path (opzionale) o come cron @reboot + al boot.
#
# Installazione hook automatico (opzionale):
#   sudo tee /etc/systemd/system/sing-box-restart.path <<'EOF'
#   [Unit]
#   Description=Watch sing-box config
#
#   [Path]
#   PathExists=/home/ubuntu/paramount-stremio/vpn-data/sing-box/config.json
#
#   [Install]
#   WantedBy=multi-user.target
#   EOF
#
#   sudo tee /etc/systemd/system/sing-box-restart.service <<'EOF'
#   [Unit]
#   Description=Restart sing-box after config change
#
#   [Service]
#   Type=oneshot
#   ExecStart=/home/ubuntu/paramount-stremio/scripts/restart-sing-box.sh
#   EOF
#
#   sudo systemctl enable --now sing-box-restart.path
#

set -euo pipefail

ADDON_DIR="${ADDON_DIR:-/home/ubuntu/paramount-stremio}"

cd "${ADDON_DIR}"

echo "==> Ensuring sing-box container (profile vpn)…"
# Crea un config.json placeholder se manca: `docker compose up` fallisce se
# il bind-mount ./vpn-data/sing-box non contiene config.json. La config vera
# la scrive l'addon dalla UI /configure (uid 1000 = utente node del container).
if [ ! -f vpn-data/sing-box/config.json ]; then
    mkdir -p vpn-data/sing-box
    echo '{"log":{"level":"info"},"inbounds":[{"type":"http","tag":"http-in","listen":"0.0.0.0","listen_port":8888}],"outbounds":[{"type":"direct","tag":"direct"}],"route":{"final":"direct"}}' > vpn-data/sing-box/config.json
    chown 1000:1000 vpn-data/sing-box/config.json 2>/dev/null || true
fi
# `up -d` crea il container se non esiste ancora e lo ricrea se la config
# è cambiata. `restart` fallirebbe se il container non è mai stato avviato.
docker compose --profile vpn up -d sing-box

echo "==> Waiting for sing-box healthcheck (max 60s)…"
for i in $(seq 1 30); do
    HEALTH=$(docker inspect --format='{{.State.Health.Status}}' sing-box 2>/dev/null || echo "starting")
    if [ "$HEALTH" = "healthy" ]; then
        echo "✅ sing-box is healthy after ${i} attempts."
        exit 0
    fi
    sleep 2
done

echo "⚠️ sing-box non healthy dopo 60s. Log recenti:"
docker logs --tail=50 sing-box || true
exit 1