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

    // Lista VLESS salvata per l'utente (per-utente, cifrata su disco)
    type SavedServer = { id: string; label: string; kind: string; serverTag: string; addedAt: string };
    const [savedServers, setSavedServers] = useState<SavedServer[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [switchingId, setSwitchingId] = useState<string | null>(null);

    async function refreshSaved() {
        try {
            const r = await fetch("/api/configure/vpn-servers");
            if (!r.ok) return;
            const j = await r.json();
            setSavedServers(j.servers ?? []);
            setActiveId(j.activeId ?? null);
            onVpnActiveChange(j.activeId != null);
        } catch { /* ignore */ }
    }

    async function switchServer(id: string) {
        setSwitchingId(id);
        try {
            const r = await fetch("/api/configure/vpn-switch", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id }),
            });
            const j = await r.json();
            if (!r.ok || !j.ok) { onToast(`❌ ${j.error || "Error"}`); return; }
            onToast(`✅ ${j.message}`);
            setActiveId(id);
            setEditing(false);
            onVpnActiveChange(true);
        } catch (e: any) { onToast(`❌ ${e?.message || String(e)}`); }
        finally { setSwitchingId(null); }
    }

    async function deleteServer(id: string) {
        if (!confirm("Rimuovere questo server dalla lista salvata?")) return;
        try {
            const r = await fetch(`/api/configure/vpn-servers?id=${encodeURIComponent(id)}`, { method: "DELETE" });
            const j = await r.json();
            if (!r.ok || !j.ok) { onToast(`❌ ${j.error || "Error"}`); return; }
            setSavedServers(j.servers ?? []);
            setActiveId(j.activeId ?? null);
            onToast("Server rimosso dalla lista");
        } catch (e: any) { onToast(`❌ ${e?.message || String(e)}`); }
    }

    /** Salva l'input corrente nella lista per-utente e lo attiva (config multi-tenant). */
    async function saveAndActivateCurrent(): Promise<boolean> {
        const url = subscriptionUrl.trim();
        const cfg = rawConfig.trim();
        const kind = inputMode === "config" ? (isShareLink(cfg) ? "shareLink" : "rawConfig") : (isShareLink(url) ? "shareLink" : "subscription");
        const input = inputMode === "config" ? cfg : url;
        if (!input) return false;
        try {
            const addRes = await fetch("/api/configure/vpn-servers", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ label: kind === "subscription" ? maskSubscription(input) : "VLESS", kind, input, serverTag }),
            });
            const addJson = await addRes.json();
            if (!addRes.ok || !addJson.ok) { onToast(`❌ ${addJson.error || "Error"}`); return false; }
            await refreshSaved();
            await switchServer(addJson.id);
            return true;
        } catch (e: any) { onToast(`❌ ${e?.message || String(e)}`); return false; }
    }

    // VLESS / subscription
    const [inputMode, setInputMode] = useState<"url" | "config">("url");
    const [subscriptionUrl, setSubscriptionUrl] = useState("");
    const [rawConfig, setRawConfig] = useState("");
    const [previewServers, setPreviewServers] = useState<PreviewServer[] | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [serverTag, setServerTag] = useState("auto");

    // Editing mode (when already active, user clicks "Modifica")
    const [editing, setEditing] = useState(false);

    async function refreshStatus() {
        // Solo diagnostica: lo stato "attivo" della card è per-utente
        // (activeId), NON la config globale legacy.
        try {
            const r = await fetch("/api/vpn/status");
            const vj = await r.json();
            if (vj.ok) setStatus(vj);
        } catch { /* ignore */ }
    }

    useEffect(() => { refreshStatus(); refreshSaved(); }, []);

    /* ── VLESS / subscription ── */

    async function fetchServers() {
        if (inputMode === "config") {
            const cfg = rawConfig.trim();
            if (!cfg) { onToast("Incolla la config (Xray JSON o share-link)"); return; }
            setPreviewLoading(true);
            setPreviewServers(null);
            try {
                const r = await fetch("/api/vpn/preview", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ rawConfig: cfg }),
                });
                const j = await r.json();
                if (!r.ok || !j.ok) { onToast(`❌ ${j.error || "Error"}`); return; }
                setPreviewServers(j.servers);
                setServerTag("auto");
                onToast(`${j.count} server trovati`);
            } catch (e: any) { onToast(`❌ ${e?.message || String(e)}`); }
            finally { setPreviewLoading(false); }
            return;
        }

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
        const cfg = rawConfig.trim();

        if (inputMode === "config") {
            if (!cfg) { onToast("Incolla la config (Xray JSON o share-link)"); return; }
        } else if (!url) {
            onToast("Inserisci un URL subscription o uno share-link");
            return;
        } else if (!isShareLink(url) && !/^https?:\/\//i.test(url)) {
            onToast("L'URL deve iniziare con http:// o https://");
            return;
        }

        setLoading(true);
        setTestResult(null);
        try {
            // Flusso per-utente: salva nella lista privata e attiva il tunnel
            // dedicato (rigenera la config sing-box multi-tenant). NON usa più
            // /api/vpn/setup che riscriverebbe la config con quella singola.
            const ok = await saveAndActivateCurrent();
            if (!ok) return;
            setSubscriptionUrl(""); setRawConfig(""); setPreviewServers(null);
            setEditing(false);
        } catch (e: any) { onToast(`❌ ${e?.message || String(e)}`); }
        finally { setLoading(false); }
    }

    /* ── Reset (solo per-utente: rimuove la voce attiva) ── */

    async function clearAll() {
        if (!activeId) return;
        if (!confirm("Disattivare e rimuovere il server attivo dalla tua lista?")) return;
        await deleteServer(activeId);
        setSubscriptionUrl(""); setRawConfig(""); setPreviewServers(null); setTestResult(null); setEditing(false);
        onVpnActiveChange(false);
    }

    /* ── render ── */

    // Stato per-utente: attivo se l'utente ha una voce attiva nella SUA lista
    const isVlessActive = activeId !== null;
    const activeEntry = savedServers.find((s) => s.id === activeId) ?? null;

    return (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-800">
                    {isVlessActive ? "✅ VLESS — Connesso (tunnel tuo)" : "🧩 VLESS — Nessun tunnel attivo"}
                </h3>
                {!editing && (
                    <div className="flex gap-2">
                        <button
                            onClick={() => {
                                setEditing(true);
                                setTestResult(null);
                                setPreviewServers(null);
                            }}
                            className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                        >
                            ➕ Aggiungi VLESS
                        </button>
                        {isVlessActive && (
                            <button onClick={clearAll} disabled={loading}
                                className="rounded-lg border border-red-200 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
                                🗑️ Disattiva
                            </button>
                        )}
                    </div>
                )}
            </div>

            {isVlessActive && !editing ? (
                /* Stato attivo (per-utente) */
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800">
                    <p>
                        <span className="font-semibold">{activeEntry?.label ?? "Tunnel"}</span>
                        {" · "}{activeEntry?.serverTag ?? "auto"}
                    </p>
                    <p className="mt-1 text-xs opacity-75">
                        Il traffico del tuo addon esce dal tuo inbound sing-box dedicato.
                    </p>
                </div>
            ) : (
                /* Form */
                <div className="space-y-2">
                    <p className="text-xs text-gray-500">
                        Collega la tua VPN: incolla un URL subscription, uno share-link
                        diretto oppure la config completa (Xray JSON).
                    </p>

                    {/* Toggle URL / Config */}
                    <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
                        <button
                            type="button"
                            onClick={() => { setInputMode("url"); setPreviewServers(null); }}
                            className={`flex-1 rounded-md px-2 py-1 text-xs font-semibold transition ${inputMode === "url"
                                ? "bg-white text-gray-900 shadow-sm"
                                : "text-gray-500 hover:text-gray-700"}`}
                        >
                            🔗 URL subscription
                        </button>
                        <button
                            type="button"
                            onClick={() => { setInputMode("config"); setPreviewServers(null); }}
                            className={`flex-1 rounded-md px-2 py-1 text-xs font-semibold transition ${inputMode === "config"
                                ? "bg-white text-gray-900 shadow-sm"
                                : "text-gray-500 hover:text-gray-700"}`}
                        >
                            📋 Incolla config
                        </button>
                    </div>

                    {inputMode === "url" ? (
                        <input
                            value={subscriptionUrl}
                            onChange={(e) => setSubscriptionUrl(e.target.value)}
                            placeholder="https://provider.com/sub?token=…  oppure  vless://…"
                            autoComplete="off" spellCheck={false}
                            className="w-full rounded-lg border border-gray-300 bg-white p-2 text-xs font-mono text-gray-900 outline-none focus:border-emerald-500"
                        />
                    ) : (
                        <textarea
                            value={rawConfig}
                            onChange={(e) => setRawConfig(e.target.value)}
                            placeholder='Incolla qui la config completa (Xray/V2Ray JSON) o uno share-link…'
                            rows={6}
                            autoComplete="off" spellCheck={false}
                            className="w-full rounded-lg border border-gray-300 bg-white p-2 text-xs font-mono text-gray-900 outline-none focus:border-emerald-500 resize-y"
                        />
                    )}

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
                                className="w-full rounded-lg border border-gray-300 bg-white p-2 text-xs text-gray-900">
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

            {/* Lista VLESS salvata (per-utente) */}
            {savedServers.length > 0 && (
                <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
                    <p className="text-xs font-semibold text-gray-700 mb-2">
                        💾 Server salvati ({savedServers.length}) — clicca per cambiare tunnel
                    </p>
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                        {savedServers.map((s) => (
                            <div key={s.id}
                                className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs ${s.id === activeId
                                    ? "border-emerald-400 bg-emerald-50"
                                    : "border-gray-200 bg-white hover:bg-gray-100"
                                    }`}>
                                <button
                                    onClick={() => switchServer(s.id)}
                                    disabled={switchingId !== null}
                                    className="flex-1 text-left disabled:opacity-50"
                                    title="Attiva questo tunnel">
                                    <span className="font-semibold text-gray-900">
                                        {switchingId === s.id ? "⏳ " : s.id === activeId ? "✅ " : ""}{s.label}
                                    </span>
                                    <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-500">
                                        {s.kind}
                                    </span>
                                </button>
                                <button onClick={() => deleteServer(s.id)} disabled={switchingId !== null}
                                    className="rounded px-1.5 py-0.5 text-red-500 hover:bg-red-50 disabled:opacity-50"
                                    title="Rimuovi dalla lista">
                                    🗑️
                                </button>
                            </div>
                        ))}
                    </div>
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
