"use client";

import { useEffect, useMemo, useState } from "react";
import { ParamountAuthStart } from "@/lib/paramount/client";
import { VpnSetupCard } from "./vpn-card";
import packageInfo from '@/package.json';

/** Esempi rapidi di squadre italiane popolari (Serie A). */
const QUICK_PICKS = [
    "Inter", "Milan", "Juventus", "Roma", "Lazio", "Napoli", "Atalanta", "Fiorentina",
];

/* ── Componenti interni ─────────────────────────────────────── */

function Spinner() {
    return (
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
    );
}

function Card({ title, subtitle, children, className = "" }: {
    title: string;
    subtitle?: string;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={`rounded-2xl border border-gray-200 bg-white p-5 shadow-sm ${className}`}>
            <h2 className="text-base font-semibold text-gray-900">{title}</h2>
            {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
            <div className="mt-4">{children}</div>
        </div>
    );
}

async function copyToClipboard(text: string) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        try {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand("copy");
            document.body.removeChild(ta);
            return ok;
        } catch {
            return false;
        }
    }
}

function isLocalManifestUrl(url: string): boolean {
    try {
        const u = new URL(url);
        const host = u.hostname.toLowerCase();
        if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") return true;
        const parts = host.split(".").map((n) => parseInt(n, 10));
        if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
            if (parts[0] === 10) return true;
            if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
            if (parts[0] === 192 && parts[1] === 168) return true;
        }
        return false;
    } catch { return false; }
}

/* ── Banner ─────────────────────────────────────────────────── */

function LocalAddressBanner({ manifestUrl, onDismiss }: { manifestUrl: string; onDismiss: () => void }) {
    let hostHint = "this addon";
    try {
        const u = new URL(manifestUrl);
        hostHint = `${u.hostname}${u.port ? ":" + u.port : ""}`;
    } catch { }
    return (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">⚠️ Local address detected</p>
                <button onClick={onDismiss} className="rounded-md px-2 text-amber-900/70 hover:bg-amber-100">✕</button>
            </div>
            <p className="mt-1">
                The manifest URL points to <code className="rounded bg-amber-100 px-1 font-mono">{manifestUrl}</code>.
                Stremio on other devices cannot reach <code className="rounded bg-amber-100 px-1">{hostHint}</code>.
            </p>
            <p className="mt-2">
                Set <code className="rounded bg-amber-100 px-1">BASE_URL</code> to a public URL and restart.
            </p>
        </div>
    );
}

/* ── Toast ──────────────────────────────────────────────────── */

