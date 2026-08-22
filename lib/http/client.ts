import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { ProxyAgent } from 'proxy-agent';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';

// ── Parsing della lista di proxy ──────────────────────────────────────────
// Legge PROXY_URLS (comma-separated) e fa fallback a HTTP_PROXY / HTTPS_PROXY
// per retro-compatibilità. Restituisce un array normalizzato di URL (vuoto se
// nessun proxy è configurato).
function parseProxyList(): string[] {
    const fromList = (process.env.PROXY_URLS || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

    const fromSingle = [
        process.env.HTTP_PROXY,
        process.env.HTTPS_PROXY,
        process.env.http_proxy,
        process.env.https_proxy,
    ]
        .map(s => (s || '').trim())
        .filter(Boolean);

    const merged = [...fromList, ...fromSingle];
    // Dedup preservando l'ordine
    const seen = new Set<string>();
    const out: string[] = [];
    for (const url of merged) {
        if (!seen.has(url)) {
            seen.add(url);
            out.push(url);
        }
    }
    return out;
}

let PROXY_URLS: string[] = parseProxyList();

/** Sostituisce la lista proxy a runtime e azzera gli stati. Usato da /api/vpn/setup. */
export function setProxyUrls(urls: string[]): void {
    PROXY_URLS = urls
        .map(s => (s || '').trim())
        .filter(Boolean);
    // Dedup preservando l'ordine
    const seen = new Set<string>();
    PROXY_URLS = PROXY_URLS.filter(u => {
        if (seen.has(u)) return false;
        seen.add(u);
        return true;
    });
    proxyStates.clear();
}

/** Ritorna la lista proxy corrente. */
export function getProxyUrls(): string[] {
    return [...PROXY_URLS];
}

// ── Stato di salute per proxy ─────────────────────────────────────────────
// Ogni proxy ha uno score (0-100) e uno stato derivato:
//   - "unknown"  → non ancora testato
//   - "alive"    → funziona (score >= ALIVE_THRESHOLD)
//   - "throttled"→ restituisce 402 (bandwidth limit)
//   - "blocked"  → Paramount+ ha rilevato VPN / geo-block
//   - "dead"     → errore di connessione
//
// Lo score scende dopo ogni fallimento e risale lentamente dopo ogni successo.
// Un proxy "non alive" viene escluso dal round-robin fino a quando non supera
// il probe periodico o il cooldown.
//
const ALIVE_THRESHOLD = 70;
const BLOCKED_COOLDOWN_MS = 30 * 60 * 1000; // 30 minuti prima di ritestare un proxy bloccato
const THROTTLED_COOLDOWN_MS = 5 * 60 * 1000; // 5 minuti per proxy throttled
const DEAD_COOLDOWN_MS = 2 * 60 * 1000;       // 2 minuti per proxy morto

type ProxyState = {
    status: 'unknown' | 'alive' | 'throttled' | 'blocked' | 'dead';
    score: number;
    expiresAt: number; // timestamp ms fino a quando è escluso dal round-robin
    lastError?: string;
    lastCheckedAt: number;
    lastStatusCode?: number;
};

const proxyStates: Map<number, ProxyState> = new Map();

function getOrInitState(index: number): ProxyState {
    let s = proxyStates.get(index);
    if (!s) {
        s = {
            status: 'unknown',
            score: 100,
            expiresAt: 0,
            lastCheckedAt: 0,
        };
        proxyStates.set(index, s);
    }
    return s;
}

function isExcluded(index: number): boolean {
    const s = proxyStates.get(index);
    if (!s) return false;
    if (s.status === 'alive') return false;
    if (Date.now() >= s.expiresAt) {
        // Cooldown scaduto: rimetti in "unknown" così verrà ri-testato.
        s.status = 'unknown';
        s.expiresAt = 0;
        return false;
    }
    return true;
}

function markThrottled(index: number, statusCode?: number, msg?: string): void {
    const s = getOrInitState(index);
    s.status = 'throttled';
    s.score = Math.max(0, s.score - 30);
    s.expiresAt = Date.now() + THROTTLED_COOLDOWN_MS;
    s.lastCheckedAt = Date.now();
    s.lastStatusCode = statusCode;
    s.lastError = msg;
}

function markBlocked(index: number, statusCode?: number, msg?: string): void {
    const s = getOrInitState(index);
    s.status = 'blocked';
    s.score = Math.max(0, s.score - 50);
    s.expiresAt = Date.now() + BLOCKED_COOLDOWN_MS;
    s.lastCheckedAt = Date.now();
    s.lastStatusCode = statusCode;
    s.lastError = msg;
}

function markDead(index: number, msg?: string): void {
    const s = getOrInitState(index);
    s.status = 'dead';
    s.score = Math.max(0, s.score - 40);
    s.expiresAt = Date.now() + DEAD_COOLDOWN_MS;
    s.lastCheckedAt = Date.now();
    s.lastError = msg;
}

function markAlive(index: number, bonus = 5): void {
    const s = getOrInitState(index);
    s.status = 'alive';
    s.score = Math.min(100, s.score + bonus);
    s.expiresAt = 0;
    s.lastCheckedAt = Date.now();
    s.lastError = undefined;
}

// ── Euristica "VPN detected" ──────────────────────────────────────────────
// Alcuni pattern che Paramount+/CDN usano quando rilevano una VPN:
//   - status 403 con body che contiene "vpn", "proxy", "unblock"
//   - status 451 ("Unavailable For Legal Reasons") geo-block
//   - HTML reindirizzato a pagine di errore geo-block
const VPN_DETECT_PATTERNS = [
    /vpn/i,
    /proxy/i,
    /unblock/i,
    /geo[-_ ]?block/i,
    /not available in your (country|region|location)/i,
    /outside (the united states|the us)/i,
];

function looksLikeVpnDetected(status: number, body: string | undefined): boolean {
    if (status === 451) return true; // geo-block
    if (status !== 403 && status !== 407) return false;
    if (!body) return false;
    return VPN_DETECT_PATTERNS.some(p => p.test(body));
}

// ── Round-robin counter ───────────────────────────────────────────────────
let roundRobinCursor = 0;

function pickAgent(): { agent: ProxyAgent | null; index: number; proxyUrl: string | null } {
    const n = PROXY_URLS.length;
    if (n === 0) return { agent: null, index: -1, proxyUrl: null };

    for (let offset = 0; offset < n; offset++) {
        const idx = (roundRobinCursor + offset) % n;
        if (!isExcluded(idx)) {
            roundRobinCursor = (idx + 1) % n;
            return {
                agent: new ProxyAgent({ getProxyForUrl: () => PROXY_URLS[idx] }),
                index: idx,
                proxyUrl: PROXY_URLS[idx],
            };
        }
    }

    // Tutti esclusi: ritorna il meno "rotto" (score più alto)
    let bestIdx = 0;
    let bestScore = -1;
    for (let i = 0; i < n; i++) {
        const s = getOrInitState(i);
        if (s.score > bestScore) {
            bestScore = s.score;
            bestIdx = i;
        }
    }
    roundRobinCursor = (bestIdx + 1) % n;
    return {
        agent: new ProxyAgent({ getProxyForUrl: () => PROXY_URLS[bestIdx] }),
        index: bestIdx,
        proxyUrl: PROXY_URLS[bestIdx],
    };
}

// ── Probe all'avvio: testa ogni proxy con un endpoint sentinella ──────────
// URL sentinella di default: homepage Paramount+ (ci dice se la VPN viene
// rilevata PRIMA ancora di provare a fare login).
const PROBE_URL = process.env.PROXY_PROBE_URL || 'https://www.paramountplus.com/';

async function probeProxy(index: number, proxyUrl: string): Promise<void> {
    const agent = new ProxyAgent({ getProxyForUrl: () => proxyUrl });
    try {
        const resp = await axios.get(PROBE_URL, {
            httpAgent: agent,
            httpsAgent: agent,
            proxy: false,
            timeout: 15000,
            validateStatus: () => true,
            maxRedirects: 0,
        });
        const body = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data ?? '');
        if (resp.status === 200) {
            markAlive(index, 10);
            console.log(`[PROXY-PROBE] ${proxyUrl} → ALIVE (status ${resp.status})`);
        } else if (resp.status === 402) {
            markThrottled(index, resp.status, 'bandwidth limit');
            console.warn(`[PROXY-PROBE] ${proxyUrl} → THROTTLED (status 402)`);
        } else if (looksLikeVpnDetected(resp.status, body)) {
            markBlocked(index, resp.status, body.slice(0, 120));
            console.warn(`[PROXY-PROBE] ${proxyUrl} → BLOCKED (VPN detected, status ${resp.status})`);
        } else {
            // Status inatteso: trattalo come alive ma abbassa un po' lo score.
            markAlive(index, 0);
            s_last(index, resp.status);
            console.warn(`[PROXY-PROBE] ${proxyUrl} → UNEXPECTED status ${resp.status}, treating as alive`);
        }
    } catch (err: any) {
        markDead(index, err?.code || err?.message);
        console.warn(`[PROXY-PROBE] ${proxyUrl} → DEAD (${err?.code || err?.message})`);
    }
}

