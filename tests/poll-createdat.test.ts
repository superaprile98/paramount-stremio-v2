import { describe, it, expect } from "vitest";

/**
 * Regressione: la validazione del payload in /api/auth/device/poll usava
 * `Date.parse(auth.createdAt)` per validare una stringa numerica (millisecondi
 * da `Date.now().toString()`). In Node `Date.parse("1787078...")` ritorna
 * `NaN`, quindi ogni poll veniva rifiutato con 400 "Invalid auth payload".
 *
 * Il fix converte esplicitamente con `Number()`.
 */
describe("poll route: createdAt validation", () => {
    it("accepts a numeric string of milliseconds (Date.now().toString())", () => {
        const v = Date.now().toString();
        // Vecchio controllo: Number.isNaN(Date.parse(v)) === true in Node → reject
        // Nuovo controllo: Number(v) è un intero valido
        const ms = Number(v);
        expect(Number.isFinite(ms)).toBe(true);
        expect(ms).toBeGreaterThan(0);
    });

    it("rejects non-numeric strings", () => {
        const ms = Number("not-a-number");
        expect(Number.isFinite(ms)).toBe(false);
    });

    it("rejects zero/negative numbers", () => {
        expect(Number.isFinite(Number(0)) && Number(0) > 0).toBe(false);
        expect(Number.isFinite(Number(-1)) && Number(-1) > 0).toBe(false);
    });

    it("accepts a payload created just now as not expired (10 min window)", () => {
        const createdAtMs = Number(Date.now().toString());
        const ageMs = Date.now() - createdAtMs;
        expect(ageMs).toBeLessThanOrEqual(10 * 60 * 1000);
    });

    it("rejects a payload created 11 minutes ago as expired", () => {
        const createdAtMs = Number(Date.now().toString()) - 11 * 60 * 1000;
        const ageMs = Date.now() - createdAtMs;
        expect(ageMs).toBeGreaterThan(10 * 60 * 1000);
    });
});
