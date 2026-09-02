import { describe, it, expect } from "vitest";
import {
    parseMediaPlaylist,
    pickVariantUrl,
    pickVariant,
    pickAudioRenditions,
    pickAudioRendition,
    extractSegmentTemplate,
    buildDvrPlaylist,
    buildDvrMaster,
    MAX_DVR_SEGMENTS,
} from "@/lib/paramount/proxy/dvr";

/**
 * Media playlist reale registrata dall'evento DAI live Juventus vs Parma
 * (contentId 17430320, 29/08/2026): AES-128 con IV esplicito, segmenti
 * numerati assoluti `manifest_3_{N}.ts` con token statico `?m=`.
 */
const REAL_MEDIA_URL = new URL(
    "https://dai.google.com/linear/hls/pb/event/LcF4dWH9RTKPzTSjor1ixA/stream/uuid:TPE/variant/3.m3u8"
);

const REAL_MEDIA_PLAYLIST = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-TARGETDURATION:6",
    "#EXT-X-MEDIA-SEQUENCE:1757",
    "#EXT-X-DISCONTINUITY-SEQUENCE:0",
    '#EXT-X-KEY:METHOD=AES-128,URI="https://cbsi.live.ott.irdeto.com/licenseServer/hls/v1/cbsi/key?contentId=a81529f9-ccf-4e88-931f-c5173fbf9bb8&keyId=7b78f796-8323-42af-aafc-0105e6ac9b3e",KEYFORMAT="identity",KEYFORMATVERSIONS="1",IV=0xC14F485DDA742369432C181342404D8F',
    "#EXTINF:5.733,",
    "https://poolc85c2c25.airspace-cdn.cbsivideo.com/out/v1/ce9f60847e024b4dba947b8d16178fb8/manifest_3_1757.ts?m=1787683710",
    "#EXTINF:5.733,",
    "https://poolc85c2c25.airspace-cdn.cbsivideo.com/out/v1/ce9f60847e024b4dba947b8d16178fb8/manifest_3_1758.ts?m=1787683710",
    "#EXTINF:5.734,",
    "https://poolc85c2c25.airspace-cdn.cbsivideo.com/out/v1/ce9f60847e024b4dba947b8d16178fb8/manifest_3_1759.ts?m=1787683710",
    "#EXTINF:5.733,",
    "https://poolc85c2c25.airspace-cdn.cbsivideo.com/out/v1/ce9f60847e024b4dba947b8d16178fb8/manifest_3_1760.ts?m=1787683710",
    "",
].join("\n");

const MASTER_PLAYLIST = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    '#EXT-X-STREAM-INF:BANDWIDTH=4454000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"',
    "https://dai.google.com/linear/hls/pb/event/KEY/stream/uuid:TPE/variant/720.m3u8",
    '#EXT-X-STREAM-INF:BANDWIDTH=2196000,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2"',
    "https://dai.google.com/linear/hls/pb/event/KEY/stream/uuid:TPE/variant/360.m3u8",
    "",
].join("\n");

describe("parseMediaPlaylist", () => {
    it("estrae KEY line con URI assoluta e IV", () => {
        const parsed = parseMediaPlaylist(REAL_MEDIA_PLAYLIST, REAL_MEDIA_URL);
        expect(parsed.keyLine).toBeTruthy();
        expect(parsed.keyLine).toContain("METHOD=AES-128");
        expect(parsed.keyLine).toContain("IV=0xC14F485DDA742369432C181342404D8F");
        expect(parsed.keyLine).toContain("https://cbsi.live.ott.irdeto.com/licenseServer");
    });

    it("estrae target duration e media sequence", () => {
        const parsed = parseMediaPlaylist(REAL_MEDIA_PLAYLIST, REAL_MEDIA_URL);
        expect(parsed.targetDuration).toBe(6);
        expect(parsed.mediaSequence).toBe(1757);
    });

    it("estrae i segmenti numerati con durate", () => {
        const parsed = parseMediaPlaylist(REAL_MEDIA_PLAYLIST, REAL_MEDIA_URL);
        expect(parsed.segments).toHaveLength(4);
        expect(parsed.segments[0]).toMatchObject({ num: 1757, duration: 5.733 });
        expect(parsed.segments[3]).toMatchObject({ num: 1760, duration: 5.733 });
        expect(parsed.segments[0].url).toContain("manifest_3_1757.ts?m=1787683710");
    });

    it("ignora i segmenti non numerati", () => {
        const text = [
            "#EXTM3U",
            "#EXTINF:5.0,",
            "https://cdn.example.com/seg-a.ts",
            "",
        ].join("\n");
        const parsed = parseMediaPlaylist(text, REAL_MEDIA_URL);
        expect(parsed.segments).toHaveLength(0);
    });
});

