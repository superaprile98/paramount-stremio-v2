#!/usr/bin/env bash
# scripts/deploy-docker.sh
# Deploy Docker-first del Paramount+ Stremio Addon su una VM
# (Oracle Cloud Free Tier VM.Standard.A1.Flex — Ampere A1, oppure qualsiasi
# altra VM Ubuntu/Debian/RHEL/Fedora).
#
# Cosa fa:
#   1) Rileva il package manager (dnf / apt / yum)
#   2) Installa Docker Engine + compose plugin (se mancanti)
#   3) Aggiunge l'utente corrente al gruppo docker
#   4) Clona/aggiorna il repo in /opt/paramount-stremio
#   5) Crea .env da .env.example (genera KEY_SECRET se mancante)
#   6) docker compose up -d --build
#   7) Verifica l'healthcheck
#
# Uso:
#   sudo bash scripts/deploy-docker.sh
#
# Variabili opzionali (env):
#   REPO_URL   = git clone URL (default: https://github.com/superaprile98/paramount-stremio-v2.git)
#                Se il repo è privato, usa un Personal Access Token:
#                REPO_URL=https://<TOKEN>@github.com/superaprile98/paramount-stremio-v2.git
#   BRANCH     = branch da deployare (default: main)
#   PORT       = porta pubblica (default: 7850)
#   BASE_URL   = URL pubblico (default: http://<public-ip>:PORT)

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/superaprile98/paramount-stremio-v2.git}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-7850}"
APP_DIR="/opt/paramount-stremio"

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
    echo "ERRORE: nessun package manager supportato (dnf/apt/yum)." >&2
    exit 1
fi

# Detect public IP se non passato
detect_public_ip() {
    local ip
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

if ! command -v openssl >/dev/null 2>&1; then
    echo "ERRORE: openssl non trovato (serve per generare KEY_SECRET)." >&2
    exit 1
fi

echo "==> Deploy Docker Paramount+ Stremio Addon"
echo "    Repo:        ${REPO_URL}"
echo "    Branch:      ${BRANCH}"
echo "    Porta:       ${PORT}"
echo "    Distro:      ${PKG_MGR}"
echo "    IP pubblico: ${PUB_IP}"
echo "    BASE_URL:    ${BASE_URL}"
echo ""

# 1) Docker Engine + compose plugin
echo "==> [1/5] Installazione Docker Engine + compose plugin"
if ! command -v docker >/dev/null 2>&1; then
    echo "    Docker non trovato: installo via script ufficiale get.docker.com"
    curl -fsSL https://get.docker.com | sh
else
    echo "    Docker già presente: $(docker --version)"
fi
if ! docker compose version >/dev/null 2>&1; then
    echo "    Plugin compose mancante: installo docker-compose-plugin"
    case "$PKG_MGR" in
        dnf)  dnf install -y docker-compose-plugin >/dev/null ;;
        apt)  export DEBIAN_FRONTEND=noninteractive
              apt-get update -qq >/dev/null
              apt-get install -y -qq docker-compose-plugin >/dev/null ;;
        yum)  yum install -y docker-compose-plugin >/dev/null ;;
    esac
fi
systemctl enable --now docker >/dev/null 2>&1 || true

# 2) Utente nel gruppo docker (per comandi senza sudo dopo il ri-login)
echo "==> [2/5] Aggiunta utente al gruppo docker"
if [ -n "${SUDO_USER:-}" ] && ! id -nG "$SUDO_USER" 2>/dev/null | grep -qw docker; then
    usermod -aG docker "$SUDO_USER"
    echo "    Utente '${SUDO_USER}' aggiunto al gruppo docker (ri-login per usarlo senza sudo)"
fi

# 3) Clone o update del repo
echo "==> [3/5] Clone / pull del repository in ${APP_DIR}"
if [ ! -d "${APP_DIR}/.git" ]; then
    git clone --branch "${BRANCH}" --depth 1 "${REPO_URL}" "${APP_DIR}"
else
    cd "${APP_DIR}"
    git fetch --depth 1 origin "${BRANCH}"
    git checkout "${BRANCH}"
    git reset --hard "origin/${BRANCH}"
fi
cd "${APP_DIR}"

# 4) .env da .env.example (genera KEY_SECRET se mancante)
echo "==> [4/5] Preparazione .env"
if [ ! -f .env ]; then
    cp .env.example .env
    KEY_SECRET="$(openssl rand -hex 32)"
    sed -i "s/^KEY_SECRET=.*/KEY_SECRET=${KEY_SECRET}/" .env
    sed -i "s|^BASE_URL=.*|BASE_URL=${BASE_URL}|" .env
    sed -i "s/^PORT=.*/PORT=${PORT}/" .env
    chmod 600 .env
    echo "    .env creato con nuovo KEY_SECRET e BASE_URL=${BASE_URL}"
else
    # Aggiorna BASE_URL/PORT solo se mancanti (non sovrascrive i valori esistenti)
    grep -q "^BASE_URL=" .env || echo "BASE_URL=${BASE_URL}" >> .env
    grep -q "^PORT=" .env || echo "PORT=${PORT}" >> .env
    echo "    .env esistente, valori preservati"
fi

# 5) Build + avvio
echo "==> [5/5] docker compose up -d --build (prima build: 2-5 minuti)"
docker compose up -d --build

# Verifica healthcheck (start_period 20s + interval 30s → fino a ~2 minuti)
echo "==> Verifica healthcheck"
for _ in $(seq 1 90); do
    status="$(docker inspect --format '{{.State.Health.Status}}' paramount-stremio 2>/dev/null || echo starting)"
    echo "    health: ${status}"
    [ "${status}" = "healthy" ] && break
    if [ "${status}" = "unhealthy" ]; then
        echo "❌ Container unhealthy. Log:" >&2
        docker compose logs --tail=50 >&2
        exit 1
    fi
    sleep 2
done

echo ""
echo "================================================================"
echo "  ✅ Container avviato"
echo "================================================================"
echo "  Stato:    docker compose ps"
echo "  Log:      docker compose logs -f"
echo "  Restart:  docker compose restart"
echo "  Stop:     docker compose down"
echo "  Update:   sudo bash scripts/update-docker.sh"
echo ""
echo "  BASE_URL attuale: ${BASE_URL}"
echo "  Apri nel browser: ${BASE_URL}/configure"
echo "================================================================"