// lib/mediaflowproxy/mediaflowproxy.ts
//
// P19: la password MFP e gli header (incluso `authorization`) NON devono
// comparire nella query string dell'URL finale. L'URL viene consumato dal
// player lato client (che non può impostare header HTTP), quindi l'unica
// opzione sicura è usare l'endpoint /generate_url di MediaFlow Proxy, che
// cifra TUTTI i parametri (d, h_*, api_password) in un token AES-CBC nel
// path dell'URL (_token_/...), con TTL (expiration) e opzionale restrizione IP.
import { ParamountSession } from "@/lib/paramount/client";
import { PPLUS_BASE_URL, PPLUS_HEADER, sessionFingerprint } from "@/lib/paramount/utils";
import { httpClient } from "@/lib/http/client";

export type MediaFlowConfig = {
    url: string;
    password: string;
    expirationSeconds: number;
};

function normalizeBaseUrl(raw: string) {
    return raw.replace(/\/+$/, "");
}

function buildCookieHeader(cookies: string[] | undefined): string | undefined {
    if (!cookies?.length) return undefined;
    return cookies
        .map((c) => c.split(";")[0].trim())
        .filter(Boolean)
        .join("; ");
}

export function getMediaFlowConfig(): MediaFlowConfig | null {
    const url = process.env.MFP_URL;
    const password = process.env.MFP_PASS;
    if (!url || !password) return null;

    return {
        url: normalizeBaseUrl(url),
        password,
        expirationSeconds: Number(process.env.MFP_EXPIRATION ?? "3600"),
    };
}

// Cache breve per le URL generate: la route stream chiama wrapUrlWithMediaFlow
// due volte (MPEG-TS + HLS) e il player può richiedere di nuovo lo stesso stream.
const URL_CACHE_TTL = 60 * 1000;
const urlCache = new Map<string, { url: string; expiresAt: number }>();

function cacheKey(destinationUrl: string, mpegts: boolean, lsSession: string, session: ParamountSession): string {
    return `${mpegts ? "ts" : "hls"}|${lsSession}|${sessionFingerprint(session)}|${destinationUrl}`;
}

/**
 * Genera un URL MFP "firmato" (encrypted) tramite l'endpoint /generate_url.
 * La password NON compare mai nella query string dell'URL finale: viene usata
 * solo come chiave di cifratura del token AES-CBC nel path (_token_/...).
 * Il token scade dopo `expirationSeconds` (TTL).
 */
async function generateEncryptedUrl(
    cfg: MediaFlowConfig,
    destinationUrl: string,
    headers: Record<string, string>,
    mpegts: boolean
): Promise<string | null> {
    const endpoint = mpegts ? "/proxy/stream" : "/proxy/hls/manifest.m3u8";

    const body = {
        mediaflow_proxy_url: cfg.url,
        endpoint,
        destination_url: destinationUrl,
        request_headers: headers,
        expiration: cfg.expirationSeconds,
        api_password: cfg.password,
    };

    try {
        const { status, data } = await httpClient.post(`${cfg.url}/generate_url`, body, {
            headers: { "content-type": "application/json" },
        });
        if (status !== 200) {
            console.warn(`[MFP] /generate_url -> HTTP ${status}`);
            return null;
        }
        const url = data?.url;
        if (typeof url !== "string" || !url) {
            console.warn("[MFP] /generate_url risposta senza campo 'url'");
            return null;
        }
        return url;
    } catch (error: any) {
        // P19: nessun fallback alla query string — la password non deve MAI
        // riapparire nell'URL. Se la generazione fallisce, lo stream MFP
        // semplicemente non viene offerto.
        console.error(`[MFP] Errore /generate_url: ${error?.message ?? error}`);
        return null;
    }
}

export async function wrapUrlWithMediaFlow(
    destinationUrl: URL,
    session: ParamountSession,
    lsSession: string,
    mpegts: boolean
): Promise<string | null> {
    const cfg = getMediaFlowConfig();
    if (!cfg) return null;

    const headers: Record<string, string> = {
        "user-agent": await PPLUS_HEADER(),
        "origin": PPLUS_BASE_URL,
        "referer": PPLUS_BASE_URL,
    };
    headers["authorization"] = `Bearer ${lsSession}`;
    const cookie = buildCookieHeader(session.cookies);
    // FIX: prima veniva inviato come "set-cookie" (header di risposta!),
    // MFP lo inoltrava tale e quale all'upstream. L'header corretto è "cookie".
    if (cookie) headers["cookie"] = cookie;

    const dest = destinationUrl.toString();
    const key = cacheKey(dest, mpegts, lsSession, session);
    const cached = urlCache.get(key);
    if (cached && Date.now() < cached.expiresAt) return cached.url;

    const url = await generateEncryptedUrl(cfg, dest, headers, mpegts);
    if (!url) return null;

    urlCache.set(key, { url, expiresAt: Date.now() + URL_CACHE_TTL });
    return url;
}
