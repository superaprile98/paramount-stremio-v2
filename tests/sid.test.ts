import { describe, it, expect, beforeEach } from "vitest";
import { shorten, extend } from "@/lib/http/sid";

type UrlCacheEntry = {
    key: string;
    u: string | null;
    t: string | null;
    l?: string | null;
    f?: string | null;
};

type GlobalWithUrlCache = typeof globalThis & {
    urlCache?: Map<string, UrlCacheEntry>;
};

describe("sid cache", () => {
    beforeEach(() => {
        // La cache è globale (globalThis): ripuliamola tra i test per isolamento.
        const g = globalThis as GlobalWithUrlCache;
        if (g.urlCache) {
            g.urlCache.clear();
        }
    });

    it("shorten returns a stable id for the same inputs", () => {
        const a = shorten("k", "https://u.example/1", "t");
        const b = shorten("k", "https://u.example/1", "t");
        expect(a).toBe(b);
    });

    it("shorten returns different ids for different inputs", () => {
        const a = shorten("k", "https://u.example/1", "t");
        const b = shorten("k", "https://u.example/2", "t");
        expect(a).not.toBe(b);
    });

    it("extend returns the stored entry", () => {
        const sid = shorten("key1", "https://u.example/seg.ts", "tok", "label", "fmt");
        const entry = extend(sid);
        expect(entry).not.toBeNull();
        expect(entry!.key).toBe("key1");
        expect(entry!.u).toBe("https://u.example/seg.ts");
        expect(entry!.t).toBe("tok");
        expect(entry!.l).toBe("label");
        expect(entry!.f).toBe("fmt");
    });

    it("extend returns null for unknown ids", () => {
        expect(extend("NOPE")).toBeNull();
    });

    it("evicts oldest entries when the cache exceeds the limit", () => {
        const g = globalThis as GlobalWithUrlCache;
        // Inietta una cache quasi piena per testare l'eviction FIFO.
        g.urlCache = new Map();
        for (let i = 0; i < 9999; i++) {
            g.urlCache.set(`old-${i}`, { key: "k", u: "u", t: "t" });
        }
        const sid = shorten("k", "https://u.example/new", "t");
        expect(g.urlCache.size).toBeLessThanOrEqual(10000);
        expect(extend(sid)).not.toBeNull();
    });
});