"use client";

import { useEffect, useState } from "react";

function Spinner() {
    return (
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
    );
}

type Country = { code: string; label: string };

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
    summary: { count: number; alive: number; blocked: number; throttled: number; dead: number; unknown: number };
    proxies: Array<{ url: string; status: string; score: number; excluded: boolean; lastError?: string; lastStatusCode?: number; lastCheckedAt: number }>;
    config: { kind: "proton-login" | "proxy" | "none"; login?: { usernameMasked: string; country: string; envPath: string; updatedAt: string }; proxy?: { url: string } };
    savedCreds: null | { mode: string; username?: string; country?: string; proxyUrl?: string; updatedAt?: string };
};

function statusBadge(status: string): string {
    switch (status) {
        case "alive": return "bg-green-100 text-green-800 border-green-200";
        case "throttled": return "bg-amber-100 text-amber-800 border-amber-200";
        case "blocked": return "bg-orange-100 text-orange-800 border-orange-200";
        case "dead": return "bg-red-100 text-red-800 border-red-200";
        default: return "bg-gray-100 text-gray-700 border-gray-200";
    }
}

function maskUrl(url: string): string {
    return url.replace(/:[^:@/]+@/, ":***@");
}

export function VpnSetupCard({ onToast }: { onToast: (msg: string) => void }) {
    const [status, setStatus] = useState<VpnStatus | null>(null);
    const [countries, setCountries] = useState<Country[]>([{ code: "US", label: "United States" }]);
    const [loading, setLoading] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<ProbeResult | null>(null);

    // ProtonVPN login
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [country, setCountry] = useState("US");

    // HTTP proxy
    const [proxyUrl, setProxyUrl] = useState("");

    async function refreshStatus() {
        try {
            const r = await fetch("/api/vpn/status");
            const vj = await r.json();
            if (vj.ok) setStatus(vj);
        } catch { /* ignore */ }
    }

    async function loadCountries() {
        try {
            const r = await fetch("/api/vpn/servers");
            const j = await r.json();
            if (j.ok && Array.isArray(j.countries) && j.countries.length > 0) {
                setCountries(j.countries.map((c: any) => ({ code: c.code, label: c.label })));
            }
        } catch { /* ignore */ }
    }

    useEffect(() => { refreshStatus(); loadCountries(); }, []);

    /* ── ProtonVPN ── */

    async function submitVpn() {
        if (!username.trim() || !password) { onToast("❌ Enter Proton username and password"); return; }
        setLoading(true);
        try {
            const r = await fetch("/api/vpn/setup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mode: "proton-login", username: username.trim(), password, country }),
            });
            const j = await r.json();
            if (!r.ok || !j.ok) { onToast(`❌ ${j.error || "Error"}`); return; }
            onToast(`✅ ${j.message}`);
            setPassword("");
            await refreshStatus();
        } catch (e: any) { onToast(`❌ ${e?.message || String(e)}`); }
        finally { setLoading(false); }
    }

    /* ── HTTP proxy ── */

    async function submitProxy() {
        const url = proxyUrl.trim();
        if (!url || !/^https?:\/\//i.test(url)) { onToast("❌ Invalid proxy URL (must start with http:// or https://)"); return; }
        setLoading(true);
        try {
            const r = await fetch("/api/vpn/setup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mode: "proxy", url }),
            });
            const j = await r.json();
            if (!r.ok || !j.ok) { onToast(`❌ ${j.error || "Error"}`); return; }
            onToast(`✅ ${j.message}`);
            await refreshStatus();
        } catch (e: any) { onToast(`❌ ${e?.message || String(e)}`); }
        finally { setLoading(false); }
    }

    /* ── Test / Reset ── */

    async function runTest() {
        setTesting(true);
        setTestResult(null);
        try {
            const r = await fetch("/api/vpn/test");
            const j = await r.json();
            if (!r.ok || !j.ok) { onToast(`❌ ${j.error || "Error"}`); return; }
            setTestResult(j.result);
            await refreshStatus();
        } catch (e: any) { onToast(`❌ ${e?.message || String(e)}`); }
        finally { setTesting(false); }
    }

    async function clearAll() {
        if (!confirm("Remove current VPN/proxy configuration?")) return;
        setLoading(true);
        try {
            const r = await fetch("/api/vpn/setup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mode: "clear" }),
            });
            const j = await r.json();
            if (!r.ok || !j.ok) { onToast(`❌ ${j.error || "Error"}`); return; }
            onToast(`✅ ${j.message}`);
            setUsername(""); setPassword(""); setProxyUrl("");
            await refreshStatus();
        } finally { setLoading(false); }
    }

    /* ── render ── */

    const isVpnActive = status?.config?.kind === "proton-login";
    const isProxyActive = status?.config?.kind === "proxy";

    return (
        <>
            {/* Status bar */}
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold text-gray-800">Proxy / VPN</span>
                    {isVpnActive ? (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
                            🛡️ Proton: {status?.config?.login?.usernameMasked || "?"} ({status?.config?.login?.country || "US"})
                        </span>
                    ) : isProxyActive ? (
                        <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800">
                            🔌 Proxy: {maskUrl(status?.config?.proxy?.url || "")}
                        </span>
                    ) : (
                        <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs font-medium text-gray-500">
                            No VPN/proxy configured
                        </span>
                    )}
                    <span className="ml-auto text-xs text-gray-400">
                        {status?.summary ? `${status.summary.alive} alive · ${status.summary.blocked} blocked` : ""}
                    </span>
                </div>

                {/* Proxy indicators */}
                {status?.proxies && status.proxies.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                        {status.proxies.map((p, i) => (
                            <span key={i} title={`Score ${p.score} · ${p.lastStatusCode ?? "-"}${p.lastError ? " · " + p.lastError : ""}`}
                                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${statusBadge(p.status)}`}>
                                <span className="font-mono">{maskUrl(p.url)}</span>
                                <span className="opacity-60">·</span>
                                <span>{p.status}</span>
                            </span>
                        ))}
                    </div>
                )}

                {/* Test / Reset */}
                <div className="mt-3 flex gap-2 border-t border-gray-100 pt-3">
                    <button onClick={runTest} disabled={testing}
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50">
                        {testing ? <><Spinner /> Testing...</> : <>🧪 Test connection</>}
                    </button>
                    <button onClick={clearAll} disabled={loading}
                        className="ml-auto rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
                        🗑️ Reset
                    </button>
                </div>

                {/* Test result */}
                {testResult && (
                    <div className={`mt-3 rounded-xl border p-3 text-sm ${testResult.ok ? "border-green-200 bg-green-50 text-green-900"
                        : testResult.vpnDetected || testResult.geoBlocked ? "border-orange-200 bg-orange-50 text-orange-900"
                            : "border-red-200 bg-red-50 text-red-900"}`}>
                        <div className="font-semibold">
                            {testResult.ok ? "✅ Connection OK"
                                : testResult.vpnDetected ? "⚠️ VPN detected by Paramount+"
                                    : testResult.geoBlocked ? "🌍 Geo-blocked (HTTP 451)"
                                        : "❌ Connection failed"}
                        </div>
                        <div className="mt-1 text-xs space-x-1">
                            {testResult.proxy && <span>Proxy: <code className="font-mono">{maskUrl(testResult.proxy)}</code></span>}
                            {testResult.statusCode !== undefined && <span>· HTTP {testResult.statusCode}</span>}
                            {testResult.ip && <span>· IP: <code className="font-mono">{testResult.ip}</code></span>}
                            {testResult.country && <span>· {testResult.country}</span>}
                            {testResult.city && <span>· {testResult.city}</span>}
                            <span>· {testResult.elapsedMs}ms</span>
                        </div>
                        {testResult.error && <div className="mt-1 text-xs opacity-75">{testResult.error}</div>}
                    </div>
                )}
            </div>

            {/* ProtonVPN section */}
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-gray-800">🛡️ ProtonVPN (recommended)</h3>
                <p className="text-xs text-gray-500 mt-0.5 mb-3">Built-in ProtonVPN tunnel via gluetun. Uses your Proton account credentials.</p>

                {isVpnActive ? (
                    <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800">
                        ✅ Active — {status?.config?.login?.usernameMasked} via {status?.config?.login?.country}
                    </div>
                ) : (
                    <div className="space-y-2">
                        <input value={username} onChange={(e) => setUsername(e.target.value)}
                            placeholder="Proton username" autoComplete="off"
                            className="w-full rounded-lg border border-gray-300 bg-white p-2 text-xs font-mono outline-none focus:border-emerald-500" />
                        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                            placeholder="Proton password" autoComplete="new-password"
                            className="w-full rounded-lg border border-gray-300 bg-white p-2 text-xs font-mono outline-none focus:border-emerald-500" />
                        <select value={country} onChange={(e) => setCountry(e.target.value)}
                            className="w-full rounded-lg border border-gray-300 bg-white p-2 text-xs">
                            {countries.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                        </select>
                        <button onClick={submitVpn} disabled={loading}
                            className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center justify-center gap-1">
                            {loading ? <><Spinner /> Saving...</> : "Save & connect"}
                        </button>
                    </div>
                )}
            </div>

            {/* HTTP proxy section */}
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-gray-800">🔌 HTTP Proxy (alternative)</h3>
                <p className="text-xs text-gray-500 mt-0.5 mb-3">Use an external HTTP/HTTPS proxy (e.g. Webshare, smartproxy).</p>

                {isProxyActive ? (
                    <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
                        ✅ Active — {maskUrl(status?.config?.proxy?.url || "")}
                    </div>
                ) : (
                    <div className="space-y-2">
                        <input value={proxyUrl} onChange={(e) => setProxyUrl(e.target.value)}
                            placeholder="http://user:pass@proxy.example.com:8080"
                            className="w-full rounded-lg border border-gray-300 bg-white p-2 text-xs font-mono outline-none focus:border-blue-500" />
                        <button onClick={submitProxy} disabled={loading}
                            className="w-full rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 inline-flex items-center justify-center gap-1">
                            {loading ? <><Spinner /> Saving...</> : "Save & connect"}
                        </button>
                    </div>
                )}
            </div>
        </>
    );
}