describe("pickVariantUrl", () => {
    it("senza bandwidth seleziona la qualità più alta", () => {
        const url = pickVariantUrl(MASTER_PLAYLIST, REAL_MEDIA_URL, null);
        expect(url).toBe("https://dai.google.com/linear/hls/pb/event/KEY/stream/uuid:TPE/variant/720.m3u8");
    });

    it("con bandwidth seleziona la più vicina", () => {
        const url = pickVariantUrl(MASTER_PLAYLIST, REAL_MEDIA_URL, 2000000);
        expect(url).toContain("variant/360.m3u8");
    });

    it("ritorna null se non ci sono varianti", () => {
        expect(pickVariantUrl("#EXTM3U\n", REAL_MEDIA_URL, null)).toBeNull();
    });
});

describe("extractSegmentTemplate", () => {
    it("sostituisce il numero del segmento con {n}", () => {
        const parsed = parseMediaPlaylist(REAL_MEDIA_PLAYLIST, REAL_MEDIA_URL);
        const template = extractSegmentTemplate(parsed.segments);
        expect(template).toBe(
            "https://poolc85c2c25.airspace-cdn.cbsivideo.com/out/v1/ce9f60847e024b4dba947b8d16178fb8/manifest_3_{n}.ts?m=1787683710"
        );
    });

    it("ritorna null senza segmenti", () => {
        expect(extractSegmentTemplate([])).toBeNull();
    });
});

