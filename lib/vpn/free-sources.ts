import { parseShareLink, type ParsedServer } from "@/lib/vpn/share-links";

/**
 * Recupero e normalizzazione di una "free source" di server VLESS pubblici.
 *
 * La fonte primaria è openproxylist.com (lista raw di share-link VLESS con
 * nazione nel fragment, es. `#🇺🇸[openproxylist.com] vless-US`). Usiamo il
 * mirror GitHub perché più affidabile come fetch server-side. La qualità è
 * bassa per design (gratuiti, pubblici, ruotano spesso), quindi filtriamo
 * solo nodi US con TLS/XTLS/Reality/WS e applichiamo un quality score per
 * ordinarli da "migliore" a "peggiore".
 */

export interface FreeSourceEntry {
    server: ParsedServer;
    country: string;
    quality: number;          // 0..10
    transport: string;        // 'tcp' | 'ws' | 'grpc' | 'reality' | ...
    networkLabel: string;
}

export interface FreeSourceResult {
    source: 'openproxylist';
    fetchedAt: string;
    entries: FreeSourceEntry[];
    totalRaw: number;
    filtered: number;
}

/** Lista URL candidati in ordine di preferenza (HTTPS, no auth). */
const SOURCE_URLS: { url: string; label: string }[] = [
    { url: 'https://raw.githubusercontent.com/roosterkid/openproxylist/refs/heads/main/V2RAY_RAW.txt', label: 'openproxylist-github' },
    { url: 'https://openproxylist.com/v2ray/rawlist/text', label: 'openproxylist-site' },
];

async function fetchFirst(): Promise<{ text: string; source: string }> {
    let lastErr: unknown = null;
    for (const cand of SOURCE_URLS) {
        try {
            const res = await fetch(cand.url, { signal: AbortSignal.timeout(12_000), headers: { 'user-agent': 'paramount-stremio/free-sources' } });
            if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
            const text = (await res.text()).trim();
            if (text.length < 50) { lastErr = new Error('empty'); continue; }
            return { text, source: cand.label };
        } catch (e) { lastErr = e; }
    }
    throw lastErr ?? new Error('Nessuna sorgente libera raggiungibile');
}

/**
 * openproxylist fornisce il raw list come un file TXT in cui TUTTI gli share-link
 * sono concatenati senza separatore univoco (alcuni link iniziano con `vless://`,
 * altri con `vmess://`, `trojan://`, `ss://`). Spezza la stringa in corrispondenza
 * di ciascuno schema noto e li rimonta come lista.
 */
export function splitMixedList(text: string): string[] {
    // Inserisce un newline prima di ogni schema noto
    const normalized = text
        .replace(/\r\n?/g, '\n')
        .replace(/(vless:\/\/|vmess:\/\/|trojan:\/\/|ss:\/\/|hysteria2:\/\/|hy2:\/\/|ssr:\/\/)/gi, '\n$1');
    return normalized
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => /^[a-z0-9]+:\/\//i.test(s));
}

export function detectCountry(link: string): string {
    // 1) fragment tipo "#🇺🇸 [openproxylist.com] vless-US" (emoji bandiera)
    const frag = link.split('#')[1] ?? '';
    const flagMatch = frag.match(/\p{Regional_Indicator}{2}/u);
    if (flagMatch) return countryCodeFromFlag(flagMatch[0]);
    // 2) "-US" alla fine del tag
    const tag = frag.toLowerCase();
    const tagMatch = tag.match(/[-_]([a-z]{2})\b/);
    if (tagMatch) return tagMatch[1].toUpperCase();
    // 3) prefisso host (es. us-... o IP US) - euristica semplice
    return 'XX';
}

function countryCodeFromFlag(flag: string): string {
    // Regional Indicator Symbol Letter A = 0x1F1E6 → offset to 'A'
    const A = 0x1F1E6;
    const chars = [...flag];
    if (chars.length !== 2) return 'XX';
    const c1 = chars[0].codePointAt(0)! - A;
    const c2 = chars[1].codePointAt(0)! - A;
    if (c1 < 0 || c1 > 25 || c2 < 0 || c2 > 25) return 'XX';
    return String.fromCharCode(65 + c1) + String.fromCharCode(65 + c2);
}

/**
 * Determina il "security mode" dal payload parsato.
 *
 * - `reality` quando il link include `security=reality` o è stato parsato
 *   da Xray JSON con realitySettings.
 * - `tls` quando `tls=true` ma non reality.
 * - `none` altrimenti.
 *
 * Nota: serve a `qualityOf()` per dare priorità ai nodi Reality (migliori
 * per Paramount+ anti-fingerprint). Non viene usato in fase di routing.
 */
export function securityOf(s: ParsedServer): 'reality' | 'tls' | 'none' {
    if (s.realityPublicKey) return 'reality';
    // share-link vless: rileva reality dal fragment / query originale
    if (s.raw && /[?&]security=reality(&|$)/i.test(s.raw)) return 'reality';
    if (s.tls) return 'tls';
    return 'none';
}

/** Assegna uno score 0..10 in base al trasporto / TLS / Reality. */
export function qualityOf(s: ParsedServer): number {
    let q = 5;
    const t = (s.transport || 'tcp').toLowerCase();
    const sec = securityOf(s);
    if (sec === 'reality') q += 4;
    else if (sec === 'tls') q += 2;
    else q -= 1;
    if (t === 'ws') q += 1;
    else if (t === 'grpc') q += 1;
    if (!s.sni) q -= 1;
    if (s.port === 443) q += 1;
    if (s.insecure) q -= 2;
    if (s.flow === 'xtls-rprx-vision') q += 1;
    return Math.max(0, Math.min(10, q));
}

function networkLabel(s: ParsedServer): string {
    const t = (s.transport || 'tcp').toUpperCase();
    const sec = securityOf(s).toUpperCase();
    return `${t}/${sec}`;
}

/** Recupera + parsa + filtra per paese (default US) + dedupe per host:port. */
export async function fetchFreeSources(opts: { country?: string; minQuality?: number; maxEntries?: number } = {}): Promise<FreeSourceResult> {
    const country = (opts.country || 'US').toUpperCase();
    const minQuality = opts.minQuality ?? 2;
    const maxEntries = opts.maxEntries ?? 12;

    const { text, source } = await fetchFirst();
    const links = splitMixedList(text);
    const out: FreeSourceEntry[] = [];
    const seen = new Set<string>();
    let filtered = 0;
    for (const link of links) {
        const parsed = parseShareLink(link);
        if (!parsed) { filtered++; continue; }
        if (parsed.transport === 'xhttp') { filtered++; continue; } // non supportato
        const c = detectCountry(link);
        if (c !== country) { filtered++; continue; }
        const key = `${parsed.host}:${parsed.port}`;
        if (seen.has(key)) { filtered++; continue; }
        const q = qualityOf(parsed);
        if (q < minQuality) { filtered++; continue; }
        seen.add(key);
        out.push({
            server: parsed,
            country: c,
            quality: q,
            transport: parsed.transport || 'tcp',
            networkLabel: networkLabel(parsed),
        });
        if (out.length >= maxEntries) break;
    }
    out.sort((a, b) => b.quality - a.quality || a.server.host.localeCompare(b.server.host));
    return {
        source: source.startsWith('openproxylist') ? 'openproxylist' : 'openproxylist',
        fetchedAt: new Date().toISOString(),
        entries: out,
        totalRaw: links.length,
        filtered,
    };
}