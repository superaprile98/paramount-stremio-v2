import { describe, it, expect } from "vitest";
import { parseShareLink, parseSubscriptionText } from "@/lib/vpn/share-links";
import { buildSingBoxConfig } from "@/lib/vpn/singbox";

describe("parseShareLink — vless", () => {
    it("parses a basic vless link with tls + ws", () => {
        const s = parseShareLink(
            "vless://11111111-2222-3333-4444-555555555555@fr1.example.com:443?encryption=none&security=tls&type=ws&host=cdn.example.com&path=%2Fws%2F%3Fed%3D2560#FR-1"
        );
        expect(s).not.toBeNull();
        expect(s!.protocol).toBe("vless");
        expect(s!.host).toBe("fr1.example.com");
        expect(s!.port).toBe(443);
        expect(s!.uuid).toBe("11111111-2222-3333-4444-555555555555");
        expect(s!.tls).toBe(true);
        // host= è l'header Host del WS, NON lo SNI: senza sni= esplicito
        // lo SNI ricade sul server host.
        expect(s!.sni).toBe("fr1.example.com");
        expect(s!.transport).toBe("ws");
        expect(s!.wsHost).toBe("cdn.example.com");
        expect(s!.wsPath).toBe("/ws/?ed=2560");
        expect(s!.tag).toBe("FR-1");
    });

    it("parses vless with flow and reality security", () => {
        const s = parseShareLink(
            "vless://11111111-2222-3333-4444-555555555555@de1.example.com:8443?security=reality&flow=xtls-rprx-vision&sni=www.example.com#DE-1"
        );
        expect(s!.tls).toBe(true);
        expect(s!.flow).toBe("xtls-rprx-vision");
        expect(s!.sni).toBe("www.example.com");
    });

    it("returns null for vless without uuid", () => {
        expect(parseShareLink("vless://@host:443#x")).toBeNull();
    });
});

describe("parseShareLink — hysteria2", () => {
    it("parses hysteria2 with password and sni", () => {
        const s = parseShareLink(
            "hysteria2://secret-pass@hy2.example.com:8443?insecure=1&sni=hy2.example.com#HY2-1"
        );
        expect(s!.protocol).toBe("hysteria2");
        expect(s!.password).toBe("secret-pass");
        expect(s!.tls).toBe(true);
        expect(s!.insecure).toBe(true);
        expect(s!.sni).toBe("hy2.example.com");
        expect(s!.tag).toBe("HY2-1");
    });
});

describe("parseShareLink — vmess", () => {
    it("parses a base64 vmess link", () => {
        const json = JSON.stringify({
            v: "2",
            ps: "VM-1",
            add: "vm.example.com",
            port: "443",
            id: "11111111-2222-3333-4444-555555555555",
            aid: "0",
            scy: "auto",
            net: "ws",
            type: "none",
            host: "cdn.vm.example.com",
            path: "/vm",
            tls: "tls",
            sni: "cdn.vm.example.com",
        });
        const b64 = Buffer.from(json).toString("base64");
        const s = parseShareLink(`vmess://${b64}`);
        expect(s).not.toBeNull();
        expect(s!.protocol).toBe("vmess");
        expect(s!.host).toBe("vm.example.com");
        expect(s!.port).toBe(443);
        expect(s!.uuid).toBe("11111111-2222-3333-4444-555555555555");
        expect(s!.tls).toBe(true);
        expect(s!.transport).toBe("ws");
        expect(s!.wsPath).toBe("/vm");
        expect(s!.tag).toBe("VM-1");
    });

    it("returns null for invalid vmess base64", () => {
        expect(parseShareLink("vmess://not-valid-json!!")).toBeNull();
    });
});

describe("parseShareLink — trojan", () => {
    it("parses trojan with tls", () => {
        const s = parseShareLink(
            "trojan://trojan-pass@tr.example.com:443?security=tls&sni=tr.example.com#TR-1"
        );
        expect(s!.protocol).toBe("trojan");
        expect(s!.password).toBe("trojan-pass");
        expect(s!.tls).toBe(true);
        expect(s!.sni).toBe("tr.example.com");
    });
});

describe("parseShareLink — shadowsocks", () => {
    it("parses SIP002 ss link", () => {
        const creds = Buffer.from("aes-128-gcm:my-pass").toString("base64");
        const s = parseShareLink(`ss://${creds}@ss.example.com:8388#SS-1`);
        expect(s!.protocol).toBe("ss");
        expect(s!.method).toBe("aes-128-gcm");
        expect(s!.password).toBe("my-pass");
        expect(s!.host).toBe("ss.example.com");
        expect(s!.port).toBe(8388);
        expect(s!.tag).toBe("SS-1");
    });

    it("parses legacy ss link (whole userinfo in host)", () => {
        const creds = Buffer.from("chacha20-ietf-poly1305:legacy-pass@legacy.example.com:8388").toString("base64");
        const s = parseShareLink(`ss://${creds}#LEGACY`);
        expect(s!.protocol).toBe("ss");
        expect(s!.method).toBe("chacha20-ietf-poly1305");
        expect(s!.password).toBe("legacy-pass");
        expect(s!.host).toBe("legacy.example.com");
        expect(s!.port).toBe(8388);
    });
});

