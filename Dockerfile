# P20: immagine ottimizzata
# - base LTS (node:22-alpine) invece di node:25-alpine (non-LTS)
# - stage run con solo dipendenze di produzione (npm ci --omit=dev)
# - USER node (non-root) per sicurezza
# - healthcheck per orchestrazione
#
# Nota: NON usiamo output: "standalone" perché proxy-agent usa import()
# dinamici (http-proxy-agent, socks-proxy-agent, pac-proxy-agent) che
# Next.js non traccia nel bundle standalone.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=7850
ENV NEXT_TELEMETRY_DISABLED=1

# Solo dipendenze di produzione: niente devDependencies nell'immagine finale
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json

# Esegui come utente non-root
USER node

EXPOSE $PORT

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 || exit 1

CMD ["sh", "-c", "npm run start -- -p $PORT 2>&1"]
