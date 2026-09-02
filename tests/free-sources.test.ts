import { describe, it, expect } from "vitest";
import { parseShareLink } from "@/lib/vpn/share-links";
import {
    splitMixedList,
    detectCountry,
    qualityOf,
    securityOf,
} from "@/lib/vpn/free-sources";

describe("free-sources: splitMixedList", () => {
    it("split una stringa con share-link concatenati senza separatori", () => {
        // openproxylist produce spesso un file in cui TUTTI i link sono concatenati
        // su una sola riga. Il parser deve saperli separare.
        const t =
            "vless://aaa@1.1.1.1:443?type=tcp#🇺🇸 node-US" +
            "vmess://bbb@2.2.2.2:443?type=ws#🇩🇪 node-DE" +
            "trojan://ccc@3.3.3.3:443?type=tcp#🇮🇹 node-IT";
        const links = splitMixedList(t);
        expect(links.length).toBe(3);
        expect(links[0].startsWith("vless://")).toBe(true);
        expect(links[1].startsWith("vmess://")).toBe(true);
        expect(links[2].startsWith("trojan://")).toBe(true);
    });
    it("gestisce \\n e \\\\r\\\\n", () => {
        const t = "vless://a\nvmess://b\r\ntrojan://c";
        const links = splitMixedList(t);
        expect(links.length).toBe(3);
    });
});

describe("free-sources: detectCountry", () => {
    it("estrae la country dall'emoji bandiera nel fragment", () => {
        expect(detectCountry("vless://x?y=1#🇺🇸 vless-US")).toBe("US");
        expect(detectCountry("vless://x?y=1#🇩🇪 vless-DE")).toBe("DE");
        expect(detectCountry("vless://x?y=1#🇮🇹 vless-IT")).toBe("IT");
    });
    it("estrae la country dal tag -XX", () => {
        expect(detectCountry("vless://x?y=1#vless-US")).toBe("US");
    });
    it("ritorna XX se nessun marker", () => {
        expect(detectCountry("vless://x?y=1#random")).toBe("XX");
    });
});

describe("free-sources: securityOf / qualityOf", () => {
    it("securityOf rileva reality vs tls vs none", () => {
        const r = parseShareLink("vless://abc@1.1.1.1:443?security=reality&pbk=xxx&sid=short#US");
        const t = parseShareLink("vless://abc@1.1.1.1:443?security=tls&sni=example.com#US");
        const n = parseShareLink("vless://abc@1.1.1.1:443?type=tcp#US");
        expect(r).toBeTruthy();
        expect(t).toBeTruthy();
        expect(n).toBeTruthy();
        if (r) expect(securityOf(r)).toBe("reality");
        if (t) expect(securityOf(t)).toBe("tls");
        if (n) expect(securityOf(n)).toBe("none");
    });

    it("qualityOf: reality > tls > none", () => {
        const r = parseShareLink("vless://abc@1.1.1.1:443?security=reality&pbk=xxx&sid=s&sni=x.example#US");
        const t = parseShareLink("vless://abc@1.1.1.1:443?security=tls&sni=x.example.com#US");
        const n = parseShareLink("vless://abc@1.1.1.1:443?type=tcp#US");
        expect(r).toBeTruthy();
        expect(t).toBeTruthy();
        expect(n).toBeTruthy();
        if (r && t && n) {
            expect(qualityOf(r)).toBeGreaterThan(qualityOf(t));
            expect(qualityOf(t)).toBeGreaterThan(qualityOf(n));
        }
    });
});