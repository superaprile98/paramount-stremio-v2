"use client";

import { useState, useEffect } from "react";

/* ── Icone SVG inline (stessa famiglia, stroke 1.5, 16×16) ───── */

function IconPlus() {
    return (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    );
}
function IconTrash() {
    return (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
    );
}
function IconCheck() {
    return (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
        </svg>
    );
}
function IconPing() {
    return (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
        </svg>
    );
}
function IconSpeed() {
    return (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
    );
}
function IconChevronDown() {
    return (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
        </svg>
    );
}
function IconChevronRight() {
    return (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
        </svg>
    );
}
function IconRefresh() {
    return (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
    );
}
function IconShield() {
    return (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
    );
}

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
    return url.replace(/^(\w+:\/\/[^/]+).*$/, "$1/\u2026");
}

function isShareLink(input: string): boolean {
    return /^(vless|vmess|trojan|ss|hysteria2):\/\//i.test(input.trim());
}

/** Colore per il chip delay: ms + label TCP/TUN. */
function delayChip(ms: number | null | undefined, via?: "tunnel" | "tcp"): { bg: string; text: string; label: string } {
    const suffix = via === "tunnel" ? " via tunnel" : via === "tcp" ? " TCP" : "";
    if (ms == null) return { bg: "bg-gray-100 dark:bg-gray-800", text: "text-gray-400 dark:text-gray-500", label: "\u2014 ms" + suffix };
    if (ms <= 150) return { bg: "bg-emerald-100 dark:bg-emerald-900/40", text: "text-emerald-700 dark:text-emerald-300", label: `${ms} ms${suffix}` };
    if (ms <= 300) return { bg: "bg-amber-100 dark:bg-amber-900/40", text: "text-amber-700 dark:text-amber-300", label: `${ms} ms${suffix}` };
    if (ms <= 600) return { bg: "bg-orange-100 dark:bg-orange-900/40", text: "text-orange-700 dark:text-orange-300", label: `${ms} ms${suffix}` };
    return { bg: "bg-red-100 dark:bg-red-900/40", text: "text-red-700 dark:text-red-300", label: `${ms} ms${suffix}` };
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

    type SavedSpeedTest = { at: string; downMbps: number; upMbps: number; latencyMs: number; grade: string; error?: string };
    type SavedDelayTest = { at: string; avgDelayMs: number | null; okCount: number; totalCount: number; via: "tunnel" | "tcp"; samples: { host: string; delayMs: number }[] };
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

    async function speedTest(id: string) {
        setTestingId(id);
        try {
            const r = await fetch("/api/configure/vpn-speedtest", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id }),
            });
            const j = await r.json();
            if (!r.ok || !j.ok) { onToast(`\u274c ${j.error || "Error"}`); return; }
            const t = j.result;
            onToast(`Down ${t.downMbps} Mbps \u00b7 Up ${t.upMbps} Mbps \u00b7 ${t.latencyMs} ms`);
            await refreshSaved();
        } catch (e: any) { onToast(`\u274c ${e?.message || String(e)}`); }
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

    /* ── Reset (solo per-utente: rimuove la voce attiva) ── */

    async function clearAll() {
        if (!activeId) return;
        if (!confirm("Disattivare e rimuovere il server attivo dalla tua lista?")) return;
        await deleteServer(activeId);
        setSubscriptionUrl(""); setRawConfig(""); setPreviewServers(null); setTestResult(null); setEditing(false);
        onVpnActiveChange(false);
    }

    /* ── render ── */

    const isVlessActive = activeId !== null;
    const activeEntry = savedServers.find((s) => s.id === activeId) ?? null;

    return (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            {/* ── Header ── */}
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-1.5">
                    <IconShield />
                    {isVlessActive ? "Connesso (tunnel tuo)" : "Nessun tunnel attivo"}
                </h3>
                {!editing && (
                    <div className="flex gap-2">
                        <button
                            onClick={() => { setEditing(true); setTestResult(null); setPreviewServers(null); }}
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 dark:hover:bg-emerald-900/50"
                        >
                            <IconPlus />
                            Aggiungi server
                        </button>
                        {isVlessActive && (
                            <button onClick={clearAll} disabled={loading}
                                className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-red-400 dark:hover:bg-red-900/30 dark:hover:text-red-300">
                                <IconTrash />
                                Disattiva
                            </button>
                        )}
                    </div>
                )}
            </div>

            {isVlessActive && !editing ? (
                /* Stato attivo */
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200">
                    <p>
                        <span className="font-semibold">{activeEntry?.label ?? "Tunnel"}</span>
                        {" \u00b7 "}{activeEntry?.serverTag ?? "auto"}
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
                            URL subscription
                        </button>
                        <button
                            type="button"
                            onClick={() => { setInputMode("config"); setPreviewServers(null); }}
                            className={`flex-1 rounded-md px-2 py-1 text-xs font-semibold transition ${inputMode === "config"
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
                            className="w-full rounded-lg border border-gray-300 bg-white p-2 text-xs font-mono text-gray-900 outline-none focus:border-emerald-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500"
                        />
                    ) : (
                        <textarea
                            value={rawConfig}
                            onChange={(e) => setRawConfig(e.target.value)}
                            placeholder="Incolla qui la config completa (Xray/V2Ray JSON) o uno share-link\u2026"
                            rows={6}
                            autoComplete="off" spellCheck={false}
                            className="w-full rounded-lg border border-gray-300 bg-white p-2 text-xs font-mono text-gray-900 outline-none focus:border-emerald-500 resize-y dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500"
                        />
                    )}

                    <div className="flex gap-2">
                        <button onClick={fetchServers} disabled={previewLoading || loading}
                            className="flex-1 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 inline-flex items-center justify-center gap-1">
                            {previewLoading ? <><Spinner /> Caricamento...</> : "Fetch servers"}
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
                                : "Salva e connetti"}
                    </button>
                </div>
            )}

            {/* ── Lista server salvati ── */}
            {savedServers.length > 0 && (
                <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/60">
                    <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                            Server salvati ({savedServers.length})
                        </p>
                        <button
                            onClick={() => loadFreeSource(true)}
                            disabled={freeSourceLoading}
                            className="inline-flex items-center gap-1 rounded-md border border-sky-300 bg-sky-50 px-2 py-1 text-[10px] font-semibold text-sky-700 hover:bg-sky-100 disabled:opacity-50 dark:border-sky-700 dark:bg-sky-900/30 dark:text-sky-300 dark:hover:bg-sky-900/50"
                            title="Aggiorna la lista dalla sorgente gratuita">
                            {freeSourceLoading ? <><Spinner /> Aggiorno...</> : <><IconRefresh /> Sorgente gratuita</>}
                        </button>
                    </div>
                    <div className="space-y-1 max-h-72 overflow-y-auto">
                        {savedServers.map((s) => {
                            const delay = s.lastDelayTest ? delayChip(s.lastDelayTest.avgDelayMs, s.lastDelayTest.via) : null;
                            const speed = s.lastSpeedTest;
                            return (
                                <div key={s.id}
                                    className={`rounded-lg border px-2 py-1.5 text-xs ${s.id === activeId
                                        ? "border-emerald-400 bg-emerald-50 dark:border-emerald-600 dark:bg-emerald-900/20"
                                        : "border-gray-200 bg-white hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700/60"
                                        }`}>
                                    {/* Riga 1: nome + kind + stato + azioni */}
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => toggleExpand(s.id)}
                                            className="flex-1 text-left flex items-center gap-1.5 min-w-0"
                                            title="Mostra nodi e opzioni">
                                            {expandedId === s.id ? <IconChevronDown /> : <IconChevronRight />}
                                            <span className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                                                {s.label}
                                            </span>
                                            <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                                                {s.kind}
                                            </span>
                                            {s.serverTag && s.serverTag !== "auto" && (
                                                <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                                                    {s.serverTag}
                                                </span>
                                            )}
                                        </button>

                                        {/* Bottone Attiva / Attivo */}
                                        {s.id === activeId ? (
                                            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-1 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 shrink-0">
                                                <IconCheck />
                                                Attivo
                                            </span>
                                        ) : (
                                            <button
                                                onClick={() => switchServer(s.id)}
                                                disabled={switchingId !== null}
                                                className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-white px-2 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 dark:border-emerald-700 dark:bg-gray-800 dark:text-emerald-300 dark:hover:bg-emerald-900/30 shrink-0"
                                                title="Attiva questo tunnel">
                                                {switchingId === s.id ? <Spinner /> : null}
                                                Attiva
                                            </button>
                                        )}

                                        {/* Delay test */}
                                        <button
                                            onClick={() => delayTest(s.id)}
                                            disabled={delayingId !== null}
                                            className={`inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium ${delay ? delay.bg + " " + delay.text : "text-gray-500 hover:bg-amber-50 dark:hover:bg-amber-900/30 dark:text-gray-400"} disabled:opacity-40 shrink-0`}
                                            title="Test latenza (Clash API se attivo, TCP dial altrimenti)">
                                            {delayingId === s.id ? <Spinner /> : <IconPing />}
                                            {delay ? delay.label : "Delay"}
                                        </button>

                                        {/* Speed test (solo attivo) */}
                                        {s.id === activeId && (
                                            <button
                                                onClick={() => speedTest(s.id)}
                                                disabled={testingId !== null}
                                                className={`inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium ${speed ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" : "text-gray-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 dark:text-gray-400"} disabled:opacity-40 shrink-0`}
                                                title="Test velocit\u00e0 (banda reale)">
                                                {testingId === s.id ? <Spinner /> : <IconSpeed />}
                                                {speed ? `${speed.downMbps}/${speed.upMbps} Mbps` : "Speed"}
                                            </button>
                                        )}

                                        {/* Trash (ghost on hover) */}
                                        <button onClick={() => deleteServer(s.id)} disabled={switchingId !== null}
                                            className="rounded p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 disabled:opacity-50 dark:text-gray-600 dark:hover:text-red-400 dark:hover:bg-red-900/30 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                            title="Rimuovi dalla lista">
                                            <IconTrash />
                                        </button>
                                    </div>

                                    {/* Riga 2: metriche (delay + speed) */}
                                    {(delay || speed) && (
                                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] ml-6">
                                            {delay && (
                                                <span className={`rounded px-1.5 py-0.5 font-semibold ${delay.bg} ${delay.text}`}>
                                                    {delay.label}
                                                </span>
                                            )}
                                            {speed && (
                                                <span className="rounded bg-blue-100 px-1.5 py-0.5 font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                                                    {speed.downMbps}/{speed.upMbps} Mbps
                                                </span>
                                            )}
                                        </div>
                                    )}

                                    {/* Pannello espandibile: nodi + selettore auto/nodo */}
                                    {expandedId === s.id && (
                                        <div className="mt-2 space-y-2 rounded-md border border-gray-200 bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-900/60">
                                            {nodesLoadingId === s.id ? (
                                                <p className="text-[10px] text-gray-500 dark:text-gray-400 inline-flex items-center gap-1">
                                                    <Spinner /> Carico i nodi\u2026
                                                </p>
                                            ) : (nodesById[s.id]?.length ?? 0) === 0 ? (
                                                <p className="text-[10px] text-gray-500 dark:text-gray-400">Nessun nodo disponibile (subscription irraggiungibile?)</p>
                                            ) : (
                                                <>
                                                    {/* Lista radio: Auto + nodi */}
                                                    <div className="space-y-1 max-h-40 overflow-y-auto">
                                                        {/* Opzione Auto */}
                                                        <label className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-[11px] cursor-pointer transition ${(s.serverTag || "auto") === "auto"
                                                            ? "border-emerald-400 bg-emerald-50 dark:border-emerald-600 dark:bg-emerald-900/20"
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
                                                            <span className="font-semibold text-gray-800 dark:text-gray-200">Auto</span>
                                                            <span className="text-gray-500 dark:text-gray-400">failover su tutti i nodi</span>
                                                            {s.lastDelayTest && (
                                                                <span className={`ml-auto rounded px-1.5 py-0.5 font-semibold ${delayChip(s.lastDelayTest.avgDelayMs, s.lastDelayTest.via).bg} ${delayChip(s.lastDelayTest.avgDelayMs, s.lastDelayTest.via).text}`}>
                                                                    {delayChip(s.lastDelayTest.avgDelayMs, s.lastDelayTest.via).label}
                                                                </span>
                                                            )}
                                                        </label>
                                                        {nodesById[s.id].map((n) => {
                                                            const sample = s.lastDelayTest?.samples.find((x) => x.host === n.tag);
                                                            const dc = delayChip(sample ? sample.delayMs : null);
                                                            const isSelected = s.serverTag === n.tag;
                                                            return (
                                                                <label key={n.tag} className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-[11px] cursor-pointer transition ${isSelected
                                                                    ? "border-emerald-400 bg-emerald-50 dark:border-emerald-600 dark:bg-emerald-900/20"
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
                                                                    <span className="font-mono font-semibold text-gray-800 dark:text-gray-200 truncate">{n.tag}</span>
                                                                    <span className="text-gray-500 dark:text-gray-400">{n.host}:{n.port}</span>
                                                                    <span className={`ml-auto rounded px-1.5 py-0.5 font-semibold ${dc.bg} ${dc.text}`}>
                                                                        {dc.label}
                                                                    </span>
                                                                </label>
                                                            );
                                                        })}
                                                    </div>
                                                    <p className="text-[10px] text-gray-400 dark:text-gray-500">
                                                        Seleziona un nodo per attivarlo subito, o "Auto" per il failover. Premi "Delay" per aggiornare i valori.
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
                        {testResult.ok ? "Connection OK"
                            : testResult.vpnDetected ? "VPN detected by Paramount+"
                                : testResult.geoBlocked ? "Geo-blocked (HTTP 451)"
                                    : "Connection failed"}
                    </div>
                    <div className="mt-1 text-xs space-x-1">
                        {testResult.proxy && <span>Proxy: <code className="font-mono">{maskUrl(testResult.proxy)}</code></span>}
                        {testResult.statusCode !== undefined && <span>\u00b7 HTTP {testResult.statusCode}</span>}
                        {testResult.ip && <span>\u00b7 IP: <code className="font-mono">{testResult.ip}</code></span>}
                        {testResult.country && <span>\u00b7 {testResult.country}</span>}
                        {testResult.city && <span>\u00b7 {testResult.city}</span>}
                        <span>\u00b7 {testResult.elapsedMs}ms</span>
                    </div>
                    {testResult.error && <div className="mt-1 text-xs opacity-75">{testResult.error}</div>}
                </div>
            )}
        </div>
    );
}
