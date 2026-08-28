#!/usr/bin/env bash
# scripts/install-vpn-watcher.sh
#
# Installa un watcher systemd che osserva le modifiche al file
# vpn-data/sing-box/config.json e riavvia automaticamente il container
# sing-box quando l'addon scrive una nuova config (VLESS/Hysteria2/VMess/
# Trojan/SS dalla UI /configure).
#
# Da eseguire UNA VOLTA sull'host (con sudo):
#   sudo bash scripts/install-vpn-watcher.sh
#
# Dopo l'installazione:
#   - L'utente può cambiare server/subscription dall'UI /configure → card VPN
#   - Nessun SSH è più necessario: il restart è automatico in 2-5 secondi
#   - Lo script è disinstallabile con: sudo bash scripts/install-vpn-watcher.sh --uninstall
#
# NOTA: se era installato il vecchio watcher gluetun (gluetun-auto-restart),
# questo script lo disinstalla automaticamente (--uninstall legacy).

set -euo pipefail

ADDON_DIR="${ADDON_DIR:-/home/ubuntu/paramount-stremio}"
WATCH_FILE="${WATCH_FILE:-${ADDON_DIR}/vpn-data/sing-box/config.json}"
SERVICE_NAME="sing-box-auto-restart"
LEGACY_SERVICE_NAME="gluetun-auto-restart"

if [ "${1:-}" = "--uninstall" ]; then
    echo "==> Disinstallazione watcher ${SERVICE_NAME}…"
    systemctl disable --now "${SERVICE_NAME}.path" "${SERVICE_NAME}.service" 2>/dev/null || true
    rm -f "/etc/systemd/system/${SERVICE_NAME}.path" "/etc/systemd/system/${SERVICE_NAME}.service"
    systemctl daemon-reload
    echo "✅ Disinstallato."
    exit 0
fi

# Disinstalla il vecchio watcher gluetun (legacy, non più usato).
if systemctl list-unit-files 2>/dev/null | grep -q "${LEGACY_SERVICE_NAME}.path"; then
    echo "==> Rimozione watcher legacy gluetun (${LEGACY_SERVICE_NAME})…"
    systemctl disable --now "${LEGACY_SERVICE_NAME}.path" "${LEGACY_SERVICE_NAME}.service" 2>/dev/null || true
    rm -f "/etc/systemd/system/${LEGACY_SERVICE_NAME}.path" "/etc/systemd/system/${LEGACY_SERVICE_NAME}.service"
    systemctl daemon-reload
fi

# Verifica che la directory esista (verrà creata al primo salvataggio UI).
# Deve appartenere a uid 1000 (utente `node` del container paramount):
# l'addon scrive qui config.json via il bind mount ./vpn-data:/app/.data/vpn.
NODE_UID="${NODE_UID:-1000}"
WATCH_DIR="$(dirname "${WATCH_FILE}")"
mkdir -p "${WATCH_DIR}"
chown "${NODE_UID}:${NODE_UID}" "${WATCH_DIR}" 2>/dev/null || true

# Verifica che docker compose sia disponibile.
if ! command -v docker >/dev/null 2>&1; then
    echo "❌ docker non trovato. Installa Docker prima di proseguire."
    exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
    echo "❌ docker compose plugin non trovato. Installa docker-compose-plugin."
    exit 1
fi

# Verifica che sing-box sia presente nella config compose.
if ! grep -q "^  sing-box:" "${ADDON_DIR}/docker-compose.yml"; then
    echo "❌ Servizio 'sing-box' non trovato in ${ADDON_DIR}/docker-compose.yml"
    echo "   Aggiorna prima il repo (git pull)."
    exit 1
fi

# Crea il file .service.
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=Restart sing-box container after VPN config change
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
WorkingDirectory=${ADDON_DIR}
# `up -d` crea il container se non esiste ancora (profilo vpn) e lo
# ricrea se la config è cambiata. `restart` fallirebbe se il container
# non è mai stato avviato.
ExecStart=/usr/bin/docker compose --profile vpn up -d sing-box
ExecStartPost=/usr/bin/bash ${ADDON_DIR}/scripts/restart-sing-box.sh
StandardOutput=journal
StandardError=journal
EOF

# Crea il file .path.
PATH_FILE="/etc/systemd/system/${SERVICE_NAME}.path"
cat > "${PATH_FILE}" <<EOF
[Unit]
Description=Watch ${WATCH_FILE} for changes (addon writes here from UI)

[Path]
# Trigger sia alla creazione (primo salvataggio config) sia ad ogni
# modifica successiva (cambio server/subscription). PathExists da solo
# scatta solo alla creazione.
PathExists=${WATCH_FILE}
PathModified=${WATCH_FILE}
Unit=${SERVICE_NAME}.service

[Install]
WantedBy=multi-user.target
EOF

echo "==> File creati:"
echo "    ${SERVICE_FILE}"
echo "    ${PATH_FILE}"

# Ricarica systemd e abilita.
systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}.path"

echo ""
echo "✅ Watcher installato e attivo!"
echo ""
echo "Verifica:"
echo "  systemctl status ${SERVICE_NAME}.path"
echo ""
echo "Adesso puoi cambiare VPN/proxy dall'UI /configure senza più SSH."
echo "Disinstalla con: sudo bash scripts/install-vpn-watcher.sh --uninstall"