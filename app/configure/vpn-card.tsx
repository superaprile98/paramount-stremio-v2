"use client";

import { useEffect, useState } from "react";

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
    return (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
                <h2 className="text-base font-semibold text-gray-900">{title}</h2>
                {subtitle ? <p className="mt-1 text-sm text-gray-600">{subtitle}</p> : null}
            </div>
            {children}
        </div>
    );
}

type ProtonServer = {
    country: string;
    city: string;
    code: string;
    endpoint: string;
    publicKey: string;
    port?: number;
};

type ProbeResult = {
    ok: boolean;
    proxy: string | null;
    statusCode?: number;
    error?: string;
    vpnDetected: boolean;
    geoBlocked: boolean;
    ip?: string;
    country?: string;
    city?: string;
    org?: string;
    elapsedMs: number;
    checkedAt: string;
};

type VpnStatus = {
    summary: {
        count: number;
        alive: number;
        blocked: number;
        throttled: number;
        dead: number;
        unknown: number;
    };
    proxies: Array<{
        url: string;
        status: "alive" | "blocked" | "throttled" | "dead" | "unknown";
        score: number;
        excluded: boolean;
        lastError?: string;
        lastStatusCode?: number;
        lastCheckedAt: number;
    }>;
    config: {
        kind: "wireguard" | "proxy" | "none";
        wireguard?: {
            path: string;
            server?: ProtonServer;
            privateKeyMasked: string;
        };
        proxy?: { url: string };
    };
    savedCreds: null | {
        mode: string;
        serverCode?: string;
        proxyUrl?: string;
        updatedAt?: string;
    };
};

type Tab = "conf" | "key" | "proxy";

function maskUrl(url: string): string {
    return url.replace(/:[^:@/]+@/, ":***@");
}

function statusBadge(status: string): string {
    switch (status) {
        case "alive":
            return "bg-green-100 text-green-800 border-green-200";
        case "throttled":
            return "bg-amber-100 text-amber-800 border-amber-200";
        case "blocked":
            return "bg-orange-100 text-orange-800 border-orange-200";
        case "dead":
            return "bg-red-100 text-red-800 border-red-200";
        default:
            return "bg-gray-100 text-gray-700 border-gray-200";
    }
}

