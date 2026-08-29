import { describe, it, expect } from "vitest";
import { parseXrayJson, parseConfigText } from "../lib/vpn/share-links";
import { buildSingBoxConfig } from "../lib/vpn/singbox";

// Simulated structure of https://mc.minecraft.webcam/sub/e98bf8950d4ebc10e0222406eff5a7a4c977?app=happ
const sample = [
    {
        remarks: "🇺🇸 1404 | Basic USA | осталось 30д",
        log: { loglevel: "warning" },
        dns: {},
        inbounds: [],
        outbounds: [
            {
                tag: "p-reality",
                protocol: "vless",
                settings: {
                    vnext: [
                        {
                            address: "ppq55com4rm4.minecraft.webcam",
                            port: 443,
                            users: [{ id: "13d84740-9824-4d17-a00e-765fb640a476", flow: "xtls-rprx-vision", encryption: "none" }],
                        },
                    ],
                },
                streamSettings: {
                    network: "tcp",
                    security: "reality",
                    realitySettings: {
                        serverName: "cdnjs.com",
                        fingerprint: "chrome",
                        publicKey: "9ngNG5S7MWDT7blqRQZix2-Ze24yRxj8nNNmEU8lTkg",
                        shortId: "4c33e4b27eabede7",
                        spiderX: "/",
                    },
                },
            },
            {
                tag: "p-hysteria",
                protocol: "hysteria",
                settings: {
                    address: "ppq55com4rm4.minecraft.webcam",
                    port: 443,
                    version: 2,
                },
                streamSettings: {
                    network: "hysteria",
                    security: "tls",
                    tlsSettings: { serverName: "www.bing.com", fingerprint: "firefox" },
                    hysteriaSettings: { auth: "13d84740-9824-4d17-a00e-765fb640a476", version: 2 },
                },
            },
            {
                tag: "p-ws",
                protocol: "vless",
                settings: {
                    vnext: [
                        {
                            address: "ppq55com4rm4.minecraft.webcam",
                            port: 8443,
                            users: [{ id: "13d84740-9824-4d17-a00e-765fb640a476", encryption: "none" }],
                        },
                    ],
                },
                streamSettings: {
                    network: "ws",
                    security: "tls",
                    tlsSettings: { serverName: "ppq55com4rm4.minecraft.webcam" },
                    wsSettings: { path: "/ws", headers: { Host: "ppq55com4rm4.minecraft.webcam" } },
                },
            },
            {
                tag: "p-grpc",
                protocol: "vless",
                settings: {
                    vnext: [
                        {
                            address: "ppq55com4rm4.minecraft.webcam",
                            port: 2053,
                            users: [{ id: "13d84740-9824-4d17-a00e-765fb640a476", encryption: "none" }],
                        },
                    ],
                },
                streamSettings: {
                    network: "grpc",
                    security: "reality",
                    realitySettings: {
                        serverName: "cdnjs.com",
                        publicKey: "9ngNG5S7MWDT7blqRQZix2-Ze24yRxj8nNNmEU8lTkg",
                        shortId: "4c33e4b27eabede7",
                    },
                    grpcSettings: { serviceName: "grpc", multiMode: true },
                },
            },
            {
                tag: "p-xhttp",
                protocol: "vless",
                settings: {
                    vnext: [
                        {
                            address: "ppq55com4rm4.minecraft.webcam",
                            port: 2096,
                            users: [{ id: "13d84740-9824-4d17-a00e-765fb640a476", encryption: "none" }],
                        },
                    ],
                },
                streamSettings: {
                    network: "xhttp",
                    security: "tls",
                    tlsSettings: { serverName: "ppq55com4rm4.minecraft.webcam" },
                    xhttpSettings: { path: "/xhttp", mode: "auto" },
                },
            },
            { tag: "direct", protocol: "freedom", settings: {} },
            { tag: "block", protocol: "blackhole", settings: {} },
        ],
        routing: {},
    },
];

