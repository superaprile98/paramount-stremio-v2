import { describe, it, expect } from "vitest";
import {
    splitAudioTracks,
    filterMasterByLanguage,
    pickPreferredLang,
    splitMasterPlaylist,
    filterMasterByClosestBandwidth,
    rewriteM3U8,
} from "@/lib/paramount/proxy/hls";

const MASTER = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-it",NAME="Italiano",LANGUAGE="it",DEFAULT=YES,AUTOSELECT=YES,URI="audio/it.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-en",NAME="English",LANGUAGE="en",DEFAULT=NO,AUTOSELECT=YES,URI="audio/en.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,AUDIO="audio-it"
1080p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,AUDIO="audio-it"
720p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=640x360,AUDIO="audio-it"
360p.m3u8
`;

describe("hls: splitAudioTracks", () => {
    it("extracts unique audio tracks by language", () => {
        const tracks = splitAudioTracks(MASTER);
        expect(tracks).toHaveLength(2);
        expect(tracks[0]).toMatchObject({ language: "it", groupId: "audio-it", isDefault: true });
        expect(tracks[1]).toMatchObject({ language: "en", groupId: "audio-en", isDefault: false });
    });

    it("dedupes tracks with the same language", () => {
        const dup = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a1",NAME="A",LANGUAGE="it",DEFAULT=YES
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a2",NAME="B",LANGUAGE="it",DEFAULT=NO
`;
        expect(splitAudioTracks(dup)).toHaveLength(1);
    });

    it("ignores non-audio media tags", () => {
        const subs = `#EXTM3U
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="IT",LANGUAGE="it"
`;
        expect(splitAudioTracks(subs)).toHaveLength(0);
    });
});

describe("hls: filterMasterByLanguage", () => {
    it("keeps only the target language audio track", () => {
        const out = filterMasterByLanguage(MASTER, "en");
        expect(out).toContain('LANGUAGE="en"');
        expect(out).not.toContain('LANGUAGE="it"');
    });

    it("forces DEFAULT=YES and AUTOSELECT=YES on the kept track", () => {
        const out = filterMasterByLanguage(MASTER, "en");
        expect(out).toContain("DEFAULT=YES");
        expect(out).toContain("AUTOSELECT=YES");
    });

    it("matches ISO 639-2 aliases (ita ↔ it, eng ↔ en)", () => {
        const out = filterMasterByLanguage(MASTER, "ita");
        expect(out).toContain('LANGUAGE="it"');
        expect(out).not.toContain('LANGUAGE="en"');
    });

    it("keeps all audio renditions when the target language does not exist", () => {
        // Regression: rimuovere tutte le EXT-X-MEDIA rompe il master
        // (STREAM-INF con AUDIO= group-id orfano → player in loading infinito).
        const out = filterMasterByLanguage(MASTER, "fra");
        expect(out).toContain('LANGUAGE="it"');
        expect(out).toContain('LANGUAGE="en"');
    });
});

describe("hls: pickPreferredLang", () => {
    it("prefers italian, then english, then default, then first", () => {
        const tracks = splitAudioTracks(MASTER);
        expect(pickPreferredLang(tracks)).toBe("it");
    });

    it("falls back to english when no italian track", () => {
        const enOnly = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="English",LANGUAGE="en",DEFAULT=NO,URI="a.m3u8"
`;
        expect(pickPreferredLang(splitAudioTracks(enOnly))).toBe("en");
    });

    it("falls back to DEFAULT=YES track when neither ita nor eng", () => {
        const frOnly = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="Français",LANGUAGE="fr",DEFAULT=YES
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="b",NAME="Deutsch",LANGUAGE="de",DEFAULT=NO
`;
        expect(pickPreferredLang(splitAudioTracks(frOnly))).toBe("fr");
    });

    it("returns null for an empty track list", () => {
        expect(pickPreferredLang([])).toBeNull();
    });
});

describe("hls: splitMasterPlaylist", () => {
    it("splits variants sorted by height desc", () => {
        const variants = splitMasterPlaylist(MASTER);
        expect(variants).toHaveLength(3);
        expect(variants[0].quality).toBe("1080p");
        expect(variants[1].quality).toBe("720p");
        expect(variants[2].quality).toBe("360p");
    });

    it("resolves relative URLs against baseUrl", () => {
        const variants = splitMasterPlaylist(MASTER, "https://cdn.example.com/path/");
        expect(variants[0].url).toBe("https://cdn.example.com/path/1080p.m3u8");
    });

    it("labels duplicate heights by bandwidth", () => {
        const dup = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
high.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080
low.m3u8
`;
        const variants = splitMasterPlaylist(dup);
        expect(variants).toHaveLength(2);
        expect(variants[0].quality).toBe("1080p - High");
        expect(variants[1].quality).toBe("1080p - Low");
    });
});

describe("hls: filterMasterByClosestBandwidth", () => {
    it("keeps only the variant closest to the target bandwidth", () => {
        const out = filterMasterByClosestBandwidth(MASTER, 2500000);
        expect(out).toContain("720p.m3u8");
        expect(out).not.toContain("1080p.m3u8");
        expect(out).not.toContain("360p.m3u8");
    });

    it("keeps referenced audio groups", () => {
        const out = filterMasterByClosestBandwidth(MASTER, 2500000);
        expect(out).toContain('GROUP-ID="audio-it"');
        expect(out).not.toContain('GROUP-ID="audio-en"');
    });

    it("returns the input unchanged when there are no variants", () => {
        const media = "#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:10,\nseg.ts\n";
        expect(filterMasterByClosestBandwidth(media, 1000)).toBe(media);
    });
});

describe("hls: rewriteM3U8", () => {
    const params = {
        text: MASTER,
        upstreamUrl: new URL("https://cdn.example.com/path/master.m3u8"),
        baseOrigin: "https://addon.example.com",
        key: "testkey",
        token: "tok123",
    };

    it("rewrites master playlist variant URLs to the proxy", () => {
        const out = rewriteM3U8(params);
        expect(out).toContain("/api/stremio/testkey/proxy/hls");
        expect(out).toContain("u=");
        expect(out).toContain("t=tok123");
        expect(out).not.toContain("cdn.example.com/path/1080p.m3u8");
    });

    it("rewrites media playlist segment URLs to the seg proxy", () => {
        const media = `#EXTM3U
#EXT-X-VERSION:3
#EXTINF:10,
seg1.ts
#EXTINF:10,
seg2.ts
`;
        const out = rewriteM3U8({
            ...params,
            text: media,
        });
        expect(out).toContain("/api/stremio/testkey/proxy/seg");
        expect(out).not.toContain("seg1.ts");
    });

    it("rewrites EXT-X-KEY URIs to the license proxy", () => {
        const media = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example.com/key.bin"
#EXTINF:10,
seg1.ts
`;
        const out = rewriteM3U8({ ...params, text: media });
        expect(out).toContain("/api/stremio/testkey/proxy/license");
        expect(out).not.toContain("key.bin");
    });
});