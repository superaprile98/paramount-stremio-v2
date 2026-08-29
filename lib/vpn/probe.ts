/**
 * Test live della connessione VPN/proxy.
 *
 * Prova a scaricare una risorsa "leggera" da paramountplus.com attraverso
 * il proxy configurato. Se la risposta è 200 e il body NON contiene pattern
 * "VPN detected" → OK. Altrimenti → VPN detected / blocked / geo-restricted.
 *
 * Per ottenere l'IP pubblico e il paese, usa ipinfo.io (gratis, no auth).
 */

import axios from 'axios';
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

type ProbeResponse = {
    status: number;
    ok: boolean;
    text: string;
    json: any;
};

async function requestWithProxy(
    url: string,
    proxyUrl: string | null,
    headers: Record<string, string>,
    timeoutMs: number,
): Promise<ProbeResponse> {
    const config: Record<string, any> = {
        headers,
        timeout: timeoutMs,
        validateStatus: () => true,
        // Paramount+ homepage esegue un redirect 302 verso la variante regionale
        // (es. www.it.paramountplus.com) -> se non seguiamo il redirect sing-box
        // riceve 302 e il probe segnala fallimento anche se la VPN funziona.
        // Seguiamo fino a 5 redirect e consideriamo ok qualunque 2xx/3xx finale.
        maxRedirects: 5,
        responseType: 'text',
    };
    if (proxyUrl) {
        // proxy-agent: ProxyAgent è un http.Agent pensato per axios/http.request,
        // NON per il dispatcher del fetch nativo (undici). Stesso pattern di lib/http/client.ts.
        const agent = new ProxyAgent({ getProxyForUrl: () => proxyUrl });
        config.httpAgent = agent;
        config.httpsAgent = agent;
        config.proxy = false;
    }
    const resp = await axios.get(url, config);
    return {
        status: resp.status,
        // 2xx: ok. 3xx: Paramount+ usa redirect per la variante regionale, ed
        // arrivarci tramite il proxy è comunque un segnale che la VPN funziona.
        ok: resp.status >= 200 && resp.status < 400,
        text: typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data ?? ''),
        json: resp.data,
    };
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
        const response = await requestWithProxy(PROBE_URL, proxyUrl, headers, 20000);
        result.statusCode = response.status;
        const body = response.text;
        result.vpnDetected = detectVpnInBody(body);
        // Geo-block reale = HTTP 451. Il pattern /451/ sul body è un falso
        // positivo (es. "BUILD_NUMBER":"2451" nella homepage di Paramount+).
        result.geoBlocked = response.status === 451;
        result.ok = response.ok && !result.vpnDetected && !result.geoBlocked;

        // Step 2: ipinfo per IP/paese (solo se il probe è andato bene).
        if (result.ok || result.statusCode === 200) {
            try {
                const ipResp = await requestWithProxy(IPINFO_URL, proxyUrl, headers, 10000);
                if (ipResp.ok && ipResp.json && typeof ipResp.json === 'object') {
                    result.ip = ipResp.json.ip;
                    result.country = ipResp.json.country;
                    result.city = ipResp.json.city;
                    result.org = ipResp.json.org;
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
