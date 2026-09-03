import { describe, it, expect } from "vitest";
import { buildMultiUserSingBoxConfig, type MultiUserEntry } from "@/lib/vpn/singbox";

/**
 * sing-box esce con FATAL "duplicate outbound/endpoint tag" se due outbound
 * condividono lo stesso tag. Le sorgenti gratuite (openproxylist) producono
 * spesso più nodi con lo stesso `s.tag`: la config generata deve deduplicare.
 */
describe("buildMultiUserSingBoxConfig: dedup tag outbound", () => {
    const mkServer = (tag: string, host: string, port: number) => ({
        tag,
        protocol: "vless",
        host,
        port,
        uuid: "test-uuid",
        sni: "example.com",
    } as any);

    it("deduplica tag identici aggiungendo #2, #3, ...", () => {
        const entries: MultiUserEntry[] = [
            {
                userId: "admin",
                port: 8888,
                serverTag: "auto",
                servers: [
                    mkServer("🇺🇸[openproxylist.com] vless-US", "1.1.1.1", 443),
                    mkServer("🇺🇸[openproxylist.com] vless-US", "2.2.2.2", 443),
                    mkServer("🇺🇸[openproxylist.com] vless-US", "3.3.3.3", 443),
                ],
            },
        ];

        const cfg = buildMultiUserSingBoxConfig(entries) as { outbounds: Array<{ tag: string }> };
        const tags = cfg.outbounds.map((o) => o.tag);
        expect(new Set(tags).size).toBe(tags.length);
        // base + 2 duplicati
        expect(tags.filter((t) => t.includes("openproxylist")).length).toBe(3);
    });

    it("tag distinti restano invariati", () => {
        const entries: MultiUserEntry[] = [
            {
                userId: "admin",
                port: 8888,
                serverTag: "auto",
                servers: [
                    mkServer("server-a", "1.1.1.1", 443),
                    mkServer("server-b", "2.2.2.2", 443),
                ],
            },
        ];

        const cfg = buildMultiUserSingBoxConfig(entries) as { outbounds: Array<{ tag: string }> };
        const tags = cfg.outbounds.map((o) => o.tag);
        expect(tags).toContain("uadmin-server-a");
        expect(tags).toContain("uadmin-server-b");
    });

    it("dedup anche tra utenti diversi (stesso s.tag)", () => {
        const entries: MultiUserEntry[] = [
            {
                userId: "admin",
                port: 8888,
                serverTag: "auto",
                servers: [mkServer("shared", "1.1.1.1", 443)],
            },
            {
                userId: "bob",
                port: 8889,
                serverTag: "auto",
                servers: [mkServer("shared", "2.2.2.2", 443)],
            },
        ];

        const cfg = buildMultiUserSingBoxConfig(entries) as { outbounds: Array<{ tag: string }> };
        const tags = cfg.outbounds.map((o) => o.tag);
        expect(new Set(tags).size).toBe(tags.length);
    });
});
