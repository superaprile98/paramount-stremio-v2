"use client";

import { useState, useEffect } from "react";

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
    return url.replace(/^(\w+:\/\/[^/]+).*$/, "$1/\u2026");
}

function isShareLink(input: string): boolean {
    return /^(vless|vmess|trojan|ss|hysteria2):\/\//i.test(input.trim());
}

/** Label testuale pura per il delay: niente colore, solo testo grigio. */
function delayLabel(ms: number | null | undefined, via?: "tunnel" | "tcp"): string {
    const suffix = via === "tunnel" ? " via tunnel" : via === "tcp" ? " (TCP)" : "";
    if (ms == null) return "\u2014 ms" + suffix;
    return `${ms} ms${suffix}`;
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

    type SavedDelayTest = { at: string; avgDelayMs: number | null; okCount: number; totalCount: number; via: "tunnel" | "tcp"; samples: { host: string; delayMs: number }[] };
    type SavedServer = {
        id: string; label: string; kind: string; serverTag: string; addedAt: string;
        autoProvisioned?: boolean;
        lastDelayTest?: SavedDelayTest | null;
    };
    const [savedServers, setSavedServers] = useState<SavedServer[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [switchingId, setSwitchingId] = useState<string | null>(null);
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
            if (!r.ok || !j.ok) { onToast(`\u274c ${j.error || j.message || "Errore"}`); return; }
            if (j.skipped) { onToast("Sorgente gratuita gi\u00e0 presente"); return; }
            onToast(`Trovati ${j.entry.count} server ${j.entry.country} (qualit\u00e0 ${j.entry.quality}/10)`);
            await refreshSaved();
            await refreshFreeSource();
        } catch (e: any) { onToast(`\u274c ${e?.message || String(e)}`); }
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
            if (!r.ok || !j.ok) { onToast(`\u274c ${j.error || "Error"}`); return; }
            const ok = (j.results as any[]).filter((x) => x.delayMs !== null).length;
            const total = (j.results as any[]).length;
            const best = (j.results as any[]).find((x) => x.delayMs !== null);
            onToast(`${ok}/${total} server ok \u00b7 migliore ${best?.delayMs ?? '\u2014'} ms`);
            await refreshSaved();
        } catch (e: any) { onToast(`\u274c ${e?.message || String(e)}`); }
        finally { setDelayingId(null); }
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
            if (!r.ok || !j.ok) { onToast(`\u274c ${j.error || "Error"}`); return; }
            onToast(j.message);
            setActiveId(id);
            setEditing(false);
            onVpnActiveChange(true);
            if (serverTag) {
                setSavedServers((prev) => prev.map((x) => (x.id === id ? { ...x, serverTag } : x)));
            }
        } catch (e: any) { onToast(`\u274c ${e?.message || String(e)}`); }
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
            if (!r.ok || !j.ok) { onToast(`\u274c ${j.error || "Error"}`); return; }
            setSavedServers(j.servers ?? []);
            setActiveId(j.activeId ?? null);
            onToast("Server rimosso dalla lista");
        } catch (e: any) { onToast(`\u274c ${e?.message || String(e)}`); }
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
            if (!addRes.ok || !addJson.ok) { onToast(`\u274c ${addJson.error || "Error"}`); return false; }
            await refreshSaved();
            await switchServer(addJson.id);
            return true;
        } catch (e: any) { onToast(`\u274c ${e?.message || String(e)}`); return false; }
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
                if (!r.ok || !j.ok) { onToast(`\u274c ${j.error || "Error"}`); return; }
                setPreviewServers(j.servers);
                setServerTag("auto");
                onToast(`${j.count} server trovati`);
            } catch (e: any) { onToast(`\u274c ${e?.message || String(e)}`); }
            finally { setPreviewLoading(false); }
            return;
        }

        const url = subscriptionUrl.trim();
        if (!url) { onToast("Inserisci un URL subscription o uno share-link"); return; }

        if (isShareLink(url)) {
            setPreviewServers(null);
            setServerTag("auto");
            onToast("Share-link diretto: verr\u00e0 salvato come server singolo");
            return;
        }

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
            if (!r.ok || !j.ok) { onToast(`\u274c ${j.error || "Error"}`); return; }
            setPreviewServers(j.servers);
            setServerTag("auto");
            onToast(`${j.count} server trovati`);
        } catch (e: any) { onToast(`\u274c ${e?.message || String(e)}`); }
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
            const ok = await saveAndActivateCurrent();
            if (!ok) return;
            setSubscriptionUrl(""); setRawConfig(""); setPreviewServers(null);
            setEditing(false);
        } catch (e: any) { onToast(`\u274c ${e?.message || String(e)}`); }
        finally { setLoading(false); }
    }

    /* ── render ── */

    const isVlessActive = activeId !== null;
    const activeEntry = savedServers.find((s) => s.id === activeId) ?? null;

    return (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            {/* ── Header ── */}
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">VPN</h3>
                    {isVlessActive ? (
                        <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 mr-1.5" />
                            Connesso · {activeEntry?.label ?? "Tunnel"}
                        </p>
                    ) : (
                        <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">Nessun tunnel attivo</p>
                    )}
                </div>
                {!editing && (
                    <button
                        onClick={() => { setEditing(true); setTestResult(null); setPreviewServers(null); }}
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                    >
                        + Aggiungi server
                    </button>
                )}
            </div>

            {isVlessActive && !editing ? (
                /* Stato attivo */
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-300">
                    <p className="font-medium">{activeEntry?.label ?? "Tunnel"}</p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Il traffico del tuo addon esce dal tuo inbound sing-box dedicato.
                    </p>
                    {activeEntry?.serverTag && activeEntry.serverTag !== "auto" && (
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            Nodo: {activeEntry.serverTag}
                        </p>
                    )}
                </div>
            ) : (
                /* Form */
                <div className="space-y-3">
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        Collega la tua VPN: incolla un URL subscription, uno share-link
                        diretto oppure la config completa (Xray JSON).
                    </p>

                    {/* Toggle URL / Config */}
                    <div className="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-900">
                        <button
                            type="button"
                            onClick={() => { setInputMode("url"); setPreviewServers(null); }}
                            className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition ${inputMode === "url"
                                ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100"
                                : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"}`}
                        >
                            URL subscription
                        </button>
                        <button
                            type="button"
                            onClick={() => { setInputMode("config"); setPreviewServers(null); }}
                            className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition ${inputMode === "config"
                                ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100"
                                : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"}`}
                        >
                            Incolla config
                        </button>
                    </div>

                    {inputMode === "url" ? (
                        <input
                            value={subscriptionUrl}
                            onChange={(e) => setSubscriptionUrl(e.target.value)}
                            placeholder="https://provider.com/sub?token=\u2026  oppure  vless://\u2026"
                            autoComplete="off" spellCheck={false}
                            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-mono text-gray-900 outline-none focus:border-emerald-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500"
                        />
                    ) : (
                        <textarea
                            value={rawConfig}
                            onChange={(e) => setRawConfig(e.target.value)}
                            placeholder="Incolla qui la config completa (Xray/V2Ray JSON) o uno share-link\u2026"
                            rows={6}
                            autoComplete="off" spellCheck={false}
                            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-mono text-gray-900 outline-none focus:border-emerald-500 resize-y dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500"
                        />
                    )}

                    <div className="flex gap-2">
                        <button onClick={fetchServers} disabled={previewLoading || loading}
                            className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700">
                            {previewLoading ? "Caricamento..." : "Fetch servers"}
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
                                className="w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100">
                                <option value="auto">Auto (failover automatico)</option>
                                {previewServers.map((s) => (
                                    <option key={s.tag} value={s.tag}>
                                        {s.tag} \u2014 {s.protocol} \u00b7 {s.host}:{s.port}
                                    </option>
                                ))}
                            </select>
                            <div className="max-h-32 overflow-y-auto space-y-1">
                                {previewServers.map((s) => (
                                    <div key={s.tag} className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-800">
                                        <span className="font-mono font-medium text-gray-800 dark:text-gray-200">{s.tag}</span>
                                        <span className="text-[10px] uppercase text-gray-400 dark:text-gray-500">{s.protocol}</span>
                                        <span className="ml-auto font-mono text-gray-400 dark:text-gray-500">{s.host}:{s.port}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <button onClick={submitVless} disabled={loading || testing}
                        className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                        {loading ? "Salvando..." : testing ? "Testando..." : "Salva e connetti"}
                    </button>
                </div>
            )}

            {/* ── Lista server salvati (le entry auto-provisionate sono nascoste, mostrate solo nel contatore) ── */}
            {savedServers.filter((s) => !s.autoProvisioned).length + savedServers.filter((s) => !!s.autoProvisioned).length > 0 && (() => {
                const visibleServers = savedServers.filter((s) => !s.autoProvisioned);
                const freeCount = savedServers.filter((s) => !!s.autoProvisioned).length;
                return (
                    <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/60">
                        <p className="mb-2 text-xs font-semibold text-gray-700 dark:text-gray-200">
                            Server salvati ({visibleServers.length}){freeCount > 0 ? ` \u00b7 ${freeCount} gratuiti` : ""}
                        </p>
                        <div className="space-y-1 max-h-72 overflow-y-auto">
                            {visibleServers.map((s) => {
                                const delay = s.lastDelayTest;
                                const isActive = s.id === activeId;
                                const isExpanded = expandedId === s.id;
                                return (
                                    <div key={s.id}
                                        className={`rounded-lg border px-2 py-1.5 text-xs ${isActive
                                            ? "border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800"
                                            : "border-gray-200 bg-white hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700/60"
                                            }`}>
                                        {/* Riga 1: nome + kind + stato + ✕ Rimuovi (sulla destra, sempre visibile) */}
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => toggleExpand(s.id)}
                                                className="flex-1 text-left flex items-center gap-2 min-w-0"
                                                title={isExpanded ? "Chiudi" : "Mostra nodi e opzioni"}>
                                                <span className="text-gray-400 dark:text-gray-500">{isExpanded ? "\u25be" : "\u25b8"}</span>
                                                <span className="font-medium text-gray-900 dark:text-gray-100 truncate">
                                                    {s.label}
                                                </span>
                                                <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                                                    {s.kind}
                                                </span>
                                                {s.serverTag && s.serverTag !== "auto" && (
                                                    <span className="shrink-0 text-[10px] text-gray-500 dark:text-gray-400">
                                                        {s.serverTag}
                                                    </span>
                                                )}
                                                {isActive && (
                                                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-700 dark:text-gray-300 shrink-0">
                                                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                                        Attivo
                                                    </span>
                                                )}
                                            </button>
                                            <button onClick={() => deleteServer(s.id)} disabled={switchingId !== null}
                                                className="shrink-0 rounded-md p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-50 dark:text-gray-500 dark:hover:text-red-400 dark:hover:bg-red-900/30"
                                                title="Rimuovi dalla lista"
                                                aria-label="Rimuovi dalla lista">
                                                ✕
                                            </button>
                                        </div>

                                        {/* Pannello espandibile: azioni + nodi */}
                                        {isExpanded && (
                                            <div className="mt-2 space-y-2 rounded-md border border-gray-200 bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-900/60">
                                                {/* Azioni */}
                                                <div className="flex flex-wrap gap-2">
                                                    {!isActive ? (
                                                        <button
                                                            onClick={() => switchServer(s.id)}
                                                            disabled={switchingId !== null}
                                                            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                                                            title="Attiva questo tunnel">
                                                            {switchingId === s.id ? "..." : "Attiva"}
                                                        </button>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2.5 py-1 text-[10px] font-semibold text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                                                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                                            Attivo
                                                        </span>
                                                    )}

                                                    <button
                                                        onClick={() => delayTest(s.id)}
                                                        disabled={delayingId !== null}
                                                        className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-[10px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                                                        title="Test latenza (Clash API se attivo, TCP dial altrimenti)">
                                                        {delayingId === s.id ? "Test..." : "Delay test"}
                                                    </button>

                                                    <button onClick={() => deleteServer(s.id)} disabled={switchingId !== null}
                                                        className="rounded-md px-2 py-1 text-[10px] font-medium text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-50 dark:text-gray-500 dark:hover:text-red-400 dark:hover:bg-red-900/30"
                                                        title="Rimuovi dalla lista">
                                                        ✕ Rimuovi
                                                    </button>
                                                </div>

                                                {/* Metriche */}
                                                {delay && (
                                                    <div className="flex flex-wrap items-center gap-3 text-[10px] text-gray-500 dark:text-gray-400">
                                                        <span>{delayLabel(delay.avgDelayMs, delay.via)} <span className="text-gray-400 dark:text-gray-500">({delay.okCount}/{delay.totalCount} ok)</span></span>
                                                    </div>
                                                )}

                                                {/* Nodi */}
                                                {nodesLoadingId === s.id ? (
                                                    <p className="text-[10px] text-gray-500 dark:text-gray-400">Carico i nodi\u2026</p>
                                                ) : (nodesById[s.id]?.length ?? 0) === 0 ? (
                                                    <p className="text-[10px] text-gray-500 dark:text-gray-400">Nessun nodo disponibile (subscription irraggiungibile?)</p>
                                                ) : (
                                                    <>
                                                        <div className="space-y-1 max-h-40 overflow-y-auto">
                                                            {/* Opzione Auto */}
                                                            <label className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-[11px] cursor-pointer transition ${(s.serverTag || "auto") === "auto"
                                                                ? "border-gray-400 bg-white dark:border-gray-500 dark:bg-gray-800"
                                                                : "border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700/60"
                                                                }`}>
                                                                <input
                                                                    type="radio"
                                                                    name={`node-${s.id}`}
                                                                    value="auto"
                                                                    checked={(s.serverTag || "auto") === "auto"}
                                                                    onChange={() => switchServer(s.id, "auto")}
                                                                    className="accent-emerald-600"
                                                                />
                                                                <span className="font-medium text-gray-800 dark:text-gray-200">Auto</span>
                                                                <span className="text-gray-500 dark:text-gray-400">failover su tutti i nodi</span>
                                                                {delay && (
                                                                    <span className="ml-auto text-gray-400 dark:text-gray-500">
                                                                        {delayLabel(delay.avgDelayMs, delay.via)}
                                                                    </span>
                                                                )}
                                                            </label>
                                                            {nodesById[s.id].map((n) => {
                                                                const sample = delay?.samples.find((x) => x.host === n.tag);
                                                                const isSelected = s.serverTag === n.tag;
                                                                return (
                                                                    <label key={n.tag} className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-[11px] cursor-pointer transition ${isSelected
                                                                        ? "border-gray-400 bg-white dark:border-gray-500 dark:bg-gray-800"
                                                                        : "border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700/60"
                                                                        }`}>
                                                                        <input
                                                                            type="radio"
                                                                            name={`node-${s.id}`}
                                                                            value={n.tag}
                                                                            checked={isSelected}
                                                                            onChange={() => switchServer(s.id, n.tag)}
                                                                            className="accent-emerald-600"
                                                                        />
                                                                        <span className="font-mono font-medium text-gray-800 dark:text-gray-200 truncate">{n.tag}</span>
                                                                        <span className="text-gray-500 dark:text-gray-400">{n.host}:{n.port}</span>
                                                                        <span className="ml-auto text-gray-400 dark:text-gray-500">
                                                                            {delayLabel(sample ? sample.delayMs : null, delay?.via)}
                                                                        </span>
                                                                    </label>
                                                                );
                                                            })}
                                                        </div>
                                                        <p className="text-[10px] text-gray-400 dark:text-gray-500">
                                                            Seleziona un nodo per attivarlo subito, o &ldquo;Auto&rdquo; per il failover. Usa &ldquo;Delay test&rdquo; per aggiornare i valori. &ldquo;via tunnel&rdquo; = latenza reale via proxy; &ldquo;TCP&rdquo; = sola handshake.
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
                );
            })()}

            {/* Test result (auto) */}
            {testResult && (
                <div className={`mt-3 rounded-xl border p-3 text-sm ${testResult.ok ? "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-200"
                    : testResult.vpnDetected || testResult.geoBlocked ? "border-gray-200 bg-gray-50 text-gray-800 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-200"
                        : "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"}`}>
                    <div className="font-medium">
                        {testResult.ok ? "Connection OK"
                            : testResult.vpnDetected ? "VPN detected by Paramount+"
                                : testResult.geoBlocked ? "Geo-blocked (HTTP 451)"
                                    : "Connection failed"}
                    </div>
                    <div className="mt-1 text-xs space-x-1 text-gray-500 dark:text-gray-400">
                        {testResult.proxy && <span>Proxy: <code className="font-mono">{maskUrl(testResult.proxy)}</code></span>}
                        {testResult.statusCode !== undefined && <span>\u00b7 HTTP {testResult.statusCode}</span>}
                        {testResult.ip && <span>\u00b7 IP: <code className="font-mono">{testResult.ip}</code></span>}
                        {testResult.country && <span>\u00b7 {testResult.country}</span>}
                        {testResult.city && <span>\u00b7 {testResult.city}</span>}
                        <span>\u00b7 {testResult.elapsedMs}ms</span>
                    </div>
                    {testResult.error && <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{testResult.error}</div>}
                </div>
            )}
        </div>
    );
}