describe("buildDvrPlaylist", () => {
    const parsed = parseMediaPlaylist(REAL_MEDIA_PLAYLIST, REAL_MEDIA_URL);
    const template = extractSegmentTemplate(parsed.segments)!;

    it("genera una playlist EVENT dal segmento 0 al live edge", () => {
        const body = buildDvrPlaylist({
            parsed,
            template,
            sid: "ABCDEF1234567890ABCD",
            baseOrigin: "https://para.example.com",
            key: "longkey",
            token: "dG9rZW4",
        });

        const lines = body.split("\n");
        expect(lines[0]).toBe("#EXTM3U");
        expect(body).toContain("#EXT-X-PLAYLIST-TYPE:EVENT");
        expect(body).toContain("#EXT-X-MEDIA-SEQUENCE:0");

        // Segmenti dal numero 0 al 1760 (live edge)
        const segUrls = lines.filter((l) => l.startsWith("https://"));
        expect(segUrls).toHaveLength(1761);
        expect(segUrls[0]).toBe("https://para.example.com/api/proxy/ABCDEF1234567890ABCD/dvrseg?n=0");
        expect(segUrls[segUrls.length - 1]).toBe(
            "https://para.example.com/api/proxy/ABCDEF1234567890ABCD/dvrseg?n=1760"
        );

        // Un EXTINF per segmento
        const extinfCount = lines.filter((l) => l.startsWith("#EXTINF")).length;
        expect(extinfCount).toBe(1761);
    });

    it("proxia la KEY line verso il license proxy mantenendo l'IV", () => {
        const body = buildDvrPlaylist({
            parsed,
            template,
            sid: "SID",
            baseOrigin: "https://para.example.com",
            key: "longkey",
            token: "dG9rZW4",
        });

        const keyLine = body.split("\n").find((l) => l.startsWith("#EXT-X-KEY"));
        expect(keyLine).toBeTruthy();
        expect(keyLine).toContain("https://para.example.com/api/stremio/longkey/proxy/license?u=");
        expect(keyLine).toContain("&t=dG9rZW4");
        expect(keyLine).toContain("IV=0xC14F485DDA742369432C181342404D8F");
        // una sola KEY line (IV esplicito)
        expect(body.split("\n").filter((l) => l.startsWith("#EXT-X-KEY")).length).toBe(1);
    });

    it("usa le durate reali per la finestra live e la media per i vecchi", () => {
        const body = buildDvrPlaylist({
            parsed,
            template,
            sid: "SID",
            baseOrigin: "https://para.example.com",
            key: "longkey",
            token: "dG9rZW4",
        });
        const lines = body.split("\n");
        // il segmento 1759 (durata 5.734) è nella finestra live
        const idx = lines.indexOf("https://para.example.com/api/proxy/SID/dvrseg?n=1759");
        expect(lines[idx - 1]).toBe("#EXTINF:5.734,");
        // il segmento 100 è fuori finestra: durata media
        const idx100 = lines.indexOf("https://para.example.com/api/proxy/SID/dvrseg?n=100");
        expect(lines[idx100 - 1]).toBe("#EXTINF:5.733,");
    });

    it("KEY senza IV e media-sequence allineato: singola KEY line (IV default = N)", () => {
        const noIvPlaylist = REAL_MEDIA_PLAYLIST.replace(",IV=0xC14F485DDA742369432C181342404D8F", "");
        const parsedNoIv = parseMediaPlaylist(noIvPlaylist, REAL_MEDIA_URL);
        const body = buildDvrPlaylist({
            parsed: parsedNoIv,
            template,
            sid: "SID",
            baseOrigin: "https://para.example.com",
            key: "longkey",
            token: "dG9rZW4",
        });
        const keyLines = body.split("\n").filter((l) => l.startsWith("#EXT-X-KEY"));
        expect(keyLines).toHaveLength(1);
        expect(keyLines[0]).not.toContain("IV=");
    });

    it("KEY senza IV e media-sequence NON allineato: KEY per segmento con IV esplicito", () => {
        // media-sequence 100 ma primo segmento 1757 → offset -1657
        const misaligned = REAL_MEDIA_PLAYLIST.replace("#EXT-X-MEDIA-SEQUENCE:1757", "#EXT-X-MEDIA-SEQUENCE:100").replace(",IV=0xC14F485DDA742369432C181342404D8F", "");
        const parsedMis = parseMediaPlaylist(misaligned, REAL_MEDIA_URL);
        const body = buildDvrPlaylist({
            parsed: parsedMis,
            template,
            sid: "SID",
            baseOrigin: "https://para.example.com",
            key: "longkey",
            token: "dG9rZW4",
        });
        const lines = body.split("\n");
        const keyLines = lines.filter((l) => l.startsWith("#EXT-X-KEY"));
        expect(keyLines.length).toBe(1761);
        // IV del segmento 1757 = 1757 + (100 - 1757) = 100
        const idx = lines.indexOf("https://para.example.com/api/proxy/SID/dvrseg?n=1757");
        expect(lines[idx - 2]).toContain(`IV=0x${(100).toString(16).padStart(32, "0")}`);
    });

    it("applica il cap difensivo sui segmenti", () => {
        const bigSegments = Array.from({ length: 30 }, (_, i) => ({
            num: MAX_DVR_SEGMENTS + 500 + i,
            url: `https://cdn.example.com/manifest_3_${MAX_DVR_SEGMENTS + 500 + i}.ts?m=1`,
            duration: 5,
        }));
        const body = buildDvrPlaylist({
            parsed: { keyLine: null, targetDuration: 6, mediaSequence: null, segments: bigSegments },
            template: "https://cdn.example.com/manifest_3_{n}.ts?m=1",
            sid: "SID",
            baseOrigin: "https://para.example.com",
            key: "longkey",
            token: "dG9rZW4",
        });
        const segUrls = body.split("\n").filter((l) => l.startsWith("https://"));
        expect(segUrls).toHaveLength(MAX_DVR_SEGMENTS);
        // startNum = maxNum - MAX + 1 = (MAX+529) - MAX + 1 = 530
        expect(body).toContain("#EXT-X-MEDIA-SEQUENCE:530");
        expect(segUrls[0]).toBe(`https://para.example.com/api/proxy/SID/dvrseg?n=530`);
        expect(segUrls[segUrls.length - 1]).toBe(
            `https://para.example.com/api/proxy/SID/dvrseg?n=${MAX_DVR_SEGMENTS + 529}`
        );
    });
});

/**
 * Master con rendition audio separate (il caso reale Paramount: audio non
 * muxed nel TS). Prima del fix la playlist DVR conteneva solo segmenti video
 * → riproduzione senza audio.
 */