function s_last(index: number, status: number): void {
    const s = getOrInitState(index);
    s.lastStatusCode = status;
    s.lastCheckedAt = Date.now();
}

async function probeAllProxies(): Promise<void> {
    if (PROXY_URLS.length === 0) return;
    console.log(`[PROXY-PROBE] Testing ${PROXY_URLS.length} proxy(ies) against ${PROBE_URL}...`);
    await Promise.all(PROXY_URLS.map((url, idx) => probeProxy(idx, url)));
    // Riepilogo
    const summary = PROXY_URLS.map((url, idx) => {
        const s = getOrInitState(idx);
        return `  - ${url}: ${s.status} (score ${s.score})`;
    }).join('\n');
    console.log(`[PROXY-PROBE] Done:\n${summary}`);
}

// Probe periodico in background: ritesta i proxy "esclusi" ogni 5 minuti.
let probeTimer: NodeJS.Timeout | null = null;
function schedulePeriodicProbe(): void {
    if (probeTimer) return;
    const intervalMs = 5 * 60 * 1000;
    probeTimer = setInterval(() => {
        const hasExcluded = PROXY_URLS.some((_, idx) => {
            const s = proxyStates.get(idx);
            return s && s.status !== 'alive';
        });
        if (hasExcluded) probeAllProxies().catch(() => { });
    }, intervalMs);
    if (typeof probeTimer.unref === 'function') probeTimer.unref();
}

