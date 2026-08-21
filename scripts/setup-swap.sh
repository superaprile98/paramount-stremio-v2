#!/usr/bin/env bash
# scripts/setup-swap.sh
# Aggiunge 2 GB di swapfile. Eseguire UNA VOLTA come root.
# Richiesto su VM.Standard.A1.Flex (1 GB RAM) prima di lanciare install-oracle.sh
# se si vuole che "next build" non venga killato da OOM.

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo "ERRORE: esegui come root (sudo bash $0)" >&2
    exit 1
fi

SWAPFILE="${SWAPFILE:-/swapfile}"
SWAPSIZE="${SWAPSIZE:-2G}"

if swapon --show | grep -q "${SWAPFILE}"; then
    echo "Swap ${SWAPFILE} già attivo, niente da fare."
    exit 0
fi

if [ -f "${SWAPFILE}" ]; then
    echo "ERRORE: ${SWAPFILE} esiste ma non è attivo. Controlla manualmente." >&2
    exit 1
fi

echo "==> Creazione ${SWAPSIZE} swap su ${SWAPFILE}"
fallocate -l "${SWAPSIZE}" "${SWAPFILE}"
chmod 600 "${SWAPFILE}"
mkswap "${SWAPFILE}"
swapon "${SWAPFILE}"

if ! grep -q "${SWAPFILE} none swap" /etc/fstab; then
    echo "${SWAPFILE} none swap sw 0 0" >> /etc/fstab
fi

echo "==> Stato:"
free -h
echo ""
echo "✅ Swap attivo. Ora puoi lanciare install-oracle.sh"
