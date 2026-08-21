#!/usr/bin/env bash
# scripts/update-docker.sh
# Aggiorna un'installazione Docker esistente: pull, rebuild, restart.
# I dati persistenti (volume named paramount-data) NON vengono toccati.
#
# Uso:
#   sudo bash scripts/update-docker.sh [branch]

set -euo pipefail

BRANCH="${1:-main}"
APP_DIR="/opt/paramount-stremio"

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
git fetch --depth 1 origin "${BRANCH}"
git checkout "${BRANCH}"
git reset --hard "origin/${BRANCH}"

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