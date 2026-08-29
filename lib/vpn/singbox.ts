/**
 * Manager per il container sing-box (proxy VLESS/Hysteria2/VMess/Trojan/SS).
 *
 * Flusso:
 *   1. L'utente incolla una subscription URL (o un singolo share-link) nella
 *      UI /configure.
 *   2. /api/vpn/setup (mode vless) chiama fetchSubscription() → parse →
 *      buildSingBoxConfig() → writeSingBoxConfig().
 *   3. Il file config.json viene scritto su vpn-data/sing-box/config.json
 *      (bind-mount sul container sing-box). La systemd path unit
 *      (scripts/install-vpn-watcher.sh) osserva il file e riavvia il
 *      container automaticamente.
 *   4. PROXY_URLS = http://sing-box:8888 (inbound HTTP proxy locale).
 *
 * NOTA: il restart effettivo del container sing-box NON può essere fatto
 * dall'addon (manca di accesso al socket Docker). Viene fatto da:
 *   - scripts/install-vpn-watcher.sh: systemd path unit su config.json.
 *   - In alternativa, scripts/restart-sing-box.sh manualmente.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { VPN_DATA_PATHS } from './storage';
import { ParsedServer, parseSubscriptionText, parseXrayJson } from './share-links';

const SING_BOX_DIR = path.dirname(VPN_DATA_PATHS.singBoxConfig);
const SERVERS_CACHE = path.join(SING_BOX_DIR, 'servers.json');

const DEFAULT_USER_AGENT = 'sing-box/1.11.0';

export type VlessSetupConfig = {
    kind: 'vless';
    subscriptionUrl: string;
    serverTag: string; // 'auto' oppure tag di un server specifico
    serverCount: number;
    updatedAt: string;
};

/**
 * Scarica la subscription URL (fetch DIRETTO, senza proxy — chicken-and-egg:
 * il proxy non esiste ancora) e ritorna la lista dei server parsati.
 *
 * Supporta:
 *   - subscription base64 (lista di share-link)
 *   - singolo share-link
 *   - testo già decodificato
 *   - Xray/V2Ray JSON (array di config o config singolo con outbounds)
 *
 * NON supporta: YAML/JSON Clash → errore chiaro.
 */
export async function fetchSubscription(url: string): Promise<ParsedServer[]> {
    const ua = process.env.SUBSCRIPTION_USER_AGENT || DEFAULT_USER_AGENT;
    const resp = await fetch(url, {
        headers: {
            'User-Agent': ua,
            'Accept': '*/*',
        },
        signal: AbortSignal.timeout(20000),
    });
    if (!resp.ok) {
        throw new Error(`Subscription fetch failed: HTTP ${resp.status} ${resp.statusText}`);
    }
    const text = await resp.text();
    if (!text.trim()) throw new Error('Subscription is empty');

    const trimmed = text.trim();

    // Xray/V2Ray JSON (es. subscription "app=happ"): array di config o
    // config singolo con outbounds. Se il parse fallisce → errore chiaro.
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        const xrayServers = parseXrayJson(trimmed);
        if (xrayServers && xrayServers.length > 0) {
            return xrayServers;
        }
        if (trimmed.startsWith('proxies:')) {
            throw new Error('Clash YAML non ancora supportato: usa una subscription in formato base64/share-link o Xray JSON');
        }
        throw new Error('JSON non riconosciuto: non è una config Xray/V2Ray valida (manca "outbounds")');
    }

    const servers = parseSubscriptionText(text);
    if (servers.length === 0) {
        throw new Error('Nessun server valido trovato nella subscription (formati supportati: vless, hysteria2, vmess, trojan, ss, Xray JSON)');
    }
    return servers;
}

/**
 * Costruisce il config.json per sing-box:
 *   - inbound HTTP proxy su 0.0.0.0:8888 (stessa interfaccia di gluetun);
 *   - outbound urltest "auto" su tutti i server (failover automatico);
 *   - se serverTag != 'auto' → route.final = tag di quel server.
 */