const MASTER_WITH_AUDIO = [
    "#EXTM3U",
    "#EXT-X-VERSION:6",
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud-ita",NAME="Italiano",LANGUAGE="ita",DEFAULT=YES,AUTOSELECT=YES,URI="audio/ita.m3u8"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud-ita",NAME="English",LANGUAGE="eng",DEFAULT=NO,AUTOSELECT=YES,URI="audio/eng.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=4454000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2",AUDIO="aud-ita"',
    "https://dai.google.com/linear/hls/pb/event/KEY/stream/uuid:TPE/variant/720.m3u8",
    '#EXT-X-STREAM-INF:BANDWIDTH=2196000,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2",AUDIO="aud-ita"',
    "https://dai.google.com/linear/hls/pb/event/KEY/stream/uuid:TPE/variant/360.m3u8",
    "",
].join("\n");

const MASTER_URL = new URL("https://dai.google.com/linear/hls/pb/event/KEY/stream/uuid:TPE/master.m3u8");

describe("pickAudioRenditions / pickAudioRendition", () => {
    it("estrae le rendition audio con URI assoluta", () => {
        const renditions = pickAudioRenditions(MASTER_WITH_AUDIO, MASTER_URL);
        expect(renditions).toHaveLength(2);
        expect(renditions[0]).toMatchObject({ groupId: "aud-ita", language: "ita", isDefault: true });
        expect(renditions[0].uri).toBe("https://dai.google.com/linear/hls/pb/event/KEY/stream/uuid:TPE/audio/ita.m3u8");
    });

    it("ritorna [] per master muxed (nessuna rendition audio)", () => {
        expect(pickAudioRenditions(MASTER_PLAYLIST, MASTER_URL)).toHaveLength(0);
    });

    it("seleziona ita per lang=ita, con fallback eng", () => {
        const renditions = pickAudioRenditions(MASTER_WITH_AUDIO, MASTER_URL);
        expect(pickAudioRendition(renditions, "ita")?.language).toBe("ita");
        expect(pickAudioRendition(renditions, "fra")?.language).toBe("ita"); // DEFAULT=YES
        expect(pickAudioRendition(renditions)?.language).toBe("ita");
    });

    it("fallback eng quando manca ita", () => {
        const engOnly = pickAudioRenditions(MASTER_WITH_AUDIO, MASTER_URL).slice(1);
        expect(pickAudioRendition(engOnly)?.language).toBe("eng");
        expect(pickAudioRendition([])).toBeNull();
    });
});

describe("pickVariant / buildDvrMaster", () => {
    it("seleziona la variante con bandwidth/resolution/audioGroup", () => {
        const v = pickVariant(MASTER_WITH_AUDIO, MASTER_URL, 2000000);
        expect(v).toMatchObject({ bandwidth: 2196000, resolution: "640x360", audioGroup: "aud-ita" });
    });

    it("sintetizza il master DVR con rendition audio proxata", () => {
        const v = pickVariant(MASTER_WITH_AUDIO, MASTER_URL, null)!;
        const audio = pickAudioRendition(pickAudioRenditions(MASTER_WITH_AUDIO, MASTER_URL), "ita")!;
        const master = buildDvrMaster({
            variant: v,
            audio,
            videoPlaylistUrl: "https://para.example.com/api/stremio/K/proxy/dvr?u=VIDEO",
            audioPlaylistUrl: "https://para.example.com/api/stremio/K/proxy/dvr?u=AUDIO",
        });
        expect(master).toContain('#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud-ita"');
        expect(master).toContain('URI="https://para.example.com/api/stremio/K/proxy/dvr?u=AUDIO"');
        expect(master).toContain('AUDIO="aud-ita"');
        expect(master).toContain("BANDWIDTH=4454000");
        expect(master).toContain("RESOLUTION=1280x720");
        expect(master.split("\n").at(-2)).toBe("https://para.example.com/api/stremio/K/proxy/dvr?u=VIDEO");
    });

    it("omette la rendition audio quando assente (muxed)", () => {
        const master = buildDvrMaster({
            variant: { bandwidth: 1000, url: "v.m3u8", resolution: null, audioGroup: null },
            audio: null,
            videoPlaylistUrl: "https://para.example.com/dvr-video",
            audioPlaylistUrl: null,
        });
        expect(master).not.toContain("#EXT-X-MEDIA");
        expect(master).not.toContain('AUDIO="');
    });
});