export function VpnSetupCard({ onToast }: { onToast: (msg: string) => void }) {
    const [tab, setTab] = useState<Tab>("conf");
    const [status, setStatus] = useState<VpnStatus | null>(null);
    const [servers, setServers] = useState<ProtonServer[]>([]);
    const [loading, setLoading] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<ProbeResult | null>(null);

    // Form state
    const [confText, setConfText] = useState("");
    const [privateKey, setPrivateKey] = useState("");
    const [serverCode, setServerCode] = useState("");
    const [proxyUrl, setProxyUrl] = useState("");

    async function refreshStatus() {
        try {
            const r = await fetch("/api/vpn/status");
            const j = await r.json();
            if (j.ok) setStatus(j);
        } catch {
            /* ignore */
        }
    }

    async function loadServers() {
        try {
            const r = await fetch("/api/vpn/servers");
            const j = await r.json();
            if (j.ok && Array.isArray(j.servers)) {
                setServers(j.servers);
                if (!serverCode && j.servers[0]) setServerCode(j.servers[0].code);
            }
        } catch {
            /* ignore */
        }
    }

    useEffect(() => {
        refreshStatus();
        loadServers();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function submit() {
        setLoading(true);
        try {
            const body: any = { mode: tab };
            if (tab === "conf") body.confText = confText;
            if (tab === "key") {
                body.privateKey = privateKey;
                body.serverCode = serverCode;
            }
            if (tab === "proxy") body.url = proxyUrl;
            const r = await fetch("/api/vpn/setup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const j = await r.json();
            if (!r.ok || !j.ok) {
                onToast(`❌ ${j.error || "Errore"}`);
                return;
            }
            onToast(`✅ ${j.message}`);
            await refreshStatus();
        } catch (e: any) {
            onToast(`❌ ${e?.message || String(e)}`);
        } finally {
            setLoading(false);
        }
    }

    async function runTest() {
        setTesting(true);
        setTestResult(null);
        try {
            const r = await fetch("/api/vpn/test");
            const j = await r.json();
            if (!r.ok || !j.ok) {
                onToast(`❌ ${j.error || "Errore"}`);
                return;
            }
            setTestResult(j.result);
            await refreshStatus();
        } catch (e: any) {
            onToast(`❌ ${e?.message || String(e)}`);
        } finally {
            setTesting(false);
        }
    }

    async function clearAll() {
        if (!confirm("Rimuovere la configurazione VPN/proxy corrente?")) return;
        setLoading(true);
        try {
            const r = await fetch("/api/vpn/setup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mode: "clear" }),
            });
            const j = await r.json();
            if (!r.ok || !j.ok) {
                onToast(`❌ ${j.error || "Errore"}`);
                return;
            }
            onToast(`✅ ${j.message}`);
            await refreshStatus();
        } finally {
            setLoading(false);
        }
    }

    const tabBtn = (id: Tab, label: string) => (
        <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${tab === id
                ? "bg-black text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
        >
            {label}
        </button>
    );

    return (
        <Card
            title="🌐 VPN / Proxy (optional)"
            subtitle="Configure ProtonVPN (gluetun tunnel) or an external HTTP proxy for streaming from outside the US."
        >
            {/* Current status */}
            <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-gray-800">Stato corrente:</span>
                    {status?.config?.kind === "wireguard" ? (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
                            🛡️ WireGuard → {status.config.wireguard?.server?.code || "custom"} ({status.config.wireguard?.server?.city || "?"})
                        </span>
                    ) : status?.config?.kind === "proxy" ? (
                        <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800">
                            🔌 Proxy → {maskUrl(status.config.proxy?.url || "")}
                        </span>
                    ) : (
                        <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs font-medium text-gray-600">
                            ⚪ Nessuna configurazione (usa default)
                        </span>
                    )}
                    {status?.summary && (
                        <span className="ml-auto text-xs text-gray-500">
                            Proxy: {status.summary.alive} alive · {status.summary.blocked} blocked · {status.summary.dead} dead
                        </span>
                    )}
                </div>
                {status?.proxies && status.proxies.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                        {status.proxies.map((p, i) => (
                            <span
                                key={i}
                                title={`Score ${p.score} · Last status: ${p.lastStatusCode ?? "—"}${p.lastError ? " · " + p.lastError : ""}`}
                                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${statusBadge(p.status)}`}
                            >
                                <span className="font-mono">{maskUrl(p.url)}</span>
                                <span className="opacity-60">·</span>
                                <span>{p.status}</span>
                            </span>
                        ))}
                    </div>
                )}
            </div>

            {/* Tabs */}
            <div className="mb-3 flex gap-2">
                {tabBtn("conf", "📄 WireGuard .conf")}
                {tabBtn("key", "🔑 Private key + server")}
                {tabBtn("proxy", "🔌 HTTP proxy URL")}
            </div>

            {/* Tab content */}
            <div className="space-y-3">
                {tab === "conf" && (
                    <>
                        <p className="text-xs text-gray-600">
                            Incolla il contenuto del file <code className="rounded bg-gray-100 px-1">.conf</code> scaricato da{" "}
                            <a className="text-blue-600 underline" href="https://account.protonvpn.com/downloads" target="_blank" rel="noreferrer">
                                account.protonvpn.com
                            </a>{" "}
                            (Downloads → WireGuard configuration).
                        </p>
                        <textarea
                            value={confText}
                            onChange={(e) => setConfText(e.target.value)}
                            placeholder="[Interface]&#10;PrivateKey = ...&#10;Address = 10.2.0.2/32&#10;DNS = 10.2.0.1&#10;&#10;[Peer]&#10;PublicKey = ...&#10;Endpoint = 185.159.157.10:51820&#10;..."
                            rows={8}
                            className="w-full rounded-lg border border-gray-300 bg-white p-2 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none"
                        />
                    </>
                )}

                {tab === "key" && (
                    <>
                        <p className="text-xs text-gray-600">
                            Incolla solo la <strong>PrivateKey</strong> dal config Proton e scegli un server USA dal menu.
                        </p>
                        <label className="block text-xs font-semibold text-gray-700">Private key</label>
                        <input
                            type="password"
                            value={privateKey}
                            onChange={(e) => setPrivateKey(e.target.value)}
                            placeholder="e.g. gI6EdUSYvn8ugXOt8qqD6M7ayx0w8vTZbF4MhGMrJGA="
                            className="w-full rounded-lg border border-gray-300 bg-white p-2 font-mono text-xs"
                        />
                        <label className="block text-xs font-semibold text-gray-700">Server</label>
                        <select
                            value={serverCode}
                            onChange={(e) => setServerCode(e.target.value)}
                            className="w-full rounded-lg border border-gray-300 bg-white p-2 text-sm"
                        >
                            {servers.length === 0 && <option value="">(loading…)</option>}
                            {servers.map((s) => (
                                <option key={s.code} value={s.code}>
                                    {s.code} — {s.city}, {s.country}
                                </option>
                            ))}
                        </select>
                    </>
                )}

                {tab === "proxy" && (
                    <>
                        <p className="text-xs text-gray-600">
                            Incolla un proxy HTTP/HTTPS/SOCKS esterno (es. Webshare, smartproxy). Supporta credenziali inline:{" "}
                            <code className="rounded bg-gray-100 px-1">http://user:pass@host:port</code>.
                        </p>
                        <input
                            value={proxyUrl}
                            onChange={(e) => setProxyUrl(e.target.value)}
                            placeholder="http://user:pass@proxy.example.com:8080"
                            className="w-full rounded-lg border border-gray-300 bg-white p-2 font-mono text-xs"
                        />
                    </>
                )}
            </div>

            {/* Action buttons */}
            <div className="mt-4 flex flex-wrap gap-2">
                <button
                    onClick={submit}
                    disabled={loading}
                    className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-black/85 disabled:opacity-50"
                >
                    {loading ? "Salvataggio…" : "Save & apply"}
                </button>
                <button
                    onClick={runTest}
                    disabled={testing}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-gray-50 disabled:opacity-50"
                >
                    {testing ? "Testing…" : "🧪 Test connection"}
                </button>
                <button
                    onClick={clearAll}
                    disabled={loading}
                    className="ml-auto rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50"
                >
                    🗑️ Reset
                </button>
            </div>

            {/* Test result */}
            {testResult && (
                <div
                    className={`mt-4 rounded-xl border p-3 text-sm ${testResult.ok
                        ? "border-green-200 bg-green-50 text-green-900"
                        : testResult.vpnDetected || testResult.geoBlocked
                            ? "border-orange-200 bg-orange-50 text-orange-900"
                            : "border-red-200 bg-red-50 text-red-900"
                        }`}
                >
                    <div className="font-semibold">
                        {testResult.ok
                            ? "✅ Connection OK"
                            : testResult.vpnDetected
                                ? "⚠️ VPN detected by Paramount+"
                                : testResult.geoBlocked
                                    ? "🌍 Geo-blocked (HTTP 451)"
                                    : "❌ Connection failed"}
                    </div>
                    <div className="mt-1 text-xs">
                        {testResult.proxy && <span>Proxy: <code className="font-mono">{maskUrl(testResult.proxy)}</code> · </span>}
                        {testResult.statusCode !== undefined && <span>HTTP {testResult.statusCode} · </span>}
                        {testResult.ip && <span>IP: <code className="font-mono">{testResult.ip}</code> · </span>}
                        {testResult.country && <span>Country: {testResult.country} · </span>}
                        {testResult.city && <span>{testResult.city} · </span>}
                        {testResult.org && <span>{testResult.org} · </span>}
                        <span>{testResult.elapsedMs}ms</span>
                    </div>
                    {testResult.error && (
                        <div className="mt-1 text-xs opacity-75">Error: {testResult.error}</div>
                    )}
                </div>
            )}

            <p className="mt-4 text-xs text-gray-500">
                💡 Dopo aver salvato, sul host esegui:{" "}
                <code className="rounded bg-gray-100 px-1 font-mono">bash scripts/restart-gluetun.sh</code> per applicare la nuova config al tunnel.
            </p>
        </Card>
    );
}