export function buildSingBoxConfig(servers: ParsedServer[], serverTag: string = 'auto'): object {
    const outbounds: any[] = [];
    const tags: string[] = [];

    for (const s of servers) {
        // sing-box non supporta il transport "xhttp" (è un transport Xray).
        // Lo saltiamo per evitare FATAL "unknown transport type: xhttp".
        if (s.transport === 'xhttp') {
            console.warn(`[singbox] skipping xhttp server ${s.host}:${s.port} (transport xhttp not supported by sing-box)`);
            continue;
        }
        const tag = s.tag || `${s.host}:${s.port}`;
        tags.push(tag);
        outbounds.push(buildOutbound(s, tag));
    }

    const finalTag = serverTag && serverTag !== 'auto' && tags.includes(serverTag) ? serverTag : 'auto';

    return {
        log: { level: 'info', timestamp: true },
        inbounds: [
            { type: 'http', tag: 'http-in', listen: '0.0.0.0', listen_port: 8888 },
        ],
        outbounds: [
            // urltest attivo: testa ogni outbound ogni `interval` verso `url` (HTTP 204
            // è il probe standard). Senza `url`/`interval` sing-box usa la modalità
            // "lazy" e fallisce al primo errore tornando al default (direct).
            {
                type: 'urltest',
                tag: 'auto',
                outbounds: tags,
                url: 'http://www.gstatic.com/generate_204',
                interval: '3m',
                tolerance: 50,
            },
            ...outbounds,
        ],
        // `final` è l'outbound usato per il traffico che non matcha nessuna rule.
        // Senza `final` esplicito, sing-box usa `direct` come fallback implicito
        // e — se urltest fallisce — il traffico esce direttamente dal VPS senza VPN.
        // NOTA: `route.default` NON è supportato da sing-box < 1.11; usiamo solo `final`.
        route: {
            final: finalTag,
        },
    };
}

function buildTls(s: ParsedServer): any {
    const tls: any = {
        enabled: true,
        server_name: s.sni || s.host,
        insecure: !!s.insecure,
    };
    if (s.realityPublicKey) {
        // sing-box richiede uTLS abilitato per i client reality.
        // Senza `utls.enabled`, sing-box esce con FATAL "uTLS is required by reality client".
        tls.utls = {
            enabled: true,
            fingerprint: 'chrome',
        };
        // sing-box NON accetta `spider_x` dentro il blocco reality (è un campo Xray,
        // non sing-box). Va omesso completamente per evitare FATAL "unknown field"
        // al reload del config. In sing-box lo spider X è gestito diversamente.
        tls.reality = {
            enabled: true,
            public_key: s.realityPublicKey,
            short_id: s.realityShortId || '',
        };
    }
    return tls;
}

function buildOutbound(s: ParsedServer, tag: string): any {
    const base: any = { tag };
    switch (s.protocol) {
        case 'vless': {
            base.type = 'vless';
            base.server = s.host;
            base.server_port = s.port;
            base.uuid = s.uuid;
            if (s.flow) base.flow = s.flow;
            if (s.tls) {
                base.tls = buildTls(s);
            }
            if (s.transport === 'ws') {
                base.transport = { type: 'ws', path: s.wsPath || '/', headers: s.wsHost ? { Host: s.wsHost } : undefined };
            } else if (s.transport === 'grpc') {
                base.transport = { type: 'grpc', service_name: s.grpcServiceName || '' };
            } else if (s.transport === 'xhttp') {
                base.transport = { type: 'xhttp', path: s.xhttpPath || '/', mode: s.xhttpMode || 'auto' };
            }
            break;
        }
        case 'hysteria2': {
            base.type = 'hysteria2';
            base.server = s.host;
            base.server_port = s.port;
            base.password = s.password;
            base.tls = { enabled: true, server_name: s.sni || s.host, insecure: !!s.insecure };
            break;
        }
        case 'vmess': {
            base.type = 'vmess';
            base.server = s.host;
            base.server_port = s.port;
            base.uuid = s.uuid;
            if (s.method && s.method !== 'auto') base.alter_id = 0;
            if (s.tls) {
                base.tls = buildTls(s);
            }
            if (s.transport === 'ws') {
                base.transport = { type: 'ws', path: s.wsPath || '/', headers: s.wsHost ? { Host: s.wsHost } : undefined };
            } else if (s.transport === 'grpc') {
                base.transport = { type: 'grpc', service_name: s.grpcServiceName || '' };
            } else if (s.transport === 'xhttp') {
                base.transport = { type: 'xhttp', path: s.xhttpPath || '/', mode: s.xhttpMode || 'auto' };
            }
            break;
        }
        case 'trojan': {
            base.type = 'trojan';
            base.server = s.host;
            base.server_port = s.port;
            base.password = s.password;
            if (s.tls) {
                base.tls = buildTls(s);
            }
            break;
        }
        case 'ss': {
            base.type = 'shadowsocks';
            base.server = s.host;
            base.server_port = s.port;
            base.method = s.method || 'aes-128-gcm';
            base.password = s.password;
            break;
        }
    }
    return base;
}

