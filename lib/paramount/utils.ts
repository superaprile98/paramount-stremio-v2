import crypto from "crypto";
import { NextRequest } from "next/server";
import { httpClient } from "@/lib/http/client";

export const PPLUS_BASE_URL = "https://www.paramountplus.com";
export const PPLUS_AT_TOKEN_US = "ABB+XYTJa4Y14QBS5+7jCYvFe04w88I5dxzStu4zlQ4rqTTW/iMZ33tuiqPzzdgMJjQ=";
export const PPLUS_LOCALE_US = "en-us";
export const PPLUS_APP_VERSION_FALLBACK = "16.17.0";
export const PPLUS_IMG_BASE = "https://wwwimage-us.pplusstatic.com/base/";

// Algoritmo `at` token: AES-256-CBC con chiave hardcoded (vedi 3052/rosso),
// payload = "|" + app_secret. Usato come fallback se il token hardcoded
// viene ruotato da Paramount+.
const PPLUS_AT_SECRET_KEY_HEX =
    "302a6a0d70a7e9b967f91d39fef3e387816e3095925ae4537bce96063311f9c5";
const PPLUS_AT_APP_SECRET = "7081400bd4143bf3";

/**
 * Genera un `at` token AES-256-CBC per Paramount+ apps-api.
 * Formato: [uint16 blockSize=16][16 byte IV=0][ciphertext PKCS7-padded di "|" + app_secret].
 * Restituisce base64 standard.
 */
export function generateAtToken(
    appSecret: string = PPLUS_AT_APP_SECRET,
    keyHex: string = PPLUS_AT_SECRET_KEY_HEX
): string {
    const key = Buffer.from(keyHex, "hex");
    const data = Buffer.concat([
        Buffer.from([0x7c]), // "|"
        Buffer.from(appSecret, "utf8"),
    ]);

    // PKCS7 pad fino a 16 byte
    const blockSize = 16;
    const padLen = blockSize - (data.length % blockSize);
    const padded = Buffer.concat([
        data,
        Buffer.alloc(padLen, padLen),
    ]);

    const iv = Buffer.alloc(blockSize, 0);
    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    const encrypted = Buffer.concat([
        cipher.update(padded),
        cipher.final(),
    ]);

    // Header: uint16 big-endian blockSize + IV + ciphertext
    const header = Buffer.alloc(2);
    header.writeUInt16BE(blockSize, 0);

    return Buffer.concat([header, iv, encrypted]).toString("base64");
}

/**
 * Restituisce un `at` token valido: prima prova il token hardcoded (collaudato),
 * poi quello generato dinamicamente come fallback se la env var PPLUS_AT_OVERRIDE
 * e' settata (utile in caso di rotazione lato Paramount).
 */
export function getAtToken(): string {
    const override = process.env.PPLUS_AT_OVERRIDE?.trim();
    if (override) return override;
    return PPLUS_AT_TOKEN_US;
}

let PPLUS_HEADER_CACHED: string | undefined;
let PPLUS_HEADER_LAST_FETCH = 0;
const PPLUS_HEADER_CACHE_TTL = 24 * 60 * 60 * 1000;
export async function PPLUS_HEADER(): Promise<string> {
    const now = Date.now();
    if (PPLUS_HEADER_CACHED && (now - PPLUS_HEADER_LAST_FETCH < PPLUS_HEADER_CACHE_TTL)) {
        return PPLUS_HEADER_CACHED;
    }

    let version = PPLUS_APP_VERSION_FALLBACK;
    try {
        const { data: currentVersion } = await httpClient.get("https://i.mjh.nz/.apk/paramount.version", {
            timeout: 2000,
        });
        if (currentVersion) version = currentVersion.toString().trim();
    } catch (err: any) {
        // P16: log contestuale, ma non blocchiamo il flusso: usiamo il fallback.
        console.warn(`[PPLUS_HEADER] version fetch failed, using fallback ${PPLUS_APP_VERSION_FALLBACK}: ${err?.message ?? err}`);
    }

    PPLUS_HEADER_CACHED = `Paramount+/${version} (com.cbs.ott; build:520000178; Android SDK 30; androidtv; SHIELD Android TV) okhttp/5.1.0`;
    PPLUS_HEADER_LAST_FETCH = now;
    return PPLUS_HEADER_CACHED;
}

export function stripJsonSuffix(s: string) {
    return s.endsWith(".json") ? s.slice(0, -5) : s;
}

