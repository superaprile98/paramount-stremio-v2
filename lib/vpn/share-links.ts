/**
 * Parser dei share-link proxy (vless://, hysteria2://, vmess://, trojan://, ss://).
 *
 * Usato da /api/vpn/preview e /api/vpn/setup (mode vless) per trasformare la
 * subscription URL (base64) in una lista di server parsati che sing-box può
 * usare per generare il config.json.
 *
 * Formati supportati (v1):
 *   vless://uuid@host:port?encryption=none&security=tls&type=ws&host=SNI&path=%2Fws&flow=xtls-rprx-vision#name
 *   hysteria2://password@host:port?insecure=1&sni=SNI#name
 *   vmess://base64url(JSON)  con {v,ps,add,port,id,aid,scy,net,type,host,path,tls,sni}
 *   trojan://password@host:port?security=tls&sni=SNI#name
 *   ss://base64url(method:password)@host:port#name   (SIP002)
 *
 * Regole:
 *   - tag = fragment #name (fallback host:port).
 *   - security=tls → tls.enabled=true, server_name=sni||host.
 *   - insecure=1 → tls.insecure=true.
 *   - type=ws → transport ws con path e host; type=grpc → serviceName; assente → tcp.
 *   - Link non parsabili → saltati con warning (mai bloccare l'intera subscription).
 */

export type ParsedServer = {
    tag: string;
    protocol: 'vless' | 'hysteria2' | 'vmess' | 'trojan' | 'ss';
    host: string;
    port: number;
    uuid?: string;        // vless, vmess
    password?: string;    // hysteria2, trojan, ss
    method?: string;      // ss (cipher), vmess (scy)
    tls?: boolean;
    sni?: string;
    insecure?: boolean;
    flow?: string;        // vless (es. xtls-rprx-vision)
    transport?: 'tcp' | 'ws' | 'grpc' | 'xhttp';
    wsHost?: string;
    wsPath?: string;
    grpcServiceName?: string;
    // Reality (Xray JSON): publicKey, shortId, spiderX
    realityPublicKey?: string;
    realityShortId?: string;
    realitySpiderX?: string;
    // xhttp (Xray JSON)
    xhttpPath?: string;
    xhttpMode?: string;
    raw?: string;         // link originale (per debug)
};

function decodeBase64UrlSafe(s: string): string {
    // Normalizza URL-safe base64 (possono usare - _ e mancare di padding).
    let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    return Buffer.from(b64, 'base64').toString('utf8');
}

function parseQuery(qs: string): Record<string, string> {
    const out: Record<string, string> = {};
    if (!qs) return out;
    for (const pair of qs.split('&')) {
        if (!pair) continue;
        const idx = pair.indexOf('=');
        if (idx < 0) {
            out[decodeURIComponent(pair)] = '';
        } else {
            const k = decodeURIComponent(pair.slice(0, idx));
            const v = decodeURIComponent(pair.slice(idx + 1));
            out[k] = v;
        }
    }
    return out;
}

function parseVless(u: URL): ParsedServer | null {
    const uuid = u.username || undefined;
    const host = u.hostname;
    const port = Number(u.port) || 443;
    if (!uuid || !host) return null;
    const q = parseQuery(u.search.slice(1));
    const tls = q.security === 'tls' || q.security === 'reality';
    const transport = q.type === 'ws' ? 'ws' : q.type === 'grpc' ? 'grpc' : 'tcp';
    return {
        tag: u.hash ? decodeURIComponent(u.hash.slice(1)) : `${host}:${port}`,
        protocol: 'vless',
        host,
        port,
        uuid,
        tls,
        sni: q.sni || (tls ? host : undefined),
        insecure: q.insecure === '1' || q.insecure === 'true',
        flow: q.flow || undefined,
        transport,
        wsHost: q.host || undefined,
        wsPath: q.path ? decodeURIComponent(q.path) : undefined,
        grpcServiceName: q.serviceName || undefined,
        raw: u.toString(),
    };
}

function parseHysteria2(u: URL): ParsedServer | null {
    const password = u.username || undefined;
    const host = u.hostname;
    const port = Number(u.port) || 443;
    if (!password || !host) return null;
    const q = parseQuery(u.search.slice(1));
    return {
        tag: u.hash ? decodeURIComponent(u.hash.slice(1)) : `${host}:${port}`,
        protocol: 'hysteria2',
        host,
        port,
        password,
        tls: true,
        sni: q.sni || host,
        insecure: q.insecure === '1' || q.insecure === 'true',
        raw: u.toString(),
    };
}

