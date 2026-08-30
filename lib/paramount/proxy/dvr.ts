/**
 * Logica pura per le playlist DVR "from start" degli eventi live.
 *
 * Premessa (verificata sperimentalmente sugli eventi DAI di Paramount+):
 * - i segmenti HLS sono numerati in modo sequenziale e assoluto
 *   (`manifest_3_{N}.ts`) e il CDN li conserva per l'intero evento;
 * - la chiave AES-128 è unica per evento (KEY line con IV esplicito, oppure
 *   IV default = media-sequence del segmento, che coincide con N).
 *
 * La playlist DVR sintetizzata è di tipo EVENT: elenca i segmenti dal primo
 * disponibile fino al live edge e cresce nel tempo.
 */

export interface MediaSegment {
    num: number;
    url: string;
    duration: number;
}

export interface ParsedMedia {
    keyLine: string | null;
    targetDuration: number;
    mediaSequence: number | null;
    segments: MediaSegment[];
}

/** Cap difensivo: un canale 24/7 potrebbe avere decine di migliaia di segmenti. */
export const MAX_DVR_SEGMENTS = 20000;

/**
 * Parse di una media playlist HLS: estrae la KEY line (con URI assoluta),
 * il target duration, il media-sequence e i segmenti numerati (`_N.ts`).
 */
export function parseMediaPlaylist(text: string, playlistUrl: URL): ParsedMedia {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    let keyLine: string | null = null;
    let targetDuration = 6;
    let mediaSequence: number | null = null;
    let pendingDur = 0;
    const segments: MediaSegment[] = [];

    for (const line of lines) {
        if (line.startsWith("#EXT-X-KEY")) {
            const m = line.match(/URI="([^"]+)"/);
            keyLine = m ? line.replace(m[1], new URL(m[1], playlistUrl).toString()) : line;
        } else if (line.startsWith("#EXT-X-TARGETDURATION")) {
            targetDuration = parseInt(line.split(":")[1], 10) || 6;
        } else if (line.startsWith("#EXT-X-MEDIA-SEQUENCE")) {
            mediaSequence = parseInt(line.split(":")[1], 10);
        } else if (line.startsWith("#EXTINF")) {
            pendingDur = parseFloat(line.split(":")[1]) || 0;
        } else if (!line.startsWith("#")) {
            const numMatch = line.match(/_(\d+)\.ts\b/);
            if (numMatch) {
                segments.push({
                    num: parseInt(numMatch[1], 10),
                    url: new URL(line, playlistUrl).toString(),
                    duration: pendingDur,
                });
            }
            pendingDur = 0;
        }
    }
    return { keyLine, targetDuration, mediaSequence, segments };
}

/**
 * Seleziona l'URL della variante dal master: closest bandwidth se `bandwidth`
 * è specificato, altrimenti la qualità più alta.
 */
export function pickVariantUrl(masterText: string, masterUrl: URL, bandwidth: number | null): string | null {
    const lines = masterText.split("\n").map((l) => l.trim());
    const variants: { bw: number; url: string }[] = [];
    for (let i = 0; i < lines.length; i++) {
        if (!lines[i].startsWith("#EXT-X-STREAM-INF")) continue;
        const bw = parseInt(lines[i].match(/BANDWIDTH=(\d+)/)?.[1] || "0", 10);
        const next = lines[i + 1];
        if (next && !next.startsWith("#")) {
            variants.push({ bw, url: new URL(next, masterUrl).toString() });
            i++;
        }
    }
    if (variants.length === 0) return null;
    if (bandwidth) {
        variants.sort((a, b) => Math.abs(a.bw - bandwidth) - Math.abs(b.bw - bandwidth));
    } else {
        variants.sort((a, b) => b.bw - a.bw);
    }
    return variants[0].url;
}

/**
 * Estrae il template URL dei segmenti dall'ultimo segmento della finestra
 * live, sostituendo il numero con il placeholder `{n}`.
 * Ritorna null se il segmento non ha un numero estraibile.
 */