/**
 * Decodifica URI in modo sicuro: restituisce la stringa originale
 * se la percent-encoding non è valida (evita URIError → 500).
 */
export function safeDecode(s: string): string {
    try {
        return decodeURIComponent(s);
    } catch {
        return s;
    }
}

/**
 * Fingerprint stabile della sessione (basato sui cookie) usato come chiave
 * per le cache per-sessione. Evita che listing di tenant diversi si mescolino.
 */
export function sessionFingerprint(session: { cookies?: string[] }): string {
    const cookies = Array.isArray(session?.cookies) ? session.cookies : [];
    return cookies.join("|");
}

// Domini che richiedono le credenziali di sessione Paramount+ (cookie/bearer)
const PPLUS_AUTH_HOSTS = [
    "cbsi.live.ott.irdeto.com",
    "paramountplus.com",
    "cbsivideo.com",
];

// Domini verso cui e' lecito instradare le richieste (manifest/segmenti/licenze),
// anche se non ricevono le credenziali Paramount+ (es. Google DAI per i live con ad insertion)
const PPLUS_UPSTREAM_ALLOWED_HOSTS = [
    ...PPLUS_AUTH_HOSTS,
    "paramount.tech",
    "google.com",
    "googlevideo.com",
    "googleapis.com",
    "googlesyndication.com",
    "doubleclick.net",
];

// Path sensibili che non devono mai essere proxati (es. endpoint di amministrazione)
const BLOCKED_PATH_PATTERNS = [
    /\/admin\b/i,
    /\/\.env/i,
    /\/\.git/i,
    /\/internal\b/i,
    /\/debug\b/i,
];

function hostMatches(hostname: string, domains: string[]) {
    const h = hostname.toLowerCase();
    return domains.some((domain) => h === domain || h.endsWith(`.${domain}`));
}

export function isAllowedUpstreamHost(hostname: string) {
    return hostMatches(hostname, PPLUS_UPSTREAM_ALLOWED_HOSTS);
}

export function isAllowedUpstreamUrl(url: URL) {
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (!isAllowedUpstreamHost(url.hostname)) return false;

    // Rifiuta URL con credenziali incorporate (user:pass@host)
    if (url.username || url.password) return false;

    // Rifiuta path sensibili
    if (BLOCKED_PATH_PATTERNS.some((re) => re.test(url.pathname))) return false;

    return true;
}

export function needsParamountAuth(hostname: string) {
    return hostMatches(hostname, PPLUS_AUTH_HOSTS);
}

export function buildCookieHeader(cookies: string[] | undefined) {
    if (!cookies?.length) return "";
    return cookies
        .map((c) => c.split(";")[0].trim())
        .filter(Boolean)
        .join("; ");
}

export function forwardHeaders(req: NextRequest) {
    const h: Record<string, string> = {};

    const range = req.headers.get("range");
    if (range) h["range"] = range;

    const inm = req.headers.get("if-none-match");
    if (inm) h["if-none-match"] = inm;

    const ims = req.headers.get("if-modified-since");
    if (ims) h["if-modified-since"] = ims;

    const ua = req.headers.get("user-agent");
    if (ua) h["user-agent"] = ua;

    const accept = req.headers.get("accept");
    if (accept) h["accept"] = accept;

    return h;
}

export function copyRespHeaders(headers: Headers) {
    const out = new Headers({
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
    });

    const pass = [
        "content-type",
        "content-length",
        "content-range",
        "accept-ranges",
        "etag",
        "last-modified",
        "cache-control", // Importante per non ri-scaricare segmenti durante i glitch
        "content-encoding",
        "date" // Alcuni player usano la data per sincronizzare i buffer
    ];

    for (const k of pass) {
        const v = headers.get(k);
        if (v) out.set(k, v);
    }

    return out;
}

export function guessBaseUrl(req: NextRequest): string {
    // Priorita' 1: variabile d'ambiente esplicita
    if (process.env.BASE_URL && process.env.BASE_URL.trim().length > 0) {
        return process.env.BASE_URL.replace(/\/$/, '');
    }

    // Priorita' 2: header "Host" della richiesta.
    // Quando si apre /configure dal PC locale ma Stremio desktop gira
    // sullo stesso PC (o sulla stessa LAN), l'URL "ufficiale" e' quello
    // nell'header Host, che puo' essere un IP LAN (es. 192.168.1.10:3000)
    // anziche' localhost. Usiamo quello per generare il manifest URL cosi'
    // che Stremio possa raggiungerlo.
    const hostHeader = req.headers.get("host");
    if (hostHeader) {
        const xfProto = req.headers.get("x-forwarded-proto");
        const proto = xfProto ? xfProto.split(",")[0].trim() : (new URL(req.url).protocol.replace(":", ""));
        return `${proto}://${hostHeader}`;
    }

    // Priorita' 3: origin dalla URL della richiesta
    return new URL(req.url).origin;
}