function Toast({ msg, type = "success" }: { msg: string; type?: "success" | "error" | "info" }) {
    const colors = type === "error" ? "bg-red-600" : type === "info" ? "bg-blue-600" : "bg-black";
    return (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full px-4 py-2 text-sm text-white shadow-lg z-50 ${colors} animate-bounce`}>
            {msg}
        </div>
    );
}

/* ── Pagina principale ──────────────────────────────────────── */

export default function ConfigurePage() {
    /* auth */
    const [manifestUrl, setManifestUrl] = useState<string | null>(null);
    const [installUrl, setInstallUrl] = useState<string | null>(null);
    const [key, setKey] = useState("");
    const [toast, setToast] = useState<{ msg: string; type: "success" | "error" | "info" } | null>(null);
    const [localBannerDismissed, setLocalBannerDismissed] = useState(false);

    /* password login */
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showPassword, setShowPassword] = useState(false);
    const [loginEditing, setLoginEditing] = useState(false);

    /* device code (alternative) */
    const [showDevice, setShowDevice] = useState(false);
    const [activationCode, setActivationCode] = useState<string | null>(null);
    const [paramountAuth, setParamountAuth] = useState<ParamountAuthStart | null>(null);

    /* sports prefs */
    const [prefs, setPrefs] = useState<{ favoriteTeams: { name: string; key: string }[]; hiddenLeagues: string[] } | null>(null);
    const [leagues, setLeagues] = useState<{ key: string; name: string }[]>([]);
    const [newTeam, setNewTeam] = useState("");

    /* vpn state */
    const [vpnActive, setVpnActive] = useState(false);

    /* ── helpers ── */

    function showToast(msg: string, type: "success" | "error" | "info" = "success") {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 2200);
    }

    function resetAll() {
        setActivationCode(null);
        setParamountAuth(null);
        setManifestUrl(null);
        setInstallUrl(null);
        setError(null);
    }

    /* ── password login ── */

    async function passwordLogin() {
        setError(null);
        if (!email.trim() || !password) { setError("Enter email and password"); return; }
        setBusy(true);
        try {
            const r = await fetch("/api/auth/password/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: email.trim(), password }),
            });
            const j = await r.json().catch(() => ({}));
            if (r.ok && j?.ok) {
                setManifestUrl(j.manifestUrl);
                setInstallUrl(j.installUrl ?? null);
                setPassword("");
                showToast("Logged in ✅");
            } else if (r.status === 429) {
                setError(j?.error ?? "Too many attempts. Try again later.");
            } else {
                setError(j?.error ?? "Login failed");
            }
        } catch (e: any) {
            setError(e?.message ?? "Network error");
        } finally { setBusy(false); }
    }

    /* ── device code flow ── */

    async function startDevice() {
        resetAll();
        const r = await fetch("/api/auth/device/start", { method: "POST" });
        const j = await r.json();
        if (!r.ok) { showToast(j?.error ?? "Error", "error"); return; }
        setActivationCode(j.activationCode);
        setParamountAuth(j);
    }

    async function pollOnce(auth: ParamountAuthStart) {
        const r = await fetch("/api/auth/device/poll", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(auth),
        });
        const j = await r.json();
        if (j.ok) {
            setManifestUrl(j.manifestUrl);
            setInstallUrl(j.installUrl ?? null);
            return true;
        }
        return false;
    }

    useEffect(() => {
        if (!paramountAuth || manifestUrl) return;
        const t = setInterval(async () => {
            try { const ok = await pollOnce(paramountAuth); if (ok) clearInterval(t); } catch { }
        }, 3000);
        return () => clearInterval(t);
    }, [paramountAuth, manifestUrl]);

    /* ── key da URL ── */

    useEffect(() => {
        const q = new URL(window.location.href).searchParams.get("key");
        if (q && !key) setKey(q);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* ── install URLs ── */

    const stremioInstallUrl = useMemo(() => {
        if (!installUrl) return "";
        return `stremio://${installUrl.replace(/^https?:\/\//, "")}`;
    }, [installUrl]);

    /* ── clipboard ── */

    async function onCopyInstallUrl() {
        if (!installUrl) return;
        const ok = await copyToClipboard(installUrl);
        showToast(ok ? "Copied ✅" : "Failed to copy", ok ? "success" : "error");
    }

    /* ── sports prefs ── */

    async function loadPrefs() {
        if (!key) return;
        try {
            const r = await fetch(`/api/stremio/${encodeURIComponent(key)}/prefs`);
            const j = await r.json();
            if (r.ok) { setPrefs(j.prefs); setLeagues(j.leagues ?? []); }
        } catch { }
    }

    useEffect(() => { if (key) loadPrefs(); }, [key]);

    async function prefsAction(action: string, extra: Record<string, unknown> = {}) {
        if (!key) return;
        try {
            const r = await fetch(`/api/stremio/${encodeURIComponent(key)}/prefs`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action, ...extra }),
            });
            const j = await r.json();
            if (r.ok) { setPrefs(j.prefs); showToast("Saved ✅"); }
            else showToast(j?.error ?? "Error", "error");
        } catch { showToast("Error", "error"); }
    }

    async function onAddTeam() {
        const name = newTeam.trim();
        if (!name) return;
        await prefsAction("addTeam", { name });
        setNewTeam("");
    }

    async function onQuickAddTeam(name: string) {
        if (prefs?.favoriteTeams.some((t) => t.name.toLowerCase() === name.toLowerCase())) return;
        await prefsAction("addTeam", { name: name.trim() });
    }

    async function onRemoveTeam(teamKey: string) { await prefsAction("removeTeam", { teamKey }); }
    async function onToggleLeague(leagueKey: string, hidden: boolean) {
        await prefsAction(hidden ? "showLeague" : "hideLeague", { leagueKey });
    }

    /* ── render ── */

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            <div className="mx-auto w-full max-w-2xl px-4 py-10 flex-grow space-y-6">

                {/* ===== HEADER ===== */}
                <div className="flex items-center gap-4">
                    <div className="h-12 w-12 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                        <img src="/icon.png" alt="Logo" className="h-full w-full object-contain" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
                            Unofficial <span className="text-blue-600">Paramount+</span>
                        </h1>
                        <p className="text-xs text-gray-500">v{packageInfo.version} · Stremio addon</p>
                    </div>
                </div>

                {/* ===== LOGIN CARD ===== */}
                <Card
                    title={manifestUrl ? "✅ Logged in to Paramount+" : "Sign in to Paramount+"}
                    subtitle={!manifestUrl ? "Your credentials are sent server-side through the configured proxy and never stored." : undefined}
                >
                    {!manifestUrl ? (
                        <div className="space-y-3">
                            {/* Email + password (primary) */}
                            <div className="space-y-2">
                                <input
                                    type="email"
                                    autoComplete="username"
                                    placeholder="Email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    disabled={busy}
                                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
                                />
                                <div className="relative">
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        autoComplete="current-password"
                                        placeholder="Password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        onKeyDown={(e) => e.key === "Enter" && passwordLogin()}
                                        disabled={busy}
                                        className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 pr-16 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword((v) => !v)}
                                        className="absolute inset-y-0 right-2 my-1 rounded-md px-2 text-xs text-gray-500 hover:bg-gray-100"
                                    >
                                        {showPassword ? "Hide" : "Show"}
                                    </button>
                                </div>
                            </div>

                            {error && (
                                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                                    {error}
                                </div>
                            )}

                            <button
                                onClick={passwordLogin}
                                disabled={busy}
                                className="w-full rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-black/85 disabled:opacity-50 inline-flex items-center justify-center gap-2"
                            >
                                {busy ? <><Spinner /> Signing in...</> : "Sign in"}
                            </button>

                            <p className="text-xs text-gray-500 text-center">
                                ⚠️ Too many failed attempts may temporarily block this server&rsquo;s IP.
                            </p>

                            {/* Device code alternative */}
                            <div className="border-t border-gray-200 pt-3">
                                <button
                                    onClick={() => { setShowDevice(!showDevice); if (!showDevice) startDevice(); }}
                                    className="text-xs text-gray-500 hover:text-gray-700 underline"
                                >
                                    {showDevice ? "Hide device code login" : "Alternative: activate with device code"}
                                </button>

                                {showDevice && activationCode && !manifestUrl && (
                                    <div className="mt-3 space-y-2">
                                        <div className="rounded-xl bg-gray-100 p-3 text-center">
                                            <p className="text-xs text-gray-500 mb-1">Go to</p>
                                            <a href="https://www.paramountplus.com/activate/androidtv/" target="_blank" rel="noreferrer"
                                                className="text-blue-600 text-sm font-medium break-all">
                                                paramountplus.com/activate/androidtv
                                            </a>
                                            <p className="text-xs text-gray-500 mt-1">and enter this code:</p>
                                            <p className="text-3xl font-black tracking-[6px] text-gray-900 mt-1">{activationCode}</p>
                                            <p className="text-xs text-gray-400 mt-1">Checking every 3 seconds...</p>
                                        </div>
                                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                                            ⚠️ US account required. If outside the US, the activation page will redirect you
                                            and the code won&rsquo;t work. Use the password login instead.
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : loginEditing ? (
                        /* Modifica login: mostra il form per cambiare credenziali */
                        <div className="space-y-3">
                            <div className="space-y-2">
                                <input
                                    type="email"
                                    autoComplete="username"
                                    placeholder="Email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    disabled={busy}
                                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
                                />
                                <div className="relative">
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        autoComplete="current-password"
                                        placeholder="Password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        onKeyDown={(e) => e.key === "Enter" && passwordLogin()}
                                        disabled={busy}
                                        className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 pr-16 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword((v) => !v)}
                                        className="absolute inset-y-0 right-2 my-1 rounded-md px-2 text-xs text-gray-500 hover:bg-gray-100"
                                    >
                                        {showPassword ? "Hide" : "Show"}
                                    </button>
                                </div>
                            </div>
                            {error && (
                                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                                    {error}
                                </div>
                            )}
                            <div className="flex gap-2">
                                <button
                                    onClick={passwordLogin}
                                    disabled={busy}
                                    className="flex-1 rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-black/85 disabled:opacity-50 inline-flex items-center justify-center gap-2"
                                >
                                    {busy ? <><Spinner /> Signing in...</> : "Update login"}
                                </button>
                                <button
                                    onClick={() => { setLoginEditing(false); setError(null); setPassword(""); }}
                                    className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <p className="text-sm text-gray-600">You are signed in. Your session is valid for 1 year.</p>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => { setLoginEditing(true); setError(null); }}
                                    className="rounded-lg border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                >
                                    ✏️ Modifica
                                </button>
                                <button
                                    onClick={() => { resetAll(); setEmail(""); setPassword(""); setShowDevice(false); }}
                                    className="text-xs text-red-500 hover:text-red-700 underline"
                                >
                                    Sign out
                                </button>
                            </div>
                        </div>
                    )}
                </Card>

                {/* ===== SPORTS PREFERENCES ===== */}
                {key && (
                    <Card title="⚽ Sports — Your favorite teams" subtitle="Teams you pick will be highlighted at the top of every Sport catalog.">
                        <div className="space-y-3">
                            <div className="flex gap-2">
                                <input
                                    value={newTeam}
                                    onChange={(e) => setNewTeam(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && onAddTeam()}
                                    placeholder="Team name, e.g. Inter"
                                    className="flex-1 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500"
                                />
                                <button
                                    onClick={onAddTeam}
                                    disabled={!newTeam.trim()}
                                    className="rounded-xl bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/85 disabled:opacity-40"
                                >
                                    Add
                                </button>
                            </div>

                            <div className="flex flex-wrap gap-1.5">
                                <span className="text-xs text-gray-500 mr-1">Quick:</span>
                                {QUICK_PICKS.map((name) => {
                                    const already = prefs?.favoriteTeams.some((t) => t.name.toLowerCase() === name.toLowerCase());
                                    return (
                                        <button
                                            key={name}
                                            onClick={() => onQuickAddTeam(name)}
                                            disabled={already}
                                            className={`rounded-full border px-2.5 py-0.5 text-xs transition ${already
                                                ? "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed"
                                                : "border-blue-300 bg-white text-blue-700 hover:bg-blue-50"}`}
                                        >
                                            {already ? `✓ ${name}` : `+ ${name}`}
                                        </button>
                                    );
                                })}
                            </div>

                            {prefs && prefs.favoriteTeams.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                    {prefs.favoriteTeams.map((t) => (
                                        <span key={t.key} className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white px-3 py-1 text-sm">
                                            ⭐ {t.name}
                                            <button onClick={() => onRemoveTeam(t.key)} className="text-gray-400 hover:text-red-500">✕</button>
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    </Card>
                )}

                {/* ===== VPN / PROXY ===== */}
                <VpnSetupCard
                    onToast={(msg) => showToast(msg, msg.startsWith("✅") ? "success" : "error")}
                    onVpnActiveChange={setVpnActive}
                />

                {/* ===== LEAGUES ===== */}
                {key && leagues.length > 0 && (
                    <Card title="Leagues — Hide what you don&rsquo;t want" subtitle="Hidden leagues won't appear in the &lsquo;Altro&rsquo; catalog.">
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {leagues.map((l) => {
                                const hidden = prefs?.hiddenLeagues.includes(l.key) ?? false;
                                return (
                                    <label key={l.key} className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm">
                                        <span className={hidden ? "text-gray-400 line-through" : "text-gray-800"}>{l.name}</span>
                                        <button
                                            onClick={() => onToggleLeague(l.key, hidden)}
                                            className={`rounded-full px-3 py-1 text-xs font-medium transition ${hidden
                                                ? "bg-gray-200 text-gray-600 hover:bg-gray-300"
                                                : "bg-black text-white hover:bg-black/85"}`}
                                        >
                                            {hidden ? "Show" : "Hide"}
                                        </button>
                                    </label>
                                );
                            })}
                        </div>
                    </Card>
                )}

                {/* ===== INSTALL TO STREMIO ===== */}
                <Card
                    title="Install to Stremio"
                    subtitle={manifestUrl && vpnActive
                        ? "One click to add the addon to your Stremio app."
                        : "Complete Step 1 (Login) and Step 2 (VLESS) to enable installation."}
                >
                    {manifestUrl && vpnActive ? (
                        <div className="space-y-3">
                            {installUrl && (
                                <div className="rounded-xl bg-gray-50 p-3">
                                    <p className="text-xs text-gray-500 mb-1">Install URL</p>
                                    <code className="text-sm text-gray-800 break-all font-mono">{installUrl}</code>
                                </div>
                            )}

                            <div className="flex flex-wrap gap-2">
                                <a
                                    href={stremioInstallUrl || "#"}
                                    onClick={(e) => !stremioInstallUrl && e.preventDefault()}
                                    className={`inline-flex items-center justify-center rounded-xl px-5 py-2.5 text-sm font-semibold transition ${stremioInstallUrl
                                        ? "bg-black text-white hover:bg-black/85"
                                        : "bg-gray-100 text-gray-400 cursor-not-allowed"}`}
                                >
                                    ⚡ Install in Stremio
                                </a>

                                <button
                                    onClick={onCopyInstallUrl}
                                    disabled={!installUrl}
                                    className="rounded-xl bg-gray-100 px-4 py-2.5 text-sm font-medium text-gray-900 hover:bg-gray-200 disabled:opacity-50"
                                >
                                    Copy URL
                                </button>
                            </div>

                            {manifestUrl && isLocalManifestUrl(manifestUrl) && !localBannerDismissed && (
                                <LocalAddressBanner
                                    manifestUrl={manifestUrl}
                                    onDismiss={() => setLocalBannerDismissed(true)}
                                />
                            )}
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <div className="flex items-center gap-3 text-sm">
                                <span className={manifestUrl ? "text-green-600" : "text-gray-400"}>
                                    {manifestUrl ? "✅" : "○"} Step 1 — Login Paramount+
                                </span>
                            </div>
                            <div className="flex items-center gap-3 text-sm">
                                <span className={vpnActive ? "text-green-600" : "text-gray-400"}>
                                    {vpnActive ? "✅" : "○"} Step 2 — Connetti VLESS
                                </span>
                            </div>
                            <button
                                disabled
                                className="w-full rounded-xl bg-gray-100 px-4 py-2.5 text-sm font-semibold text-gray-400 cursor-not-allowed inline-flex items-center justify-center gap-2"
                            >
                                ⚡ Install in Stremio
                            </button>
                        </div>
                    )}
                </Card>

                {/* ===== TOAST ===== */}
                {toast && <Toast msg={toast.msg} type={toast.type} />}

            </div>

            {/* ===== FOOTER ===== */}
            <footer className="w-full border-t border-gray-200 bg-white py-6 mt-10">
                <div className="mx-auto max-w-2xl px-4 text-center">
                    <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">Legal Disclaimer</p>
                    <p className="text-xs leading-relaxed text-gray-500">
                        This add-on is an unofficial tool and is not affiliated with, endorsed by, or associated with
                        Paramount Global or its subsidiaries. It is intended for personal use only. Users are responsible
                        for ensuring they have a valid subscription. We do not host or provide any media content; this tool
                        simply acts as a proxy for legitimate API requests. Using proxy services may be considered abuse
                        under Paramount&rsquo;s terms. Use at your own discretion.
                    </p>
                    <div className="mt-2">
                        <a href="https://github.com/RioNoir/paramount-stremio" className="text-xs text-purple-900 hover:underline">Source Code</a>
                        <span className="mx-2 text-gray-300">•</span>
                        <a href="https://buymeacoffee.com/rionoir" className="text-xs text-purple-900 hover:underline">Buy me a coffee</a>
                    </div>
                </div>
            </footer>
        </div>
    );
}