export function extractSegmentTemplate(segments: MediaSegment[]): string | null {
    if (segments.length === 0) return null;
    const last = segments[segments.length - 1];
    const template = last.url.replace(/_(\d+)\.ts\b/, "_{n}.ts");
    return template.includes("{n}") ? template : null;
}

export interface DvrPlaylistParams {
    parsed: ParsedMedia;
    template: string;
    /** sid compatto che contiene template + token Irdeto. */
    sid: string;
    /** Origine pubblica dell'addon (per gli URL assoluti dei segmenti). */
    baseOrigin: string;
    /** Chiave sessione Stremio (per il proxy della KEY line). */
    key: string;
    /** Token base64url passato alla route (per il proxy della KEY line). */
    token: string;
}

/**
 * Sintetizza la playlist DVR di tipo EVENT: segmenti da startNum al live edge,
 * con URL segmenti compatti (`/api/proxy/{sid}/dvrseg?n=N`) e KEY line proxata.
 *
 * Gestione IV:
 * - KEY con IV esplicito → una singola KEY line (valida per tutto l'evento);
 * - KEY senza IV e media-sequence allineato ai numeri dei segmenti →
 *   singola KEY line: l'IV default di HLS (media-sequence) coincide con N;
 * - KEY senza IV e media-sequence NON allineato → KEY line per segmento con
 *   IV esplicito `0x{N+offset}`.
 */
export function buildDvrPlaylist(params: DvrPlaylistParams): string {
    const { parsed, template, sid, baseOrigin, key, token } = params;
    const { keyLine, targetDuration, mediaSequence, segments } = parsed;

    const maxNum = segments.reduce((m, s) => Math.max(m, s.num), 0);
    const minNum = segments.reduce((m, s) => Math.min(m, s.num), Number.MAX_SAFE_INTEGER);
    const startNum = Math.max(0, maxNum - MAX_DVR_SEGMENTS + 1);

    // Durate: reali per i segmenti nella finestra live, media per i più vecchi
    const durMap = new Map<number, number>();
    let durSum = 0;
    for (const s of segments) {
        durMap.set(s.num, s.duration);
        durSum += s.duration;
    }
    const avgDur = durSum > 0 ? durSum / segments.length : 5;

    let singleKeyLine: string | null = null;
    let perSegmentKeyBase: string | null = null;
    let seqOffset = 0;
    if (keyLine) {
        const uriMatch = keyLine.match(/URI="([^"]+)"/);
        if (uriMatch) {
            const licUrl = new URL(`${baseOrigin}/api/stremio/${encodeURIComponent(key)}/proxy/license`);
            licUrl.searchParams.set("u", Buffer.from(uriMatch[1]).toString("base64url"));
            licUrl.searchParams.set("t", token);
            const proxied = keyLine.replace(uriMatch[1], licUrl.toString());
            if (/IV=/.test(proxied)) {
                singleKeyLine = proxied;
            } else if (mediaSequence != null && mediaSequence !== minNum) {
                seqOffset = mediaSequence - minNum;
                perSegmentKeyBase = proxied;
            } else {
                singleKeyLine = proxied;
            }
        }
    }

    const out: string[] = [
        "#EXTM3U",
        "#EXT-X-VERSION:3",
        `#EXT-X-TARGETDURATION:${Math.max(targetDuration, Math.ceil(avgDur))}`,
        "#EXT-X-PLAYLIST-TYPE:EVENT",
        `#EXT-X-MEDIA-SEQUENCE:${startNum}`,
    ];
    if (singleKeyLine) out.push(singleKeyLine);

    for (let n = startNum; n <= maxNum; n++) {
        const dur = durMap.get(n) ?? avgDur;
        if (perSegmentKeyBase) {
            out.push(`${perSegmentKeyBase},IV=0x${(n + seqOffset).toString(16).padStart(32, "0")}`);
        }
        out.push(`#EXTINF:${dur.toFixed(3)},`);
        out.push(`${baseOrigin}/api/proxy/${sid}/dvrseg?n=${n}`);
    }

    return out.join("\n") + "\n";
}