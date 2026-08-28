#!/usr/bin/env bash
# scripts/update-docker.sh
# Aggiorna un'installazione Docker esistente: pull, rebuild, restart.
# I dati persistenti (volume named paramount-data) NON vengono toccati.
#
# Uso:
#   sudo bash scripts/update-docker.sh [branch]

set -euo pipefail

BRANCH="${1:-main}"
APP_DIR="/home/ubuntu/server-stack/paramount-stremio"

if [ "$(id -u)" -ne 0 ]; then
    echo "ERRORE: esegui come root (sudo bash $0)" >&2
    exit 1
fi

if [ ! -d "${APP_DIR}/.git" ]; then
    echo "ERRORE: installazione non trovata in ${APP_DIR}" >&2
    echo "       esegui prima: sudo bash scripts/deploy-docker.sh" >&2
    exit 1
fi

cd "${APP_DIR}"

echo "==> Fetch + reset su origin/${BRANCH}"
# Se il docker-compose.yml locale era stato adattato per Nginx Proxy Manager
# (niente `ports:` esposti sull'host + network `reverse-proxy`), riapplichiamo
# quelle modifiche al compose NUOVO dopo il reset (il file vecchio non va
# ripristinato: perderebbe il servizio sing-box).
NPM_PATCH=0
if [ -f docker-compose.yml ] && ! git diff --quiet docker-compose.yml && grep -q "reverse-proxy" docker-compose.yml; then
    NPM_PATCH=1
    echo "    Rilevato docker-compose.yml adattato per NPM: riapplico le modifiche dopo il pull"
fi
git fetch --depth 1 origin "${BRANCH}"
git checkout "${BRANCH}"
git reset --hard "origin/${BRANCH}"
if [ "${NPM_PATCH}" = "1" ]; then
    python3 - <<'EOF'
import re
p = 'docker-compose.yml'
s = open(p).read()
# Rimuove il blocco ports: dal servizio paramount (NPM fa da reverse proxy)
s = re.sub(r'\n    ports:\n      - "\$\{PORT:-7850\}:\$\{PORT:-7850\}"', '', s)
# Network condivisa di NPM: reverse-proxy invece di server-stack_default
s = s.replace('server-stack_default', 'reverse-proxy')
open(p, 'w').write(s)
EOF
    echo "    docker-compose.yml adattato per NPM (ports rimossi, network reverse-proxy)"
fi

echo "==> docker compose up -d --build (rebuild: 1-3 minuti)"
docker compose up -d --build

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
echo "  ✅ Aggiornamento completato"
echo "================================================================"
docker compose ps
echo "  Log:      docker compose logs -f"
echo "================================================================"