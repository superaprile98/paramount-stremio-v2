import { describe, it, expect } from "vitest";
import {
    pplusSportId,
    pplusLiveId,
    parsePplusId,
} from "@/lib/paramount/mapping";

describe("mapping: ID builders", () => {
    it("builds sport id", () => {
        expect(pplusSportId("sport-1")).toBe("pplus:sport:sport-1");
    });

    it("builds live id", () => {
        expect(pplusLiveId("cbs")).toBe("pplus:live:cbs");
    });
});

describe("mapping: parsePplusId", () => {
    it("parses sport id", () => {
        expect(parsePplusId("pplus:sport:evt-9")).toEqual({ kind: "sport", key: "evt-9" });
    });

    it("parses live id", () => {
        expect(parsePplusId("pplus:live:cbs")).toEqual({ kind: "live", key: "cbs" });
    });

    it("keeps keys containing colons intact", () => {
        expect(parsePplusId("pplus:sport:a:b:c")).toEqual({ kind: "sport", key: "a:b:c" });
    });

    it("returns unknown for non-pplus ids", () => {
        expect(parsePplusId("tt1234567")).toEqual({ kind: "unknown", key: "tt1234567" });
    });

    it("returns unknown for unknown kind", () => {
        expect(parsePplusId("pplus:foo:bar")).toEqual({ kind: "unknown", key: "pplus:foo:bar" });
    });

    it("returns unknown for legacy movie/series ids (VOD removed)", () => {
        expect(parsePplusId("pplus:movie:abc")).toEqual({ kind: "unknown", key: "pplus:movie:abc" });
        expect(parsePplusId("pplus:series:42")).toEqual({ kind: "unknown", key: "pplus:series:42" });
    });

    it("round-trips builders through parser", () => {
        expect(parsePplusId(pplusSportId("y"))).toEqual({ kind: "sport", key: "y" });
        expect(parsePplusId(pplusLiveId("z"))).toEqual({ kind: "live", key: "z" });
    });
});
