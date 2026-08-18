import { describe, it, expect } from "vitest";
import {
    xmlEscape,
    xmlTvDate,
    tvgId,
    tvgSportId,
    m3uAttrEscape,
    extractChannelPrograms,
    mapLiveChannel,
    mapSportChannel,
} from "@/lib/paramount/iptv";

describe("iptv: xmlEscape", () => {
    it("escapes XML special characters", () => {
        const input = 'A & B < C > D "E" \'F\'';
        // \u0026 evita che l'editor/tool decodifichi le entità HTML nel sorgente
        const expected =
            "A \u0026amp; B \u0026lt; C \u0026gt; D \u0026quot;E\u0026quot; \u0026apos;F\u0026apos;";
        expect(xmlEscape(input)).toBe(expected);
    });

    it("leaves plain text untouched", () => {
        expect(xmlEscape("plain text")).toBe("plain text");
    });
});

describe("iptv: xmlTvDate", () => {
    it("formats a timestamp in UTC", () => {
        // 2024-01-02T03:04:05Z
        const ms = Date.UTC(2024, 0, 2, 3, 4, 5);
        expect(xmlTvDate(ms)).toBe("20240102030405 +0000");
    });

    it("returns null for missing/invalid values", () => {
        expect(xmlTvDate(undefined)).toBeNull();
        expect(xmlTvDate(NaN)).toBeNull();
        expect(xmlTvDate(0)).toBeNull();
    });
});

describe("iptv: tvg ids", () => {
    it("builds live tvg id", () => {
        expect(tvgId("cbs")).toBe("pplus.live.cbs");
    });

    it("builds sport tvg id", () => {
        expect(tvgSportId("evt-1")).toBe("pplus.sport.evt-1");
    });
});

describe("iptv: m3uAttrEscape", () => {
    it("escapes backslashes and quotes", () => {
        expect(m3uAttrEscape("a\\b\"c")).toBe("a\\\\b\\\"c");
    });

    it("collapses newlines to spaces", () => {
        expect(m3uAttrEscape("line1\nline2\r\nline3")).toBe("line1 line2 line3");
    });
});

describe("iptv: extractChannelPrograms", () => {
    it("merges current/upcoming listings and dedupes", () => {
        const channel = {
            currentListing: [
                { title: "Show A", startTimestamp: 1000, endTimestamp: 2000 },
            ],
            upcomingListing: [
                { title: "Show B", startTimestamp: 2000, endTimestamp: 3000 },
                { title: "Show A", startTimestamp: 1000, endTimestamp: 2000 }, // dupe
            ],
        };
        const programs = extractChannelPrograms(channel);
        expect(programs).toHaveLength(2);
        expect(programs[0].title).toBe("Show A");
        expect(programs[1].title).toBe("Show B");
    });

    it("filters out programs without valid timestamps", () => {
        const channel = {
            listings: [
                { title: "No times" },
                { title: "Bad range", startTimestamp: 2000, endTimestamp: 1000 },
                { title: "Good", startTimestamp: 1000, endTimestamp: 2000 },
            ],
        };
        const programs = extractChannelPrograms(channel);
        expect(programs).toHaveLength(1);
        expect(programs[0].title).toBe("Good");
    });

    it("sorts by start timestamp", () => {
        const channel = {
            listings: [
                { title: "Later", startTimestamp: 3000, endTimestamp: 4000 },
                { title: "Earlier", startTimestamp: 1000, endTimestamp: 2000 },
            ],
        };
        const programs = extractChannelPrograms(channel);
        expect(programs.map((p) => p.title)).toEqual(["Earlier", "Later"]);
    });

    it("handles missing listings gracefully", () => {
        expect(extractChannelPrograms({})).toEqual([]);
        expect(extractChannelPrograms(null)).toEqual([]);
    });
});

describe("iptv: mapLiveChannel", () => {
    it("maps a valid channel", () => {
        const raw = {
            slug: "cbs",
            channelName: "CBS",
            filePathLogo: "https://img.example/logo.png",
            currentListing: [
                { title: "News", startTimestamp: 1000, endTimestamp: 2000 },
            ],
        };
        const ch = mapLiveChannel(raw);
        expect(ch).not.toBeNull();
        expect(ch!.slug).toBe("cbs");
        expect(ch!.name).toBe("CBS");
        expect(ch!.source).toBe("live");
        expect(ch!.group).toBe("Paramount+ Live");
        expect(ch!.programs).toHaveLength(1);
    });

    it("returns null when slug and name are both missing", () => {
        expect(mapLiveChannel({})).toBeNull();
        expect(mapLiveChannel({ channelName: "" })).toBeNull();
    });

    it("falls back to slug as name", () => {
        const ch = mapLiveChannel({ slug: "x" });
        expect(ch).not.toBeNull();
        expect(ch!.name).toBe("x");
    });
});

describe("iptv: mapSportChannel", () => {
    it("maps a valid sport event", () => {
        const raw = {
            id: "evt-1",
            title: "Serie A: Match",
            streamStartTimestamp: 1000,
            streamEndTimestamp: 2000,
            channelName: "Sport TV",
        };
        const ch = mapSportChannel(raw);
        expect(ch).not.toBeNull();
        expect(ch!.slug).toBe("evt-1");
        expect(ch!.name).toBe("Serie A: Match");
        expect(ch!.source).toBe("sport");
        expect(ch!.programs).toHaveLength(1);
        expect(ch!.programs[0].startTimestamp).toBe(1000);
    });

    it("returns null for missing id/title", () => {
        expect(mapSportChannel({})).toBeNull();
        expect(mapSportChannel({ id: "x" })).toBeNull();
    });
});