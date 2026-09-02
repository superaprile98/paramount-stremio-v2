import { langMatches } from "@/lib/paramount/proxy/hls";

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
 * Rendition audio separata dichiarata nel master (`#EXT-X-MEDIA:TYPE=AUDIO`).
 */
export interface AudioRendition {
    groupId: string;
    name: string;
    language: string;
    isDefault: boolean;
    /** URI assoluta della media playlist audio. */
    uri: string;
}

/**
 * Estrae le rendition audio separate dal master (URI assoluta).
 * Ritorna [] se l'audio è muxed nel TS (nessuna EXT-X-MEDIA:TYPE=AUDIO).
 */
export function pickAudioRenditions(masterText: string, masterUrl: URL): AudioRendition[] {
    const renditions: AudioRendition[] = [];
    for (const raw of masterText.split("\n")) {
        const line = raw.trim();
        if (!line.startsWith("#EXT-X-MEDIA:")) continue;
        if (line.match(/TYPE=([A-Z-]+)/)?.[1] !== "AUDIO") continue;
        const uriMatch = line.match(/URI="([^"]+)"/);
        if (!uriMatch) continue;
        renditions.push({
            groupId: line.match(/GROUP-ID="([^"]+)"/)?.[1] ?? "",
            name: line.match(/NAME="([^"]+)"/)?.[1] ?? "",
            language: line.match(/LANGUAGE="([^"]+)"/)?.[1] ?? "und",
            isDefault: line.match(/DEFAULT=(YES|NO)/)?.[1] === "YES",
            uri: new URL(uriMatch[1], masterUrl).toString(),
        });
    }
    return renditions;
}

/**
 * Seleziona la rendition audio: lingua richiesta (ita→eng con alias) →
 * DEFAULT=YES → prima disponibile. Ritorna null se non ci sono rendition.
 */
export function pickAudioRendition(
    renditions: AudioRendition[],
    lang?: string | null
): AudioRendition | null {
    if (renditions.length === 0) return null;
    if (lang) {
        const match = renditions.find((r) => langMatches(r.language, lang));
        if (match) return match;
    }
    const byCode = (code: string) => renditions.find((r) => langMatches(r.language, code));
    return byCode("ita") ?? byCode("eng") ?? renditions.find((r) => r.isDefault) ?? renditions[0];
}

export interface PickedVariant {
    bandwidth: number;
    url: string;
    resolution: string | null;
    /** Group-id AUDIO referenziato dallo STREAM-INF, se presente. */
    audioGroup: string | null;
}

/**
 * Seleziona la variante video dal master (closest bandwidth se specificato,
 * altrimenti la più alta), restituendo anche risoluzione e group audio.
 */
export function pickVariant(masterText: string, masterUrl: URL, bandwidth: number | null): PickedVariant | null {
    const lines = masterText.split("\n").map((l) => l.trim());
    const variants: { bw: number; url: string; resolution: string | null; audioGroup: string | null }[] = [];
    for (let i = 0; i < lines.length; i++) {
        if (!lines[i].startsWith("#EXT-X-STREAM-INF")) continue;
        const info = lines[i];
        const bw = parseInt(info.match(/BANDWIDTH=(\d+)/)?.[1] || "0", 10);
        const resolution = info.match(/RESOLUTION=(\d+x\d+)/)?.[1] ?? null;
        const audioGroup = info.match(/AUDIO="([^"]+)"/)?.[1] ?? null;
        const next = lines[i + 1];
        if (next && !next.startsWith("#")) {
            variants.push({ bw, url: new URL(next, masterUrl).toString(), resolution, audioGroup });
            i++;
        }
    }
    if (variants.length === 0) return null;
    if (bandwidth) {
        variants.sort((a, b) => Math.abs(a.bw - bandwidth) - Math.abs(b.bw - bandwidth));
    } else {
        variants.sort((a, b) => b.bw - a.bw);
    }
    const v = variants[0];
    return { bandwidth: v.bw, url: v.url, resolution: v.resolution, audioGroup: v.audioGroup };
}

/**
 * Sintetizza il master DVR: STREAM-INF video → playlist DVR video proxata,
 * EXT-X-MEDIA AUDIO → playlist DVR audio proxata (stesso group-id del master
 * originale, così il player associa correttamente la rendition).
 */
export function buildDvrMaster(params: {
    variant: PickedVariant;
    audio: AudioRendition | null;
    /** URL della playlist DVR video (già proxata). */
    videoPlaylistUrl: string;
    /** URL della playlist DVR audio (già proxata). */
    audioPlaylistUrl: string | null;
}): string {
    const { variant, audio, videoPlaylistUrl, audioPlaylistUrl } = params;
    const out: string[] = ["#EXTM3U", "#EXT-X-VERSION:6"];
    if (audio && audioPlaylistUrl) {
        out.push(
            `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="${variant.audioGroup ?? "audio"}",` +
            `NAME="${audio.name}",LANGUAGE="${audio.language}",` +
            `DEFAULT=YES,AUTOSELECT=YES,URI="${audioPlaylistUrl}"`
        );
    }
    const streamInf = [
        `BANDWIDTH=${variant.bandwidth}`,
        ...(variant.resolution ? [`RESOLUTION=${variant.resolution}`] : []),
        ...(audio && audioPlaylistUrl ? [`AUDIO="${variant.audioGroup ?? "audio"}"`] : []),
    ];
    out.push(`#EXT-X-STREAM-INF:${streamInf.join(",")}`);
    out.push(videoPlaylistUrl);
    return out.join("\n") + "\n";
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