/**
 * Scrive config.json (0o600) + cache servers.json (lista parsata per
 * /api/vpn/servers). Ritorna i path scritti.
 */
export async function writeSingBoxConfig(servers: ParsedServer[], serverTag: string = 'auto'): Promise<{
    configPath: string;
    serversPath: string;
}> {
    await fs.mkdir(SING_BOX_DIR, { recursive: true, mode: 0o700 });
    const config = buildSingBoxConfig(servers, serverTag);
    await fs.writeFile(VPN_DATA_PATHS.singBoxConfig, JSON.stringify(config, null, 2), { mode: 0o600 });
    const cache = {
        updatedAt: new Date().toISOString(),
        serverTag,
        servers: servers.map(s => ({
            tag: s.tag,
            protocol: s.protocol,
            host: s.host,
            port: s.port,
        })),
    };
    await fs.writeFile(SERVERS_CACHE, JSON.stringify(cache, null, 2), { mode: 0o600 });
    return { configPath: VPN_DATA_PATHS.singBoxConfig, serversPath: SERVERS_CACHE };
}

/**
 * Legge la cache servers.json (per /api/vpn/servers). Ritorna null se assente.
 */
export async function readServersCache(): Promise<{
    updatedAt: string;
    serverTag: string;
    servers: Array<{ tag: string; protocol: string; host: string; port: number }>;
} | null> {
    try {
        const raw = await fs.readFile(SERVERS_CACHE, 'utf8');
        return JSON.parse(raw);
    } catch (err: any) {
        if (err?.code === 'ENOENT') return null;
        throw err;
    }
}

/**
 * Restituisce lo stato corrente della config VLESS (per /api/vpn/status).
 */
export async function readCurrentVlessConfig(): Promise<{
    kind: 'vless';
    serverTag: string;
    serverCount: number;
    configPath: string;
    updatedAt: string;
} | null> {
    try {
        const raw = await fs.readFile(VPN_DATA_PATHS.singBoxConfig, 'utf8');
        const config = JSON.parse(raw);
        const outbounds = Array.isArray(config?.outbounds) ? config.outbounds : [];
        const urltest = outbounds.find((o: any) => o.type === 'urltest');
        const serverCount = urltest?.outbounds?.length ?? 0;
        // Config di default (solo outbound "direct", nessun server reale):
        // non è una connessione VLESS attiva → ritorna null così la UI mostra
        // il form di configurazione invece di "✅ Connesso".
        if (serverCount === 0) return null;
        const finalTag = config?.route?.final ?? 'auto';
        const stat = await fs.stat(VPN_DATA_PATHS.singBoxConfig);
        return {
            kind: 'vless',
            serverTag: finalTag,
            serverCount,
            configPath: VPN_DATA_PATHS.singBoxConfig,
            updatedAt: stat.mtime.toISOString(),
        };
    } catch (err: any) {
        if (err?.code === 'ENOENT') return null;
        throw err;
    }
}

/** Rimuove config.json e cache servers.json. */
export async function clearSingBoxConfig(): Promise<void> {
    await Promise.all([
        fs.unlink(VPN_DATA_PATHS.singBoxConfig).catch(e => e?.code !== 'ENOENT' && Promise.reject(e)),
        fs.unlink(SERVERS_CACHE).catch(e => e?.code !== 'ENOENT' && Promise.reject(e)),
    ]);
}