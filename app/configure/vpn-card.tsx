"use client";

import { useState, useEffect } from "react";

/* ── Spinner ──────────────────────────────────────────────────── */

function Spinner() {
    return (
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
    );
}

/* ── Types ────────────────────────────────────────────────────── */

type ProbeResult = {
    ok: boolean;
    proxy?: string;
    statusCode?: number;
    ip?: string;
    country?: string;
    city?: string;
    elapsedMs?: number;
    error?: string;
    vpnDetected?: boolean;
    geoBlocked?: boolean;
};

type PreviewServer = {
    tag: string;
    protocol: string;
    host: string;
    port: number;
};

type VpnStatus = {
    ok: boolean;
    summary?: { alive: number; blocked: number; throttled: number; dead: number; unknown: number };
    proxies?: Array<{ url: string; status: string; score: number; lastStatusCode?: number; lastError?: string }>;
    config?: { kind: string; serverTag?: string; serverCount?: number; proxy?: { url: string } };
    savedCreds?: { mode: string; subscriptionUrl?: string; serverTag?: string; serverCount?: number };
};

/* ── Helpers ──────────────────────────────────────────────────── */

function maskUrl(url: string): string {
    return url.replace(/:[^:@/]+@/, ":***@");
}

function maskSubscription(url: string): string {
    return url.replace(/^(\w+:\/\/[^/]+).*$/, "$1/…");
}

function isShareLink(input: string): boolean {
    return /^(vless|vmess|trojan|ss|hysteria2):\/\//i.test(input.trim());
}

/* ── Component ────────────────────────────────────────────────── */