export function normImg(urlOrPath?: string | null): string | undefined {
    if (!urlOrPath) return undefined;
    const absolute = urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")
        ? urlOrPath
        : new URL(urlOrPath.replace(/^\//, ""), PPLUS_IMG_BASE).toString();

    if (!absolute.startsWith(PPLUS_IMG_BASE)) return absolute;

    const baseUrl = (process.env.BASE_URL ?? "").replace(/\/$/, "");
    return `${baseUrl}/api/img?u=${encodeURIComponent(absolute)}`;
}

export function msToUtc(ms?: number): string | undefined {
    if (!ms || !Number.isFinite(ms)) return undefined;
    const iso = new Date(ms).toISOString();
    return iso.slice(0, 16).replace("T", " ") + " UTC";
}

export function msToDateTimeFormat(ms?: number): string | undefined {
    if (!ms || !Number.isFinite(ms)) return undefined;

    const timezone = process.env.TIMEZONE ?? 'UTC';
    const timezoneLang = process.env.TIMEZONE_LANG ?? 'it-IT';
    const d = new Date(ms);

    return new Intl.DateTimeFormat(timezoneLang, {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).format(d).replace(',', '');
}

export function pickPoster(e: any): string | undefined {
    return (
        normImg(e?.filePathThumb) ??
        normImg(e?.filepathThumb) ??
        normImg(e?.filePathWideThumb) ??
        normImg(e?.channelLogo) ??
        normImg(e?.channelLogoDark) ??
        normImg(e?.filepathFallbackImage)
    );
}

export function pickLogo(e: any): string | undefined {
    return (
        e?.filepathFallbackImage ? normImg(e?.filepathFallbackImage) : ""
    );
}

export function pickBackground(e: any): string | undefined {
    return normImg(e?.filePathWideThumb) ?? normImg(e?.filePathThumb);
}

export function pickLeagueLabel(e: any): string | undefined {
    const gd = e?.gameData;
    const a = gd?.competition ?? gd?.league ?? gd?.sport ?? gd?.leagueName ?? gd?.sportName;
    const b = gd?.tournament ?? gd?.competitionName;
    const out = [a, b].filter(Boolean).join(" • ");
    return out || undefined;
}

export function pickManifestUrl(tokenResp: any): string | null {

    const candidates: (string | undefined)[] = [
        tokenResp?.streamingUrl,
        tokenResp?.hls?.url,
        tokenResp?.hlsUrl,
        tokenResp?.playback?.hls,
        tokenResp?.playback?.url,
        tokenResp?.manifestUrl,
    ];

    const allStrings: string[] = [];
    const walk = (obj: any) => {
        if (!obj) return;
        if (typeof obj === "string") allStrings.push(obj);
        else if (Array.isArray(obj)) obj.forEach(walk);
        else if (typeof obj === "object") Object.values(obj).forEach(walk);
    };
    walk(tokenResp);

    const merged = [...candidates.filter(Boolean) as string[], ...allStrings];

    // Prefer HLS (.m3u8) over DASH (.mpd): Stremio web/desktop non supporta
    // DASH/MPD nativamente (solo HLS). Se il token contiene entrambi, scegliamo
    // HLS così i replay diventano riproducibili ovunque. Se c'è solo MPD,
    // ricadiamo su MPD (richiede player con Widevine CDM).
    const m3u8 = merged.find((u) => typeof u === "string" && u.includes(".m3u8"));
    if (m3u8) return m3u8;

    const mpd = merged.find((u) => typeof u === "string" && u.includes(".mpd"));
    if (mpd) return mpd;

    const license = merged.find((u) => typeof u === "string" && u.includes("/widevine/getlicense"));
    if (license) return null;

    return null;
}

export function isLicenseUrl(u: string) {
    return u.includes("/widevine/getlicense") || u.toLowerCase().includes("getlicense");
}