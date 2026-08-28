#!/usr/bin/env bash
# scripts/deploy-vpn-update.sh
#
# One-shot deploy sul VPS Oracle Cloud (o qualsiasi docker host) per
# applicare l'ultimo commit del repo, ribuildare l'immagine e
# installare/aggiornare il watcher systemd che riavvia sing-box
# automaticamente ad ogni cambio config dall'UI.
#
# Da eseguire sull'host (con sudo):
#   sudo bash scripts/deploy-vpn-update.sh
#
# Prerequisiti: deploy-docker.sh già eseguito (Docker + repo in
# /home/ubuntu/paramount-stremio).

set -euo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/paramount-stremio}"
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

echo "==> [3/4] Crea dir vpn-data se mancante (per sing-box config.json)"
mkdir -p vpn-data/sing-box
# L'addon (container paramount, uid 1000) scrive qui config.json via bind
# mount ./vpn-data:/app/.data/vpn: senza ownership corretta → EACCES.
chown 1000:1000 vpn-data vpn-data/sing-box || true
chmod 700 vpn-data vpn-data/sing-box || true
# Placeholder: `docker compose up` fallisce se il bind-mount non contiene
# config.json (il container sing-box lo richiede all'avvio).
if [ ! -f vpn-data/sing-box/config.json ]; then
    echo '{"log":{"level":"info"},"inbounds":[{"type":"http","tag":"http-in","listen":"0.0.0.0","listen_port":8888}],"outbounds":[{"type":"direct","tag":"direct"}],"route":{"final":"direct"}}' > vpn-data/sing-box/config.json
    chown 1000:1000 vpn-data/sing-box/config.json 2>/dev/null || true
fi

echo "==> [4/5] Crea il container sing-box (profilo vpn) se non esiste"
docker compose --profile vpn up -d sing-box || true

echo "==> [5/5] Installa/aggiorna watcher systemd per auto-restart sing-box"
bash scripts/install-vpn-watcher.sh

echo ""
echo "================================================================"
echo "  ✅ Deploy VPN completato"
echo "================================================================"
echo ""
echo "Ora apri nel browser:"
echo "  https://para.khnum.duckdns.org/configure"
echo ""
echo "Vai alla card 🌐 VPN / Proxy → sezione 🧩 VLESS / Subscription:"
echo "  - Incolla la subscription URL (es. https://provider.com/sub?token=...)"
echo "  - Click Fetch servers → seleziona Auto (failover) o un server"
echo "  - Click Save & connect"
echo ""
echo "Dopo 3-5 secondi il proxy è attivo. Verifica con:"
echo "  docker logs --tail 50 sing-box"
echo ""
echo "Test live:"
echo "  Clicca 🧪 Test connection nella stessa card."
echo "================================================================"