export function VpnSetupCard({
    onToast,
    onVpnActiveChange,
}: {
    onToast: (msg: string) => void;
    onVpnActiveChange: (active: boolean) => void;
}) {
    const [status, setStatus] = useState<VpnStatus | null>(null);
    const [loading, setLoading] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<ProbeResult | null>(null);

    // VLESS / subscription
    const [subscriptionUrl, setSubscriptionUrl] = useState("");
    const [previewServers, setPreviewServers] = useState<PreviewServer[] | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [serverTag, setServerTag] = useState("auto");

    // Editing mode (when already active, user clicks "Modifica")
    const [editing, setEditing] = useState(false);

    async function refreshStatus() {
        try {
            const r = await fetch("/api/vpn/status");
            const vj = await r.json();
            if (vj.ok) {
                setStatus(vj);
                const active = vj.config?.kind === "vless";
                onVpnActiveChange(active);
            }
        } catch { /* ignore */ }
    }

    useEffect(() => { refreshStatus(); }, []);

    /* ── VLESS / subscription ── */

    async function fetchServers() {
        const url = subscriptionUrl.trim();
        if (!url) { onToast("Inserisci un URL subscription o uno share-link"); return; }

        // Share-link diretto: parsa localmente
        if (isShareLink(url)) {
            setPreviewServers(null);
            setServerTag("auto");
            onToast("Share-link diretto: verrà salvato come server singolo");
            return;
        }

        // Subscription URL: fetch server list
        if (!/^https?:\/\//i.test(url)) { onToast("L'URL deve iniziare con http:// o https://"); return; }
        setPreviewLoading(true);
        setPreviewServers(null);
        try {
            const r = await fetch("/api/vpn/preview", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ subscriptionUrl: url }),
            });
            const j = await r.json();
            if (!r.ok || !j.ok) { onToast(`❌ ${j.error || "Error"}`); return; }
            setPreviewServers(j.servers);
            setServerTag("auto");
            onToast(`${j.count} server trovati`);
        } catch (e: any) { onToast(`❌ ${e?.message || String(e)}`); }
        finally { setPreviewLoading(false); }
    }

    async function submitVless() {
        const url = subscriptionUrl.trim();
        if (!url) { onToast("Inserisci un URL subscription o uno share-link"); return; }

        setLoading(true);
        setTestResult(null);
        try {
            const body: Record<string, string> = { mode: "vless", serverTag };

            if (isShareLink(url)) {
                body.shareLink = url;
            } else {
                if (!/^https?:\/\//i.test(url)) { onToast("L'URL deve iniziare con http:// o https://"); return; }
                body.subscriptionUrl = url;
            }

            const r = await fetch("/api/vpn/setup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const j = await r.json();
            if (!r.ok || !j.ok) { onToast(`❌ ${j.error || "Error"}`); return; }
            onToast(`✅ ${j.message}`);
            await refreshStatus();

            // Auto-test dopo il save
            setTesting(true);
            try {
                const tr = await fetch("/api/vpn/test");
                const tj = await tr.json();
                if (tr.ok && tj.ok) {
                    setTestResult(tj.result);
                    if (tj.result.ok) {
                        onToast("Connessione funzionante");
                        onVpnActiveChange(true);
                    } else {
                        onToast("Config salvata ma il test non è passato");
                        onVpnActiveChange(false);
                    }
                }
            } catch { /* test fallito silenziosamente */ }
            finally { setTesting(false); }

            setEditing(false);
        } catch (e: any) { onToast(`❌ ${e?.message || String(e)}`); }
        finally { setLoading(false); }
    }

    /* ── Reset ── */

    async function clearAll() {
        if (!confirm("Rimuovere la configurazione VLESS corrente?")) return;
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
            setSubscriptionUrl(""); setPreviewServers(null); setTestResult(null); setEditing(false);
            onVpnActiveChange(false);
            await refreshStatus();
        } finally { setLoading(false); }
    }

    /* ── render ── */

    const isVlessActive = status?.config?.kind === "vless";

    return (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-800">
                    {isVlessActive && !editing ? "✅ VLESS — Connesso" : "🧩 VLESS — Configurazione"}
                </h3>
                {isVlessActive && !editing && (
                    <div className="flex gap-2">
                        <button
                            onClick={() => {
                                setEditing(true);
                                setTestResult(null);
                                if (status?.savedCreds?.subscriptionUrl) {
                                    setSubscriptionUrl(status.savedCreds.subscriptionUrl);
                                }
                            }}
                            className="rounded-lg border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                            ✏️ Modifica
                        </button>
                        <button onClick={clearAll} disabled={loading}
                            className="rounded-lg border border-red-200 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
                            🗑️ Reset
                        </button>
                    </div>
                )}
            </div>

            {isVlessActive && !editing ? (
                /* Stato attivo */
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800">
                    <p>
                        <span className="font-semibold">{status?.config?.serverTag || "auto"}</span>
                        {" · "}{status?.config?.serverCount || 0} server
                    </p>
                    {status?.savedCreds?.subscriptionUrl && (
                        <p className="mt-1 text-xs opacity-75 font-mono">{maskSubscription(status.savedCreds.subscriptionUrl)}</p>
                    )}
                </div>
            ) : (
                /* Form */
                <div className="space-y-2">
                    <p className="text-xs text-gray-500">
                        Incolla un URL subscription o uno share-link diretto
                        (VLESS, Hysteria2, VMess, Trojan, Shadowsocks).
                    </p>

                    <input
                        value={subscriptionUrl}
                        onChange={(e) => setSubscriptionUrl(e.target.value)}
                        placeholder="https://provider.com/sub?token=…  oppure  vless://…"
                        autoComplete="off" spellCheck={false}
                        className="w-full rounded-lg border border-gray-300 bg-white p-2 text-xs font-mono outline-none focus:border-emerald-500"
                    />

                    <div className="flex gap-2">
                        <button onClick={fetchServers} disabled={previewLoading || loading}
                            className="flex-1 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 inline-flex items-center justify-center gap-1">
                            {previewLoading ? <><Spinner /> Fetching...</> : "🔍 Fetch servers"}
                        </button>
                        {editing && (
                            <button onClick={() => { setEditing(false); setTestResult(null); }}
                                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50">
                                Annulla
                            </button>
                        )}
                    </div>

                    {previewServers && previewServers.length > 0 && (
                        <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
                            <select value={serverTag} onChange={(e) => setServerTag(e.target.value)}
                                className="w-full rounded-lg border border-gray-300 bg-white p-2 text-xs">
                                <option value="auto">⚡ Auto (failover automatico)</option>
                                {previewServers.map((s) => (
                                    <option key={s.tag} value={s.tag}>
                                        {s.tag} — {s.protocol} · {s.host}:{s.port}
                                    </option>
                                ))}
                            </select>
                            <div className="max-h-32 overflow-y-auto space-y-1">
                                {previewServers.map((s) => (
                                    <div key={s.tag} className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs">
                                        <span className="font-mono font-semibold text-emerald-700">{s.tag}</span>
                                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-500">{s.protocol}</span>
                                        <span className="ml-auto font-mono text-gray-500">{s.host}:{s.port}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <button onClick={submitVless} disabled={loading || testing}
                        className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center justify-center gap-1">
                        {loading ? <><Spinner /> Salvando...</>
                            : testing ? <><Spinner /> Testando...</>
                                : "💾 Save & connect"}
                    </button>
                </div>
            )}

            {/* Test result (auto) */}
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
    );
}