function parseVmess(u: URL): ParsedServer | null {
    try {
        const json = JSON.parse(decodeBase64UrlSafe(u.hostname || ''));
        const host = String(json.add || '');
        const port = Number(json.port) || 443;
        if (!host) return null;
        const tls = json.tls === 'tls' || json.tls === true;
        const transport = json.net === 'ws' ? 'ws' : json.net === 'grpc' ? 'grpc' : 'tcp';
        return {
            tag: String(json.ps || `${host}:${port}`),
            protocol: 'vmess',
            host,
            port,
            uuid: String(json.id || ''),
            method: json.scy || 'auto',
            tls,
            sni: json.sni || (tls ? host : undefined),
            insecure: json.allowInsecure === 1 || json.allowInsecure === true,
            transport,
            wsHost: json.host || undefined,
            wsPath: json.path ? decodeURIComponent(json.path) : undefined,
            grpcServiceName: json.serviceName || undefined,
            raw: u.toString(),
        };
    } catch {
        return null;
    }
}

function parseTrojan(u: URL): ParsedServer | null {
    const password = u.username || undefined;
    const host = u.hostname;
    const port = Number(u.port) || 443;
    if (!password || !host) return null;
    const q = parseQuery(u.search.slice(1));
    const tls = q.security === 'tls' || q.security === 'reality';
    return {
        tag: u.hash ? decodeURIComponent(u.hash.slice(1)) : `${host}:${port}`,
        protocol: 'trojan',
        host,
        port,
        password,
        tls,
        sni: q.sni || (tls ? host : undefined),
        insecure: q.insecure === '1' || q.insecure === 'true',
        raw: u.toString(),
    };
}

function parseSs(u: URL): ParsedServer | null {
    // ss://base64url(method:password)@host:port#name  (SIP002)
    // oppure ss://base64url(method:password@host:port)#name (legacy)
    let method: string | undefined;
    let password: string | undefined;
    let host = u.hostname;
    let port = Number(u.port) || 443;

    if (u.username) {
        // SIP002: userinfo = base64url(method:password).
        // NOTA: URL percent-encoda il userinfo (es. '=' → '%3D'): va
        // decodificato PRIMA del base64, altrimenti il decode fallisce.
        try {
            const decoded = decodeBase64UrlSafe(decodeURIComponent(u.username));
            const idx = decoded.indexOf(':');
            if (idx > 0) {
                method = decoded.slice(0, idx);
                password = decoded.slice(idx + 1);
            }
        } catch { /* fallthrough */ }
    } else if (host) {
        // Legacy: host = base64url(method:password@host:port)
        try {
            const decoded = decodeBase64UrlSafe(decodeURIComponent(host));
            const at = decoded.lastIndexOf('@');
            if (at > 0) {
                const creds = decoded.slice(0, at);
                const rest = decoded.slice(at + 1);
                const idx = creds.indexOf(':');
                if (idx > 0) {
                    method = creds.slice(0, idx);
                    password = creds.slice(idx + 1);
                }
                const colon = rest.lastIndexOf(':');
                if (colon > 0) {
                    host = rest.slice(0, colon);
                    port = Number(rest.slice(colon + 1)) || 443;
                } else {
                    host = rest;
                }
            }
        } catch { return null; }
    }

    if (!method || !password || !host) return null;
    return {
        tag: u.hash ? decodeURIComponent(u.hash.slice(1)) : `${host}:${port}`,
        protocol: 'ss',
        host,
        port,
        password,
        method,
        raw: u.toString(),
    };
}

/**
 * Parsa un singolo share-link. Ritorna null se non riconosciuto/valido.
 */
export function parseShareLink(link: string): ParsedServer | null {
    const trimmed = link.trim();
    if (!trimmed) return null;
    let u: URL;
    try {
        u = new URL(trimmed);
    } catch {
        return null;
    }
    switch (u.protocol) {
        case 'vless:': return parseVless(u);
        case 'hysteria2:': return parseHysteria2(u);
        case 'vmess:': return parseVmess(u);
        case 'trojan:': return parseTrojan(u);
        case 'ss:': return parseSs(u);
        default: return null;
    }
}

/**
 * Parsa un testo che può contenere:
 *   - una subscription base64 (lista di share-link separati da newline)
 *   - un singolo share-link
 *   - testo già decodificato con più link
 *
 * Ritorna la lista dei server parsati (link non validi saltati).
 */
