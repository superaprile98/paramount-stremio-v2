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
        kind: "proton-login" | "proxy" | "none";
        login?: {
            usernameMasked: string;
            country: string;
            envPath: string;
            updatedAt: string;
        };
        proxy?: { url: string };
    };
    savedCreds: null | {
        mode: string;
        username?: string;
        country?: string;
        proxyUrl?: string;
        updatedAt?: string;
    };
};

type Tab = "login" | "proxy";

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
    const [tab, setTab] = useState<Tab>("login");
    const [status, setStatus] = useState<VpnStatus | null>(null);
    const [countries, setCountries] = useState<Country[]>([{ code: "US", label: "United States (default per Paramount+)" }]);
    const [loading, setLoading] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<ProbeResult | null>(null);

    // Login form state
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [country, setCountry] = useState("US");
    // Proxy form state
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

    async function loadCountries() {
        try {
            const r = await fetch("/api/vpn/servers");
            const j = await r.json();
            if (j.ok && Array.isArray(j.countries) && j.countries.length > 0) {
                setCountries(j.countries.map((c: any) => ({ code: c.code, label: c.label })));
            }
        } catch {
            /* ignore */
        }
    }

    useEffect(() => {
        refreshStatus();
        loadCountries();
    }, []);

    async function submitLogin() {
        if (!username.trim() || !password) {
            onToast("❌ Inserisci username e password Proton (OpenVPN/IKEv2)");
            return;
        }
        setLoading(true);
        try {
            const r = await fetch("/api/vpn/setup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    mode: "proton-login",
                    username: username.trim(),
                    password,
                    country,
                }),
            });
            const j = await r.json();
            if (!r.ok || !j.ok) {
                onToast(`❌ ${j.error || "Errore"}`);
                return;
            }
            onToast(`✅ ${j.message}`);
            setPassword(""); // sicurezza: non tenere la password in memoria UI
            await refreshStatus();
        } catch (e: any) {
            onToast(`❌ ${e?.message || String(e)}`);
        } finally {
            setLoading(false);
        }
    }

    async function submitProxy() {
        const url = proxyUrl.trim();
        if (!url || !/^https?:\/\//i.test(url)) {
            onToast("❌ URL proxy non valido (deve iniziare con http:// o https://)");
            return;
        }
        setLoading(true);
        try {
            const r = await fetch("/api/vpn/setup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mode: "proxy", url }),
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
            setUsername("");
            setPassword("");
            setProxyUrl("");
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
            subtitle="Connetti Paramount+ US via tunnel ProtonVPN (login) oppure un proxy HTTP esterno."
        >
            {/* Current status */}
            <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-gray-800">Stato corrente:</span>
                    {status?.config?.kind === "proton-login" ? (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
                            🛡️ Proton tunnel → utente {status.config.login?.usernameMasked || "?"}, {status.config.login?.country || "US"}
                        </span>
                    ) : status?.config?.kind === "proxy" ? (
                        <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800">
                            🔌 Proxy → {maskUrl(status?.config?.proxy?.url || "")}
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
                {tabBtn("login", "🔐 Login Proton")}
                {tabBtn("proxy", "🔌 HTTP proxy")}
            </div>

            {/* Tab content */}
            <div className="space-y-3">
                {tab === "login" && (
                    <>
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
                            <strong>Dove trovare le credenziali:</strong>{" "}
                            <a className="text-blue-600 underline" href="https://account.protonvpn.com/account-password" target="_blank" rel="noreferrer">
                                account.protonvpn.com
                            </a>{" "}
                            → <em>Account</em> → <em>OpenVPN/IKEv2 username</em> e <em>OpenVPN/IKEv2 password</em>.
                            <br />
                            Sono credenziali dedicate (es. utente <code className="rounded bg-white px-1 font-mono">nomeutente+pmp</code>) e{" "}
                            <strong>non</strong> la password dell&apos;account Proton.
                        </div>

                        <label className="block text-xs font-semibold text-gray-700">Username OpenVPN/IKEv2</label>
                        <input
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="es. nomeutente+pmp"
                            autoComplete="off"
                            className="w-full rounded-lg border border-gray-300 bg-white p-2 font-mono text-xs"
                        />

                        <label className="block text-xs font-semibold text-gray-700">Password OpenVPN/IKEv2</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="password dedicata OpenVPN"
                            autoComplete="new-password"
                            className="w-full rounded-lg border border-gray-300 bg-white p-2 font-mono text-xs"
                        />

                        <label className="block text-xs font-semibold text-gray-700">Paese server</label>
                        <select
                            value={country}
                            onChange={(e) => setCountry(e.target.value)}
                            className="w-full rounded-lg border border-gray-300 bg-white p-2 text-sm"
                        >
                            {countries.map((c) => (
                                <option key={c.code} value={c.code}>
                                    {c.label}
                                </option>
                            ))}
                        </select>

                        <button
                            onClick={submitLogin}
                            disabled={loading}
                            className="w-full rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-black/85 disabled:opacity-50"
                        >
                            {loading ? "Salvataggio…" : "Save & apply (Proton tunnel)"}
                        </button>

                        <p className="text-[11px] text-gray-500">
                            Le creds vengono salvate cifrate (AES-256-GCM via KEY_SECRET) in <code className="font-mono">vpn-data/gluetun.env</code>,
                            montato come <code className="font-mono">env_file</code> sul container gluetun.
                        </p>
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
                        <button
                            onClick={submitProxy}
                            disabled={loading}
                            className="w-full rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-black/85 disabled:opacity-50"
                        >
                            {loading ? "Salvataggio…" : "Save & apply (HTTP proxy)"}
                        </button>
                    </>
                )}
            </div>

            {/* Test + Reset buttons */}
            <div className="mt-4 flex flex-wrap gap-2">
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

            <p className="mt-4 text-[11px] text-gray-500">
                💡 Dopo il primo save, se non hai ancora installato il watcher systemd, esegui una volta sull&apos;host:{" "}
                <code className="rounded bg-gray-100 px-1 font-mono">bash scripts/install-gluetun-watcher.sh</code> per il restart automatico ad ogni cambio credenziali.
            </p>
        </Card>
    );
}