const json = JSON.stringify(sample);

describe("parseXrayJson", () => {
    it("parses a full Xray config array (5 usable outbounds)", () => {
        const servers = parseXrayJson(json);
        expect(servers).not.toBeNull();
        expect(servers!.length).toBe(5);
    });

    it("parses reality vless with public key, short id and flow", () => {
        const servers = parseXrayJson(json)!;
        const reality = servers.find((s) => s.tag === "p-reality");
        expect(reality).toBeDefined();
        expect(reality!.protocol).toBe("vless");
        expect(reality!.host).toBe("ppq55com4rm4.minecraft.webcam");
        expect(reality!.port).toBe(443);
        expect(reality!.tls).toBe(true);
        expect(reality!.flow).toBe("xtls-rprx-vision");
        expect(reality!.realityPublicKey).toBe("9ngNG5S7MWDT7blqRQZix2-Ze24yRxj8nNNmEU8lTkg");
        expect(reality!.realityShortId).toBe("4c33e4b27eabede7");
    });

    it("parses hysteria2 using the auth field", () => {
        const servers = parseXrayJson(json)!;
        const hy = servers.find((s) => s.tag === "p-hysteria");
        expect(hy).toBeDefined();
        expect(hy!.protocol).toBe("hysteria2");
        expect(hy!.password).toBe("13d84740-9824-4d17-a00e-765fb640a476");
    });

    it("parses ws, grpc and xhttp transports", () => {
        const servers = parseXrayJson(json)!;
        const ws = servers.find((s) => s.tag === "p-ws");
        expect(ws!.transport).toBe("ws");
        expect(ws!.wsPath).toBe("/ws");
        const grpc = servers.find((s) => s.tag === "p-grpc");
        expect(grpc!.transport).toBe("grpc");
        expect(grpc!.grpcServiceName).toBe("grpc");
        const xhttp = servers.find((s) => s.tag === "p-xhttp");
        expect(xhttp!.transport).toBe("xhttp");
        expect(xhttp!.xhttpPath).toBe("/xhttp");
        expect(xhttp!.xhttpMode).toBe("auto");
    });

    it("parses a single config object (not wrapped in an array)", () => {
        const servers = parseXrayJson(JSON.stringify(sample[0]));
        expect(servers!.length).toBe(5);
    });

    it("returns null for invalid JSON", () => {
        expect(parseXrayJson("{not json")).toBeNull();
    });

    it("returns null for non-JSON text", () => {
        expect(parseXrayJson("vless://abc@def:443#test")).toBeNull();
    });
});

describe("parseConfigText", () => {
    it("detects Xray JSON and falls back to share-link parsing", () => {
        const servers = parseConfigText(json);
        expect(servers.length).toBe(5);
    });
});

describe("buildSingBoxConfig from Xray JSON", () => {
    it("generates a valid sing-box config with urltest group and reality/xhttp outbounds", () => {
        const servers = parseXrayJson(json)!;
        const cfg: any = buildSingBoxConfig(servers, "auto");
        expect(cfg.outbounds.length).toBe(6);
        const auto = cfg.outbounds.find((o: any) => o.tag === "auto");
        expect(auto.type).toBe("urltest");
        expect(auto.outbounds).toEqual(["p-reality", "p-hysteria", "p-ws", "p-grpc", "p-xhttp"]);
        const reality = cfg.outbounds.find((o: any) => o.tag === "p-reality");
        expect(reality.tls.reality.enabled).toBe(true);
        expect(reality.tls.reality.public_key).toBe("9ngNG5S7MWDT7blqRQZix2-Ze24yRxj8nNNmEU8lTkg");
        const xhttp = cfg.outbounds.find((o: any) => o.tag === "p-xhttp");
        expect(xhttp.transport.type).toBe("xhttp");
        expect(xhttp.transport.path).toBe("/xhttp");
        expect(cfg.route.final).toBe("auto");
    });
});