/**
 * Parsa un testo di configurazione che può essere:
 *   - Xray/V2Ray JSON (config singola o array di config)
 *   - subscription base64 / share-link / testo con più link
 *
 * Ritorna la lista dei server parsati ([] se nessuno valido).
 */
export function parseConfigText(text: string): ParsedServer[] {
    const trimmed = text.trim();
    if (!trimmed) return [];

    // Xray/V2Ray JSON prima (più specifico).
    const xray = parseXrayJson(trimmed);
    if (xray) return xray;

    // Fallback: share-link / base64 / testo.
    return parseSubscriptionText(trimmed);
}

export function parseSubscriptionText(text: string): ParsedServer[] {
    const trimmed = text.trim();
    if (!trimmed) return [];

    // Se è già un link singolo → parsa direttamente.
    if (/^[a-z0-9]+:\/\//i.test(trimmed) && !trimmed.includes('\n')) {
        const one = parseShareLink(trimmed);
        return one ? [one] : [];
    }

    // Prova a decodificare come base64 (subscription tipica).
    let decoded = trimmed;
    const looksBase64 = /^[A-Za-z0-9+/=\-_]+$/.test(trimmed) && trimmed.length > 20;
    if (looksBase64) {
        try {
            const d = decodeBase64UrlSafe(trimmed);
            if (d.includes('://')) decoded = d;
        } catch { /* non è base64 → usa il testo così com'è */ }
    }

    const servers: ParsedServer[] = [];
    for (const line of decoded.split(/\r?\n/)) {
        const s = parseShareLink(line);
        if (s) servers.push(s);
    }
    return servers;
}

/* ── Parser Xray / V2Ray JSON ─────────────────────────────────── */

/**
 * Converte un outbound Xray/V2Ray (formato JSON) in ParsedServer.
 *
 * Struttura Xray (es. subscription "app=happ"):
 *   {
 *     "protocol": "vless" | "vmess" | "trojan" | "shadowsocks",
 *     "settings": { "vnext": [{ "address", "port", "users": [{ "id", "flow", "security" }] }],
 *                   "servers": [{ "address", "port", "method", "password", "email" }] },
 *     "streamSettings": {
 *       "network": "tcp" | "ws" | "grpc" | "xhttp" | "h2",
 *       "security": "tls" | "reality" | "none",
 *       "tlsSettings": { "serverName", "allowInsecure", "fingerprint" },
 *       "realitySettings": { "serverName", "publicKey", "shortId", "spiderX", "fingerprint" },
 *       "wsSettings": { "path", "headers": { "Host" } },
 *       "grpcSettings": { "serviceName", "multiMode" },
 *       "xhttpSettings": { "path", "mode" }
 *     }
 *   }
 *
 * Ritorna null se l'outbound non è riconosciuto/valido.
 */
