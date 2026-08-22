/**
 * Test live della connessione VPN/proxy.
 *
 * Prova a scaricare una risorsa "leggera" da paramountplus.com attraverso
 * il proxy configurato. Se la risposta è 200 e il body NON contiene pattern
 * "VPN detected" → OK. Altrimenti → VPN detected / blocked / geo-restricted.
 *
 * Per ottenere l'IP pubblico e il paese, usa ipinfo.io (gratis, no auth).
 */

import { ProxyAgent } from 'proxy-agent';
import { httpClient } from '../http/client';

const PROBE_URL = process.env.PROXY_PROBE_URL || 'https://www.paramountplus.com/';
const IPINFO_URL = 'https://ipinfo.io/json';

export type ProbeResult = {
    ok: boolean;
    proxy: string | null;
    probeUrl: string;
    statusCode?: number;
    error?: string;
    vpnDetected: boolean;
    geoBlocked: boolean;
    ip?: string;
    country?: string;
    city?: string;
    org?: string;
    elapsedMs: number;
    checkedAt: string;
};

const VPN_PATTERNS = [
    /vpn/i,
    /proxy/i,
    /unblock/i,
    /geo[-_ ]?block/i,
    /not available in your (country|region|location)/i,
    /outside (the united states|the us)/i,
    /error 451/i,
];

function detectVpnInBody(body: string | undefined): boolean {
    if (!body) return false;
    const sample = body.slice(0, 8192).toLowerCase();
    return VPN_PATTERNS.some(re => re.test(sample));
}

async function probeOne(proxyUrl: string | null): Promise<ProbeResult> {
    const start = Date.now();
    const result: ProbeResult = {
        ok: false,
        proxy: proxyUrl,
        probeUrl: PROBE_URL,
        vpnDetected: false,
        geoBlocked: false,
        elapsedMs: 0,
        checkedAt: new Date().toISOString(),
    };
    try {
        // Step 1: probe Paramount+ homepage.
        const headers: Record<string, string> = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
        };
        const response = proxyUrl
            ? await fetchWithProxy(PROBE_URL, proxyUrl, headers)
            : await fetch(PROBE_URL, { headers, signal: AbortSignal.timeout(20000) });
        result.statusCode = response.status;
        const body = await response.text().catch(() => '');
        result.vpnDetected = detectVpnInBody(body);
        result.geoBlocked = response.status === 451 || /451/.test(body.slice(0, 4096));
        result.ok = response.ok && !result.vpnDetected && !result.geoBlocked;

        // Step 2: ipinfo per IP/paese (solo se il probe è andato bene).
        if (result.ok || result.statusCode === 200) {
            try {
                const ipResp = proxyUrl
                    ? await fetchWithProxy(IPINFO_URL, proxyUrl, headers)
                    : await fetch(IPINFO_URL, { headers, signal: AbortSignal.timeout(10000) });
                if (ipResp.ok) {
                    const ipBody = await ipResp.json();
                    result.ip = ipBody.ip;
                    result.country = ipBody.country;
                    result.city = ipBody.city;
                    result.org = ipBody.org;
                }
            } catch {
                // Non bloccare: il probe Paramount+ ha già dato il verdetto.
            }
        }
    } catch (err: any) {
        result.error = err?.message || String(err);
        result.ok = false;
    } finally {
        result.elapsedMs = Date.now() - start;
    }
    return result;
}

async function fetchWithProxy(url: string, proxyUrl: string, headers: Record<string, string>): Promise<Response> {
    const agent = new ProxyAgent({ getProxyForUrl: () => proxyUrl });
    // @ts-expect-error - undici/Node fetch accepts dispatcher (TS lib doesn't declare it)
    return await fetch(url, { headers, signal: AbortSignal.timeout(20000), dispatcher: agent });
}

/** Esegue il test live sul proxy specificato (o usa il round-robin corrente). */
export async function testConnection(proxyUrl?: string | null): Promise<ProbeResult[]> {
    if (proxyUrl !== undefined) {
        return [await probeOne(proxyUrl)];
    }
    // Altrimenti testa tutti i proxy conosciuti.
    const status = httpClient.getProxyStatus();
    const urls = status.map(s => s.url);
    if (urls.length === 0) {
        return [await probeOne(null)];
    }
    const results = await Promise.all(urls.map(u => probeOne(u)));
    return results;
}

/** Test veloce del primo proxy alive (per la UI: "Test connection"). */
export async function quickTest(): Promise<ProbeResult> {
    const status = httpClient.getProxyStatus();
    // Preferisci un proxy alive, altrimenti il primo.
    const alive = status.find(s => s.status === 'alive');
    const url = alive?.url ?? status[0]?.url ?? null;
    return await probeOne(url);
}
