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

type NodeInfo = {
    tag: string;
    host: string;
    port: number;
    protocol: string;
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
    type SavedSpeedTest = { at: string; downMbps: number; upMbps: number; latencyMs: number; grade: string; error?: string };
    type SavedDelayTest = { at: string; avgDelayMs: number | null; okCount: number; totalCount: number; samples: { host: string; delayMs: number }[] };
    type SavedServer = {
        id: string; label: string; kind: string; serverTag: string; addedAt: string;
        lastSpeedTest?: SavedSpeedTest | null;
        lastDelayTest?: SavedDelayTest | null;
    };
    const [savedServers, setSavedServers] = useState<SavedServer[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [switchingId, setSwitchingId] = useState<string | null>(null);
    const [testingId, setTestingId] = useState<string | null>(null);
    const [delayingId, setDelayingId] = useState<string | null>(null);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [nodesById, setNodesById] = useState<Record<string, NodeInfo[]>>({});
    const [nodesLoadingId, setNodesLoadingId] = useState<string | null>(null);
    const [freeSourceInfo, setFreeSourceInfo] = useState<{ hasAutoProvisioned: boolean; lastFetched: string | null; count: number | null; label: string | null } | null>(null);
    const [freeSourceLoading, setFreeSourceLoading] = useState(false);

    async function refreshFreeSource() {
        try {
            const r = await fetch("/api/configure/free-sources");
            if (!r.ok) return;
            const j = await r.json();
            setFreeSourceInfo(j);
        } catch { /* ignore */ }
    }

    async function loadFreeSource(force = false) {
        setFreeSourceLoading(true);
        try {
            const r = await fetch("/api/configure/free-sources", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ country: "US", force }),
            });
            const j = await r.json();
            if (!r.ok || !j.ok) { onToast(`❌ ${j.error || j.message || "Errore"}`); return; }
            if (j.skipped) { onToast("Sorgente gratuita già presente"); return; }
            onToast(`✅ Trovati ${j.entry.count} server ${j.entry.country} (qualità ${j.entry.quality}/10)`);
            await refreshSaved();
            await refreshFreeSource();
        } catch (e: any) { onToast(`❌ ${e?.message || String(e)}`); }
        finally { setFreeSourceLoading(false); }
    }

    async function delayTest(id: string) {
        setDelayingId(id);
        try {
            const r = await fetch("/api/configure/vpn-delaytest", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ serverId: id, timeoutMs: 2000 }),
            });
            const j = await r.json();
            if (!r.ok || !j.ok) { onToast(`❌ ${j.error || "Error"}`); return; }
            const ok = (j.results as any[]).filter((x) => x.delayMs !== null).length;
            const total = (j.results as any[]).length;
            const best = (j.results as any[]).find((x) => x.delayMs !== null);
            onToast(`🏓 ${ok}/${total} server ok · migliore ${best?.delayMs ?? '—'} ms`);
            await refreshSaved();
        } catch (e: any) { onToast(`❌ ${e?.message || String(e)}`); }
        finally { setDelayingId(null); }
    }

    async function speedTest(id: string) {
        setTestingId(id);
        try {
            const r = await fetch("/api/configure/vpn-speedtest", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id }),
            });
            const j = await r.json();
            if (!r.ok || !j.ok) { onToast(`❌ ${j.error || "Error"}`); return; }
            const t = j.result;
            onToast(`⚡ Down ${t.downMbps} Mbps · Up ${t.upMbps} Mbps · ${t.latencyMs} ms`);
            await refreshSaved();
        } catch (e: any) { onToast(`❌ ${e?.message || String(e)}`); }
        finally { setTestingId(null); }
    }

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

    async function switchServer(id: string, serverTag?: string) {
        setSwitchingId(id);
        try {
            const r = await fetch("/api/configure/vpn-switch", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(serverTag ? { id, serverTag } : { id }),
            });
            const j = await r.json();
            if (!r.ok || !j.ok) { onToast(`❌ ${j.error || "Error"}`); return; }
            onToast(`✅ ${j.message}`);
            setActiveId(id);
            setEditing(false);
            onVpnActiveChange(true);
            // aggiorna il tag scelto sulla voce locale
            if (serverTag) {
                setSavedServers((prev) => prev.map((x) => (x.id === id ? { ...x, serverTag } : x)));
            }
        } catch (e: any) { onToast(`❌ ${e?.message || String(e)}`); }
        finally { setSwitchingId(null); }
    }

    /* ── Nodi di una voce salvata (pannello espandibile) ── */

    async function toggleExpand(id: string) {
        if (expandedId === id) { setExpandedId(null); return; }
        setExpandedId(id);
        if (!nodesById[id]) {
            setNodesLoadingId(id);
            try {
                const r = await fetch(`/api/configure/vpn-servers?id=${encodeURIComponent(id)}`);
                const j = await r.json();
                if (r.ok && j.ok) setNodesById((prev) => ({ ...prev, [id]: j.nodes ?? [] }));
            } catch { /* ignore */ }
            finally { setNodesLoadingId(null); }
        }
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

    useEffect(() => { refreshStatus(); refreshSaved(); refreshFreeSource(); }, []);

    // Auto-provisiona la sorgente gratuita se l'utente non ha ancora nessun server.
    useEffect(() => {
        if (savedServers.length === 0 && !freeSourceInfo?.hasAutoProvisioned && !freeSourceLoading) {
            loadFreeSource(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [savedServers.length, freeSourceInfo?.hasAutoProvisioned]);

    /* ── Colori per i grade (chip colorati per velocità) ── */

    function gradeColor(grade: string): { bg: string; text: string; label: string } {
        const g = grade.toLowerCase();
        if (g.startsWith("ottima") || g.includes("🏆")) return { bg: "bg-emerald-100 dark:bg-emerald-900/40", text: "text-emerald-700 dark:text-emerald-300", label: "🏆 Velocità ottima" };
        if (g.startsWith("buona") || g.includes("✅")) return { bg: "bg-green-100 dark:bg-green-900/40", text: "text-green-700 dark:text-green-300", label: "✅ Velocità buona" };
        if (g.startsWith("discreta") || g.includes("⚠️")) return { bg: "bg-amber-100 dark:bg-amber-900/40", text: "text-amber-700 dark:text-amber-300", label: "⚠️ Velocità discreta" };
        return { bg: "bg-red-100 dark:bg-red-900/40", text: "text-red-700 dark:text-red-300", label: "❌ Velocità scarsa" };
    }

    function delayColor(ms: number | null | undefined): { bg: string; text: string; label: string } {
        if (ms == null) return { bg: "bg-gray-100 dark:bg-gray-800", text: "text-gray-500 dark:text-gray-400", label: "— ms" };
        if (ms <= 150) return { bg: "bg-emerald-100 dark:bg-emerald-900/40", text: "text-emerald-700 dark:text-emerald-300", label: `🟢 ${ms} ms` };
        if (ms <= 300) return { bg: "bg-amber-100 dark:bg-amber-900/40", text: "text-amber-700 dark:text-amber-300", label: `🟡 ${ms} ms` };
        if (ms <= 600) return { bg: "bg-orange-100 dark:bg-orange-900/40", text: "text-orange-700 dark:text-orange-300", label: `🟠 ${ms} ms` };
        return { bg: "bg-red-100 dark:bg-red-900/40", text: "text-red-700 dark:text-red-300", label: `🔴 ${ms} ms` };
    }

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
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
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
                            className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 dark:hover:bg-emerald-900/50"
                        >
                            ➕ Aggiungi VLESS
                        </button>
                        {isVlessActive && (
                            <button onClick={clearAll} disabled={loading}
                                className="rounded-lg border border-red-200 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-red-400 dark:hover:bg-red-900/30 dark:hover:text-red-300">
                                🗑️ Disattiva
                            </button>
                        )}
                    </div>
                )}
            </div>

            {isVlessActive && !editing ? (
                /* Stato attivo (per-utente) */
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200">
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
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        Collega la tua VPN: incolla un URL subscription, uno share-link
                        diretto oppure la config completa (Xray JSON).
                    </p>

                    {/* Toggle URL / Config */}
                    <div className="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-900">
                        <button
                            type="button"
                            onClick={() => { setInputMode("url"); setPreviewServers(null); }}
                            className={`flex-1 rounded-md px-2 py-1 text-xs font-semibold transition ${inputMode === "url"
                                ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100"
                                : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"}`}
                        >
                            🔗 URL subscription
                        </button>
                        <button
                            type="button"
                            onClick={() => { setInputMode("config"); setPreviewServers(null); }}
                            className={`flex-1 rounded-md px-2 py-1 text-xs font-semibold transition ${inputMode === "config"
                                ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100"
                                : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"}`}
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
                            className="w-full rounded-lg border border-gray-300 bg-white p-2 text-xs font-mono text-gray-900 outline-none focus:border-emerald-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500"
                        />
                    ) : (
                        <textarea
                            value={rawConfig}
                            onChange={(e) => setRawConfig(e.target.value)}
                            placeholder='Incolla qui la config completa (Xray/V2Ray JSON) o uno share-link…'
                            rows={6}
                            autoComplete="off" spellCheck={false}
                            className="w-full rounded-lg border border-gray-300 bg-white p-2 text-xs font-mono text-gray-900 outline-none focus:border-emerald-500 resize-y dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500"
                        />
                    )}

                    <div className="flex gap-2">
                        <button onClick={fetchServers} disabled={previewLoading || loading}
                            className="flex-1 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 inline-flex items-center justify-center gap-1">
                            {previewLoading ? <><Spinner /> Fetching...</> : "🔍 Fetch servers"}
                        </button>
                        {editing && (
                            <button onClick={() => { setEditing(false); setTestResult(null); }}
                                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700">
                                Annulla
                            </button>
                        )}
                    </div>

                    {previewServers && previewServers.length > 0 && (
                        <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-900">
                            <select value={serverTag} onChange={(e) => setServerTag(e.target.value)}
                                className="w-full rounded-lg border border-gray-300 bg-white p-2 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100">
                                <option value="auto">⚡ Auto (failover automatico)</option>
                                {previewServers.map((s) => (
                                    <option key={s.tag} value={s.tag}>
                                        {s.tag} — {s.protocol} · {s.host}:{s.port}
                                    </option>
                                ))}
                            </select>
                            <div className="max-h-32 overflow-y-auto space-y-1">
                                {previewServers.map((s) => (
                                    <div key={s.tag} className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-800">
                                        <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">{s.tag}</span>
                                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-500 dark:bg-gray-700 dark:text-gray-400">{s.protocol}</span>
                                        <span className="ml-auto font-mono text-gray-500 dark:text-gray-400">{s.host}:{s.port}</span>
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
                <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/60">
                    <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                            💾 Server salvati ({savedServers.length})
                        </p>
                        <button
                            onClick={() => loadFreeSource(true)}
                            disabled={freeSourceLoading}
                            className="rounded-md border border-sky-300 bg-sky-50 px-2 py-1 text-[10px] font-semibold text-sky-700 hover:bg-sky-100 disabled:opacity-50 inline-flex items-center gap-1 dark:border-sky-700 dark:bg-sky-900/30 dark:text-sky-300 dark:hover:bg-sky-900/50"
                            title="Aggiorna la lista dalla sorgente gratuita">
                            {freeSourceLoading ? <><Spinner /> Aggiorno...</> : "🔄 Aggiorna sorgente gratuita"}
                        </button>
                    </div>
                    <div className="space-y-1 max-h-72 overflow-y-auto">
                        {savedServers.map((s) => {
                            const grade = s.lastSpeedTest ? gradeColor(s.lastSpeedTest.grade) : null;
                            const delay = s.lastDelayTest ? delayColor(s.lastDelayTest.avgDelayMs) : null;
                            return (
                                <div key={s.id}
                                    className={`rounded-lg border px-2 py-1.5 text-xs ${s.id === activeId
                                        ? "border-emerald-400 bg-emerald-50 dark:border-emerald-600 dark:bg-emerald-900/20"
                                        : "border-gray-200 bg-white hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700/60"
                                        }`}>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => toggleExpand(s.id)}
                                            className="flex-1 text-left"
                                            title="Mostra nodi e opzioni">
                                            <span className="font-semibold text-gray-900 dark:text-gray-100">
                                                {expandedId === s.id ? "▾ " : "▸ "}{s.id === activeId ? "✅ " : ""}{s.label}
                                            </span>
                                            <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                                                {s.kind}
                                            </span>
                                            {s.serverTag && s.serverTag !== "auto" && (
                                                <span className="ml-1 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                                                    nodo: {s.serverTag}
                                                </span>
                                            )}
                                        </button>
                                        <button
                                            onClick={() => switchServer(s.id)}
                                            disabled={switchingId !== null || s.id === activeId}
                                            className="rounded px-1.5 py-0.5 text-emerald-600 hover:bg-emerald-50 disabled:opacity-30 dark:text-emerald-400 dark:hover:bg-emerald-900/30"
                                            title={s.id === activeId ? "Già attivo" : "Attiva questo tunnel"}>
                                            ⏏
                                        </button>
                                        <button
                                            onClick={() => speedTest(s.id)}
                                            disabled={testingId !== null || s.id !== activeId}
                                            className={`rounded px-1.5 py-0.5 ${grade ? grade.bg : "hover:bg-blue-50 dark:hover:bg-blue-900/30"} ${grade ? grade.text : ""} disabled:opacity-30`}
                                            title={s.id === activeId ? "Test velocità (lento, banda)" : "Attiva prima il server per testarlo"}>
                                            {testingId === s.id ? "⏳" : grade?.label ?? "⚡ Test"}
                                        </button>
                                        <button
                                            onClick={() => delayTest(s.id)}
                                            disabled={delayingId !== null}
                                            className={`rounded px-1.5 py-0.5 ${delay ? delay.bg : "hover:bg-amber-50 dark:hover:bg-amber-900/30"} ${delay ? delay.text : ""} disabled:opacity-30`}
                                            title="Test rapido latenza (Clash API)">
                                            {delayingId === s.id ? "⏳" : delay?.label ?? "🏓 Delay"}
                                        </button>
                                        <button onClick={() => deleteServer(s.id)} disabled={switchingId !== null}
                                            className="rounded px-1.5 py-0.5 text-red-500 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-900/30"
                                            title="Rimuovi dalla lista">
                                            🗑️
                                        </button>
                                    </div>
                                    {(grade || delay) && (
                                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px]">
                                            {grade && (
                                                <span className={`rounded px-1.5 py-0.5 font-semibold ${grade.bg} ${grade.text}`}>
                                                    {grade.label} · ↓{s.lastSpeedTest!.downMbps} · ↑{s.lastSpeedTest!.upMbps} Mbps
                                                </span>
                                            )}
                                            {delay && s.lastDelayTest && (
                                                <span className={`rounded px-1.5 py-0.5 font-semibold ${delay.bg} ${delay.text}`}>
                                                    avg {s.lastDelayTest.avgDelayMs ?? "—"} ms · {s.lastDelayTest.okCount}/{s.lastDelayTest.totalCount} ok
                                                </span>
                                            )}
                                        </div>
                                    )}

                                    {/* Pannello espandibile: nodi + selettore auto/nodo */}
                                    {expandedId === s.id && (
                                        <div className="mt-2 space-y-2 rounded-md border border-gray-200 bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-900/60">
                                            {nodesLoadingId === s.id ? (
                                                <p className="text-[10px] text-gray-500 dark:text-gray-400">⏳ Carico i nodi…</p>
                                            ) : (nodesById[s.id]?.length ?? 0) === 0 ? (
                                                <p className="text-[10px] text-gray-500 dark:text-gray-400">Nessun nodo disponibile (subscription irraggiungibile?)</p>
                                            ) : (
                                                <>
                                                    <select
                                                        value={s.serverTag || "auto"}
                                                        onChange={(e) => switchServer(s.id, e.target.value)}
                                                        disabled={switchingId !== null}
                                                        className="w-full rounded-md border border-gray-300 bg-white p-1.5 text-[11px] text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                                                        title="Scegli auto (failover) o un nodo specifico">
                                                        <option value="auto">⚡ Auto (failover su tutti i nodi)</option>
                                                        {nodesById[s.id].map((n) => {
                                                            const sample = s.lastDelayTest?.samples.find((x) => x.host === n.tag);
                                                            return (
                                                                <option key={n.tag} value={n.tag}>
                                                                    {n.tag} — {n.protocol} · {n.host}:{n.port}{sample ? ` · ${sample.delayMs} ms` : ""}
                                                                </option>
                                                            );
                                                        })}
                                                    </select>
                                                    <div className="max-h-28 space-y-1 overflow-y-auto">
                                                        {nodesById[s.id].map((n) => {
                                                            const sample = s.lastDelayTest?.samples.find((x) => x.host === n.tag);
                                                            const dc = delayColor(sample ? sample.delayMs : null);
                                                            return (
                                                                <div key={n.tag} className="flex items-center gap-2 rounded border border-gray-200 bg-white px-1.5 py-1 text-[10px] dark:border-gray-700 dark:bg-gray-800">
                                                                    <span className="font-mono font-semibold text-gray-800 dark:text-gray-200 truncate">{n.tag}</span>
                                                                    <span className="ml-auto font-mono text-gray-500 dark:text-gray-400">{n.host}:{n.port}</span>
                                                                    <span className={`rounded px-1 py-0.5 font-semibold ${dc.bg} ${dc.text}`}>{dc.label}</span>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                    <p className="text-[10px] text-gray-400 dark:text-gray-500">
                                                        Scegli un nodo dal menu per attivarlo subito (o "auto" per il failover). Il delay dei nodi è aggiornato col bottone 🏑 Delay.
                                                    </p>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Test result (auto) */}
            {testResult && (
                <div className={`mt-3 rounded-xl border p-3 text-sm ${testResult.ok ? "border-green-200 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300"
                    : testResult.vpnDetected || testResult.geoBlocked ? "border-orange-200 bg-orange-50 text-orange-900 dark:border-orange-800 dark:bg-orange-900/20 dark:text-orange-300"
                        : "border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"}`}>
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
