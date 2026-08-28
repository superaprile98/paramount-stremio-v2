#!/usr/bin/env bash
# scripts/install-oracle.sh
# Installazione bare-metal del Paramount+ Stremio Addon su una VM ARM
# (Oracle Cloud Free Tier VM.Standard.A1.Flex — Ampere A1, oppure qualsiasi
# altra VM Ubuntu/Debian/RHEL/Fedora). Sempre gratis sull'istanza Always Free.
#
# Supporta sia Oracle Linux 9 (dnf) sia Ubuntu 22.04/24.04 LTS (apt).
#
# Cosa fa:
#   1) Rileva il package manager (dnf / apt)
#   2) Installa Node.js 20 LTS via NodeSource
#   3) Crea utente di sistema "addon" (no login, no home scrivibile)
#   4) Prepara /etc/paramount-stremio/ (env file con permessi stretti)
#   5) Clona o aggiorna il repo in /home/ubuntu/server-stack/paramount-stremio
#   6) npm ci + next build
#   7) Installa e avvia il servizio systemd
#
# Prerequisiti:
#   - VM con sudo/root, porte 80/3000 (o quella scelta) aperte nel firewall
#     (Oracle: Security List associata alla VCN/subnet).
#   - 1 OCPU + 1 GB RAM bastano se si usa swap (esegui prima
#     `sudo bash scripts/setup-swap.sh`).
#
# Uso:
#   sudo bash scripts/install-oracle.sh
#
# Variabili opzionali (env):
#   REPO_URL   = git clone URL (default: https://github.com/superaprile98/paramount-stremio-v2.git)
#   BRANCH     = branch da deployare (default: main)
#   PORT       = porta del servizio (default: 3000)
#   BASE_URL   = URL pubblico (default: http://<public-ip>:PORT).
#                Verrà salvato in /etc/paramount-stremio/paramount-stremio.env

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/superaprile98/paramount-stremio-v2.git}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-3000}"

# Detect distro / package manager
detect_pkg_manager() {
    if command -v dnf >/dev/null 2>&1; then
        echo "dnf"
    elif command -v apt-get >/dev/null 2>&1; then
        echo "apt"
    elif command -v yum >/dev/null 2>&1; then
        echo "yum"
    else
        echo ""
    fi
}

PKG_MGR="$(detect_pkg_manager)"
if [ -z "$PKG_MGR" ]; then
    echo "ERRORE: nessun package manager supportato (dnf/apt/yum). Aggiungi supporto per la tua distro." >&2
    exit 1
fi

# Detect public IP se non passato
detect_public_ip() {
    # 1) Oracle Cloud metadata service (funziona anche su altre cloud)
    local ip
    ip=$(curl -s --max-time 5 -H "Authorization: Bearer Oracle" \
        http://169.254.169.254/opc/v2/instance/metadata/canonical-region-info 2>/dev/null || true)
    # 2) Prima interfaccia non-loopback con IP globale
    ip=$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1 || true)
    if [ -z "$ip" ]; then
        ip=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
    fi
    echo "${ip:-localhost}"
}

PUB_IP="$(detect_public_ip)"
BASE_URL="${BASE_URL:-http://${PUB_IP}:${PORT}}"

if [ "$(id -u)" -ne 0 ]; then
    echo "ERRORE: esegui come root (sudo bash $0)" >&2
    exit 1
fi

echo "==> Installazione Paramount+ Stremio Addon"
echo "    Repo:        ${REPO_URL}"
echo "    Branch:      ${BRANCH}"
echo "    Porta:       ${PORT}"
echo "    Distro:      ${PKG_MGR}"
echo "    IP pubblico: ${PUB_IP}"
echo "    BASE_URL:    ${BASE_URL}"
echo ""

# 1) Pacchetti base + Node.js 20
echo "==> [1/6] Installazione Node.js 20 LTS + strumenti base"
case "$PKG_MGR" in
    dnf)
        dnf install -y curl git openssl ca-certificates >/dev/null
        if ! command -v node >/dev/null 2>&1; then
            curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - >/dev/null
            dnf install -y nodejs >/dev/null
        fi
        ;;
    apt)
        export DEBIAN_FRONTEND=noninteractive
        apt-get update -qq >/dev/null
        apt-get install -y -qq curl git openssl ca-certificates >/dev/null
        if ! command -v node >/dev/null 2>&1; then
            curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
            apt-get install -y -qq nodejs >/dev/null
        fi
        ;;
    yum)
        yum install -y curl git openssl ca-certificates >/dev/null
        if ! command -v node >/dev/null 2>&1; then
            curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - >/dev/null
            yum install -y nodejs >/dev/null
        fi
        ;;