function parseXrayOutbound(ob: any): ParsedServer | null {
    if (!ob || typeof ob !== 'object') return null;
    const protocol = String(ob.protocol || '').toLowerCase();
    const ss = ob.settings || {};
    const stream = ob.streamSettings || {};

    // Estrai host/porta/uuid/password in base al protocollo.
    let host = '';
    let port = 0;
    let uuid: string | undefined;
    let password: string | undefined;
    let method: string | undefined;
    let flow: string | undefined;

    if (protocol === 'vless' || protocol === 'vmess') {
        const vnext = Array.isArray(ss.vnext) ? ss.vnext[0] : null;
        if (!vnext) return null;
        host = String(vnext.address || '');
        port = Number(vnext.port) || 0;
        const user = Array.isArray(vnext.users) ? vnext.users[0] : null;
        if (user) {
            uuid = String(user.id || '');
            flow = user.flow ? String(user.flow) : undefined;
            if (protocol === 'vmess') method = String(user.security || 'auto');
        }
    } else if (protocol === 'trojan') {
        const servers = Array.isArray(ss.servers) ? ss.servers[0] : null;
        if (!servers) return null;
        host = String(servers.address || '');
        port = Number(servers.port) || 0;
        password = String(servers.password || '');
    } else if (protocol === 'shadowsocks') {
        const servers = Array.isArray(ss.servers) ? ss.servers[0] : null;
        if (!servers) return null;
        host = String(servers.address || '');
        port = Number(servers.port) || 0;
        method = String(servers.method || '');
        password = String(servers.password || '');
    } else if (protocol === 'hysteria2' || protocol === 'hysteria') {
        // hysteria2 non è un protocollo Xray nativo, ma molte subscription
        // "app=happ" lo includono. Due forme possibili:
        //   A) settings.servers[0].auth  (sing-box style)
        //   B) settings.address/port + streamSettings.hysteriaSettings.auth (Xray style)
        const servers = Array.isArray(ss.servers) ? ss.servers[0] : null;
        if (servers) {
            host = String(servers.address || '');
            port = Number(servers.port) || 0;
            password = String(servers.auth || servers.password || '');
        } else {
            host = String(ss.address || '');
            port = Number(ss.port) || 0;
            const hy = stream.hysteriaSettings || {};
            password = String(hy.auth || ss.auth || ss.password || '');
        }
    } else {
        return null;
    }

    if (!host || !port) return null;

    // Security: tls / reality / none
    const security = String(stream.security || 'none').toLowerCase();
    const tls = security === 'tls' || security === 'reality';
    const tlsSettings = stream.tlsSettings || {};
    const realitySettings = stream.realitySettings || {};
    const sni = String(
        realitySettings.serverName || tlsSettings.serverName || stream.serverName || ''
    ) || (tls ? host : undefined);
    const insecure = !!(tlsSettings.allowInsecure || stream.allowInsecure);

    // Network / transport
    const network = String(stream.network || 'tcp').toLowerCase();
    let transport: ParsedServer['transport'] = 'tcp';
    let wsHost: string | undefined;
    let wsPath: string | undefined;
    let grpcServiceName: string | undefined;
    let xhttpPath: string | undefined;
    let xhttpMode: string | undefined;

    if (network === 'ws') {
        transport = 'ws';
        const ws = stream.wsSettings || {};
        wsPath = ws.path ? String(ws.path) : undefined;
        wsHost = ws.headers?.Host ? String(ws.headers.Host) : undefined;
    } else if (network === 'grpc') {
        transport = 'grpc';
        const grpc = stream.grpcSettings || {};
        grpcServiceName = grpc.serviceName ? String(grpc.serviceName) : undefined;
    } else if (network === 'xhttp') {
        transport = 'xhttp';
        const xhttp = stream.xhttpSettings || {};
        xhttpPath = xhttp.path ? String(xhttp.path) : undefined;
        xhttpMode = xhttp.mode ? String(xhttp.mode) : undefined;
    }

    const tag = String(ob.tag || ob.remarks || `${host}:${port}`);

    return {
        tag,
        protocol: protocol === 'shadowsocks' ? 'ss' : protocol === 'hysteria' ? 'hysteria2' : (protocol as ParsedServer['protocol']),
        host,
        port,
        uuid,
        password,
        method,
        tls,
        sni,
        insecure,
        flow,
        transport,
        wsHost,
        wsPath,
        grpcServiceName,
        realityPublicKey: realitySettings.publicKey ? String(realitySettings.publicKey) : undefined,
        realityShortId: realitySettings.shortId ? String(realitySettings.shortId) : undefined,
        realitySpiderX: realitySettings.spiderX ? String(realitySettings.spiderX) : undefined,
        xhttpPath,
        xhttpMode,
        raw: JSON.stringify(ob),
    };
}

/**
 * Rileva e parsa una subscription in formato Xray/V2Ray JSON.
 *
 * Formati accettati:
 *   - array di config completi: [{ outbounds: [...] }, ...]
 *   - oggetto config singolo:   { outbounds: [...] }
 *   - array di outbounds:       [{ protocol, settings, streamSettings }, ...]
 *
 * Ritorna null se il testo non è JSON Xray (così il chiamante può
 * provare altri formati).
 */
export function parseXrayJson(text: string): ParsedServer[] | null {
    const trimmed = text.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;

    let data: any;
    try {
        data = JSON.parse(trimmed);
    } catch {
        return null;
    }

    // Raccogli tutti gli outbounds da qualsiasi forma.
    const outbounds: any[] = [];
    const collect = (node: any) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            for (const item of node) collect(item);
            return;
        }
        if (Array.isArray(node.outbounds)) {
            for (const ob of node.outbounds) outbounds.push(ob);
        }
        // Ricorsione per array annidati di config.
        for (const key of Object.keys(node)) {
            if (key === 'outbounds') continue;
            if (Array.isArray(node[key]) || (node[key] && typeof node[key] === 'object')) {
                collect(node[key]);
            }
        }
    };
    collect(data);

    const servers: ParsedServer[] = [];
    for (const ob of outbounds) {
        const s = parseXrayOutbound(ob);
        if (s) servers.push(s);
    }
    return servers.length > 0 ? servers : null;
}