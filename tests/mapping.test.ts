import { describe, it, expect } from "vitest";
import {
    pplusMovieId,
    pplusSeriesId,
    pplusSportId,
    pplusLiveId,
    parsePplusId,
} from "@/lib/paramount/mapping";

describe("mapping: ID builders", () => {
    it("builds movie id", () => {
        expect(pplusMovieId("abc123")).toBe("pplus:movie:abc123");
    });

    it("builds series id from number", () => {
        expect(pplusSeriesId(42)).toBe("pplus:series:42");
    });

    it("builds sport id", () => {
        expect(pplusSportId("sport-1")).toBe("pplus:sport:sport-1");
    });

    it("builds live id", () => {
        expect(pplusLiveId("cbs")).toBe("pplus:live:cbs");
    });
});

describe("mapping: parsePplusId", () => {
    it("parses movie id", () => {
        expect(parsePplusId("pplus:movie:abc123")).toEqual({ kind: "movie", key: "abc123" });
    });

    it("parses series id", () => {
        expect(parsePplusId("pplus:series:42")).toEqual({ kind: "series", key: "42" });
    });

    it("parses sport id", () => {
        expect(parsePplusId("pplus:sport:evt-9")).toEqual({ kind: "sport", key: "evt-9" });
    });

    it("parses live id", () => {
        expect(parsePplusId("pplus:live:cbs")).toEqual({ kind: "live", key: "cbs" });
    });

    it("keeps keys containing colons intact", () => {
        expect(parsePplusId("pplus:movie:a:b:c")).toEqual({ kind: "movie", key: "a:b:c" });
    });

    it("returns unknown for non-pplus ids", () => {
        expect(parsePplusId("tt1234567")).toEqual({ kind: "unknown", key: "tt1234567" });
    });

    it("returns unknown for unknown kind", () => {
        expect(parsePplusId("pplus:foo:bar")).toEqual({ kind: "unknown", key: "pplus:foo:bar" });
    });

    it("round-trips builders through parser", () => {
        expect(parsePplusId(pplusMovieId("x"))).toEqual({ kind: "movie", key: "x" });
        expect(parsePplusId(pplusSeriesId(7))).toEqual({ kind: "series", key: "7" });
        expect(parsePplusId(pplusSportId("y"))).toEqual({ kind: "sport", key: "y" });
        expect(parsePplusId(pplusLiveId("z"))).toEqual({ kind: "live", key: "z" });
    });
});