esac

NODE_VER="$(node -v)"
echo "    Node.js: ${NODE_VER}"
echo "    npm:     $(npm -v)"

# 2) Utente di sistema 'addon'
echo "==> [2/6] Creazione utente di sistema 'addon'"
if ! id addon >/dev/null 2>&1; then
    useradd --system --create-home --shell /sbin/nologin --home-dir /home/ubuntu/server-stack/paramount-stremio addon
fi

# 3) Directory per env + log
echo "==> [3/6] Preparazione /etc/paramount-stremio e /var/log"
install -d -m 0750 -o root -g root /etc/paramount-stremio
install -d -m 0755 -o addon -g addon /var/log/paramount-stremio

# Genera KEY_SECRET se non presente
if [ ! -f /etc/paramount-stremio/paramount-stremio.env ]; then
    KEY_SECRET="$(openssl rand -hex 32)"
    cat > /etc/paramount-stremio/paramount-stremio.env <<EOF
# Generato da scripts/install-oracle.sh — NON modificare a mano
# Riavvia il servizio dopo ogni modifica:  sudo systemctl restart paramount-stremio
KEY_SECRET=${KEY_SECRET}
BASE_URL=${BASE_URL}
PORT=${PORT}
NODE_ENV=production
EOF
    chmod 0640 /etc/paramount-stremio/paramount-stremio.env
    chown root:addon /etc/paramount-stremio/paramount-stremio.env
    echo "    Env file creato con nuovo KEY_SECRET"
else
    # Aggiorna solo BASE_URL e PORT se mancanti
    grep -q "^BASE_URL=" /etc/paramount-stremio/paramount-stremio.env || \
        echo "BASE_URL=${BASE_URL}" >> /etc/paramount-stremio/paramount-stremio.env
    grep -q "^PORT=" /etc/paramount-stremio/paramount-stremio.env || \
        echo "PORT=${PORT}" >> /etc/paramount-stremio/paramount-stremio.env
    echo "    Env file esistente, BASE_URL/PORT preservati"
fi

# 4) Clone o update del repo
echo "==> [4/6] Clone / pull del repository"
if [ ! -d /home/ubuntu/server-stack/paramount-stremio/.git ]; then
    git clone --branch "${BRANCH}" --depth 1 "${REPO_URL}" /home/ubuntu/server-stack/paramount-stremio
else
    cd /home/ubuntu/server-stack/paramount-stremio
    git fetch --depth 1 origin "${BRANCH}"
    git checkout "${BRANCH}"
    git reset --hard "origin/${BRANCH}"
fi
chown -R addon:addon /home/ubuntu/server-stack/paramount-stremio

# 5) Dipendenze + build
echo "==> [5/6] npm ci + next build (può richiedere 1-3 minuti)"
cd /home/ubuntu/server-stack/paramount-stremio
sudo -u addon HOME=/home/ubuntu/server-stack/paramount-stremio npm ci --omit=dev --no-audit --no-fund || \
sudo -u addon HOME=/home/ubuntu/server-stack/paramount-stremio npm ci --no-audit --no-fund
# Servono i devDependencies per "next build"
sudo -u addon HOME=/home/ubuntu/server-stack/paramount-stremio npm install --no-audit --no-fund --include=dev typescript @types/node @types/react @types/react-dom 2>/dev/null || true
sudo -u addon HOME=/home/ubuntu/server-stack/paramount-stremio env NODE_ENV=production npx next build

# 6) Systemd unit
echo "==> [6/6] Installazione unit systemd e avvio servizio"
install -m 0644 /home/ubuntu/server-stack/paramount-stremio/scripts/systemd/paramount-stremio.service /etc/systemd/system/paramount-stremio.service
systemctl daemon-reload
systemctl enable paramount-stremio.service
systemctl restart paramount-stremio.service

sleep 2
if systemctl is-active --quiet paramount-stremio.service; then
    echo ""
    echo "================================================================"
    echo "  ✅ Servizio ATTIVO"
    echo "================================================================"
    echo "  Stato:    sudo systemctl status paramount-stremio"
    echo "  Log:      sudo journalctl -u paramount-stremio -f"
    echo "  Restart:  sudo systemctl restart paramount-stremio"
    echo "  Stop:     sudo systemctl stop paramount-stremio"
    echo ""
    echo "  BASE_URL attuale: ${BASE_URL}"
    echo "  Apri nel browser: ${BASE_URL}/configure"
    echo "================================================================"
else
    echo ""
    echo "❌ Servizio NON attivo. Controlla:"
    echo "   sudo systemctl status paramount-stremio"
    echo "   sudo journalctl -u paramount-stremio -n 50"
    exit 1
fi