// Codes di errore che indicano un problema del proxy (e giustificano fallback).
const PROXY_FAILURE_CODES = new Set([
    'ERR_BAD_RESPONSE',
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EPIPE',
]);

export class HttpClient {
    private client: AxiosInstance;
    private probeStarted = false;

    constructor() {
        const initial = pickAgent();
        const httpAgent = initial.agent ?? new HttpAgent({ keepAlive: true });
        const httpsAgent = initial.agent ?? new HttpsAgent({ keepAlive: true });

        this.client = axios.create({
            timeout: 30000,
            httpAgent,
            httpsAgent,
            proxy: false,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            validateStatus: (status) => status < 500,
        });

        // Avvia probe async senza bloccare il constructor.
        if (PROXY_URLS.length > 0 && !this.probeStarted) {
            this.probeStarted = true;
            // Defer di un tick per non bloccare l'avvio.
            setImmediate(() => {
                probeAllProxies()
                    .then(() => schedulePeriodicProbe())
                    .catch(() => schedulePeriodicProbe());
            });
        }
    }

    /** Ritorna una vista dello stato di tutti i proxy (per diagnostica). */
    public getProxyStatus(): Array<{
        url: string;
        status: ProxyState['status'];
        score: number;
        excluded: boolean;
        lastError?: string;
        lastStatusCode?: number;
        lastCheckedAt: number;
    }> {
        return PROXY_URLS.map((url, idx) => {
            const s = getOrInitState(idx);
            return {
                url,
                status: s.status,
                score: s.score,
                excluded: isExcluded(idx),
                lastError: s.lastError,
                lastStatusCode: s.lastStatusCode,
                lastCheckedAt: s.lastCheckedAt,
            };
        });
    }

    /** Forza un nuovo probe di tutti i proxy (utile dopo cambio di configurazione). */
    public async reprobe(): Promise<void> {
        // Azzera tutti gli expiresAt per forzare il re-test.
        for (let i = 0; i < PROXY_URLS.length; i++) {
            const s = proxyStates.get(i);
            if (s) {
                s.expiresAt = 0;
                s.status = 'unknown';
            }
        }
        await probeAllProxies();
    }

    private buildResponse(response: any): {
        status: number;
        data: any;
        headers: Headers;
        cookies: string[];
    } {
        const responseHeaders = new Headers();
        Object.entries(response.headers || {}).forEach(([key, value]) => {
            if (Array.isArray(value)) {
                value.forEach(v => responseHeaders.append(key, v));
            } else if (value) {
                responseHeaders.set(key, value as string);
            }
        });

        return {
            status: response.status,
            data: response.data,
            headers: responseHeaders,
            cookies: response.headers?.['set-cookie'] || [],
        };
    }