describe("parseShareLink — invalid", () => {
    it("returns null for unknown protocol", () => {
        expect(parseShareLink("http://example.com")).toBeNull();
    });
    it("returns null for garbage", () => {
        expect(parseShareLink("not a link at all")).toBeNull();
    });
    it("returns null for empty", () => {
        expect(parseShareLink("   ")).toBeNull();
    });
});

describe("parseSubscriptionText", () => {
    it("parses a base64 subscription with multiple links", () => {
        const links = [
            "vless://11111111-2222-3333-4444-555555555555@a.example.com:443?security=tls#A",
            "hysteria2://pass@b.example.com:8443#B",
            "trojan://pass@c.example.com:443#C",
        ].join("\n");
        const b64 = Buffer.from(links).toString("base64");
        const servers = parseSubscriptionText(b64);
        expect(servers).toHaveLength(3);
        expect(servers.map(s => s.tag)).toEqual(["A", "B", "C"]);
    });

    it("parses plain text with multiple links", () => {
        const servers = parseSubscriptionText(
            "vless://11111111-2222-3333-4444-555555555555@a.example.com:443#A\nvless://11111111-2222-3333-4444-555555555555@b.example.com:443#B"
        );
        expect(servers).toHaveLength(2);
    });

    it("parses a single link directly", () => {
        const servers = parseSubscriptionText("vless://11111111-2222-3333-4444-555555555555@a.example.com:443#A");
        expect(servers).toHaveLength(1);
    });

    it("skips invalid lines but keeps valid ones", () => {
        const servers = parseSubscriptionText(
            "garbage line\nvless://11111111-2222-3333-4444-555555555555@a.example.com:443#A\nhttp://nope"
        );
        expect(servers).toHaveLength(1);
        expect(servers[0].tag).toBe("A");
    });

    it("returns empty array for empty input", () => {
        expect(parseSubscriptionText("")).toEqual([]);
    });
});

describe("buildSingBoxConfig", () => {
    const servers = [
        parseShareLink("vless://11111111-2222-3333-4444-555555555555@a.example.com:443?security=tls&type=ws&path=%2Fws#A")!,
        parseShareLink("hysteria2://pass@b.example.com:8443#B")!,
        parseShareLink("ss://" + Buffer.from("aes-128-gcm:pass").toString("base64") + "@c.example.com:8388#C")!,
    ];

    it("builds http inbound on 0.0.0.0:8888", () => {
        const cfg: any = buildSingBoxConfig(servers);
        expect(cfg.inbounds[0]).toMatchObject({ type: "http", listen: "0.0.0.0", listen_port: 8888 });
    });

    it("creates urltest outbound with all server tags", () => {
        const cfg: any = buildSingBoxConfig(servers);
        const urltest = cfg.outbounds.find((o: any) => o.type === "urltest");
        expect(urltest.tag).toBe("auto");
        expect(urltest.outbounds).toEqual(["A", "B", "C"]);
    });

    it("routes final to auto by default", () => {
        const cfg: any = buildSingBoxConfig(servers);
        expect(cfg.route.final).toBe("auto");
    });

    it("routes final to a specific server tag when valid", () => {
        const cfg: any = buildSingBoxConfig(servers, "B");
        expect(cfg.route.final).toBe("B");
    });

    it("falls back to auto for unknown server tag", () => {
        const cfg: any = buildSingBoxConfig(servers, "NOPE");
        expect(cfg.route.final).toBe("auto");
    });

    it("builds correct outbound per protocol", () => {
        const cfg: any = buildSingBoxConfig(servers);
        const byTag = Object.fromEntries(cfg.outbounds.map((o: any) => [o.tag, o]));
        expect(byTag.A.type).toBe("vless");
        expect(byTag.A.uuid).toBe("11111111-2222-3333-4444-555555555555");
        expect(byTag.A.tls.enabled).toBe(true);
        expect(byTag.A.transport.type).toBe("ws");
        expect(byTag.B.type).toBe("hysteria2");
        expect(byTag.B.password).toBe("pass");
        expect(byTag.C.type).toBe("shadowsocks");
        expect(byTag.C.method).toBe("aes-128-gcm");
    });
});