    private async baseRequest(config: AxiosRequestConfig): Promise<{
        status: number;
        data: any;
        headers: Headers;
        cookies: string[];
    }> {
        if (PROXY_URLS.length === 0) {
            return this.baseRequestSingle(config, null);
        }

        const n = PROXY_URLS.length;
        const tried = new Set<number>();
        let lastError: any = null;

        for (let attempt = 0; attempt < n; attempt++) {
            const { agent, index, proxyUrl } = pickAgent();
            if (tried.has(index)) break;
            tried.add(index);

            try {
                const perAttemptConfig: AxiosRequestConfig = {
                    ...config,
                    httpAgent: agent ?? new HttpAgent({ keepAlive: true }),
                    httpsAgent: agent ?? new HttpsAgent({ keepAlive: true }),
                    proxy: false,
                };

                const response = await this.client.request(perAttemptConfig);

                // 402 → bandwidth limit → marca throttled, ritenta.
                if (response.status === 402) {
                    markThrottled(index, 402, 'bandwidth limit');
                    const bodyPreview = typeof response.data === 'string'
                        ? response.data.slice(0, 200)
                        : JSON.stringify(response.data)?.slice(0, 200);
                    console.warn(
                        `[HTTP] proxy ${proxyUrl} returned 402 — falling back. Body: ${bodyPreview ?? ''}`,
                    );
                    continue;
                }

                // 403/407/451 con pattern VPN → marca blocked, ritenta.
                const bodyStr = typeof response.data === 'string'
                    ? response.data
                    : JSON.stringify(response.data ?? '');
                if (looksLikeVpnDetected(response.status, bodyStr)) {
                    markBlocked(index, response.status, bodyStr.slice(0, 200));
                    console.warn(
                        `[HTTP] proxy ${proxyUrl} looks like VPN-detected (status ${response.status}) — falling back.`,
                    );
                    continue;
                }

                // Risposta valida: marca alive e ritorna.
                markAlive(index);
                if (response.status >= 400) {
                    const bodyPreview = bodyStr.slice(0, 300);
                    console.warn(
                        `[HTTP] ${config.method ?? 'GET'} ${config.url} (via ${proxyUrl}) -> ${response.status} ${bodyPreview ?? ''}`,
                    );
                }
                return this.buildResponse(response);
            } catch (error: any) {
                lastError = error;
                if (error?.code && PROXY_FAILURE_CODES.has(error.code)) {
                    markDead(index, error.code);
                    console.warn(
                        `[HTTP] proxy ${proxyUrl} failed (${error.code}): ${error.message} — falling back.`,
                    );
                    continue;
                }
                this.handleError(error, config.url || 'unknown', proxyUrl);
                throw error;
            }
        }

        if (lastError) {
            this.handleError(lastError, config.url || 'unknown', null);
            throw lastError;
        }
        throw new Error('[HTTP] All proxies failed without a specific error');
    }

    private async baseRequestSingle(
        config: AxiosRequestConfig,
        proxyUrl: string | null,
    ): Promise<{
        status: number;
        data: any;
        headers: Headers;
        cookies: string[];
    }> {
        try {
            const response = await this.client.request(config);
            if (response.status >= 400) {
                const bodyPreview = typeof response.data === 'string'
                    ? response.data.slice(0, 300)
                    : JSON.stringify(response.data)?.slice(0, 300);
                const proxyHint = proxyUrl ? ` (via ${proxyUrl})` : '';
                console.warn(
                    `[HTTP] ${config.method ?? 'GET'} ${config.url}${proxyHint} -> ${response.status} ${bodyPreview ?? ''}`,
                );
            }
            return this.buildResponse(response);
        } catch (error: any) {
            this.handleError(error, config.url || 'unknown', proxyUrl);
            throw error;
        }
    }

    public async get(url: string, config: AxiosRequestConfig = {}) {
        return this.baseRequest({ method: 'GET', url, ...config });
    }

    public async getDirect(url: string, config: AxiosRequestConfig = {}) {
        return this.baseRequestSingle(
            {
                method: 'GET',
                url,
                httpAgent: new HttpAgent({ keepAlive: true }),
                httpsAgent: new HttpsAgent({ keepAlive: true }),
                proxy: false,
                ...config,
            },
            null,
        );
    }

    public async post(url: string, body?: any, config: AxiosRequestConfig = {}) {
        return this.baseRequest({ method: 'POST', url, data: body, ...config });
    }

    public async put(url: string, body?: any, config: AxiosRequestConfig = {}) {
        return this.baseRequest({ method: 'PUT', url, data: body, ...config });
    }

    private handleError(error: any, url: string, proxyUrl: string | null) {
        const proxyHint = proxyUrl ? ` (via ${proxyUrl})` : '';
        if (error?.code === 'ECONNABORTED') {
            console.error(`[TIMEOUT] Request to ${url}${proxyHint} expired.`);
        } else if (error?.code === 'ERR_BAD_RESPONSE') {
            console.error(`[PROXY] SOCKS5/HTTP Proxy connection refused or protocol error${proxyHint}.`);
        } else {
            console.error(`[ERROR] ${url}${proxyHint}: ${error?.message ?? error}`);
        }
    }
}

const globalForHttpClient = global as unknown as {
    httpClient: HttpClient | undefined;
};
export const httpClient = globalForHttpClient.httpClient ?? new HttpClient();
