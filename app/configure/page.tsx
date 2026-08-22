"use client";

import { useEffect, useMemo, useState } from "react";
import { ParamountAuthStart } from "@/lib/paramount/client";
import packageInfo from '@/package.json';

/** Esempi rapidi di squadre italiane popolari (Serie A). */
const QUICK_PICKS = [
    "Inter",
    "Milan",
    "Juventus",
    "Roma",
    "Lazio",
    "Napoli",
    "Atalanta",
    "Fiorentina",
];

function Button({
    children,
    onClick,
    disabled,
    variant = "primary",
    type = "button",
}: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: "primary" | "secondary";
    type?: "button" | "submit";
}) {
    const base =
        "inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-offset-2";
    const styles =
        variant === "primary"
            ? "bg-black text-white hover:bg-black/85 focus:ring-black disabled:bg-black/40"
            : "bg-gray-100 text-gray-900 hover:bg-gray-200 focus:ring-gray-300 disabled:bg-gray-100/60";
    return (
        <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${styles}`}>
            {children}
        </button>
    );
}

function TextArea({
    value,
    readOnly = false,
}: {
    value: string;
    readOnly?: boolean;
}) {
    return (
        <textarea
            value={value}
            readOnly={readOnly}
            className="min-h-[90px] w-full resize-y rounded-xl border border-gray-200 bg-white text-gray-700 px-3 py-2 text-sm outline-none focus:border-gray-400"
        />
    );
}

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

async function copyToClipboard(text: string) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        // Fallback per contesti non sicuri (HTTP su IP LAN): navigator.clipboard
        // e disponibile solo su HTTPS o localhost, quindi usiamo un textarea
        // temporaneo con document.execCommand("copy").
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
        if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") {
            return true;
        }
        // IP privati RFC1918 (10/8, 172.16/12, 192.168/16)
        const parts = host.split(".").map((n) => parseInt(n, 10));
        if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
            if (parts[0] === 10) return true;
            if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
            if (parts[0] === 192 && parts[1] === 168) return true;
        }
        return false;
    } catch {
        return false;
    }
}

function LocalAddressBanner({ manifestUrl, onDismiss }: { manifestUrl: string; onDismiss: () => void }) {
    let hostHint = "this addon";
    let baseUrlHint = "https://addon.example.com";
    try {
        const u = new URL(manifestUrl);
        hostHint = `${u.hostname}${u.port ? ":" + u.port : ""}`;
        baseUrlHint = `${u.protocol}//${u.hostname}${u.port ? ":" + u.port : ""}`;
    } catch { }
    return (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">⚠️ Local address detected</p>
                <button
                    onClick={onDismiss}
                    aria-label="Dismiss"
                    className="rounded-md px-2 text-amber-900/70 hover:bg-amber-100 hover:text-amber-900"
                >
                    ✕
                </button>
            </div>
            <p className="mt-1">
                The manifest URL points to <code className="rounded bg-amber-100 px-1 font-mono">{manifestUrl}</code>.
                Stremio on other devices can't reach <code className="rounded bg-amber-100 px-1">{hostHint}</code>.
            </p>
            <p className="mt-2">
                To get a public URL, set <code className="rounded bg-amber-100 px-1">BASE_URL</code> on the server (e.g.{" "}
                <code className="rounded bg-amber-100 px-1">BASE_URL={baseUrlHint}</code>) and restart the service:
            </p>
            <pre className="mt-2 overflow-x-auto rounded-lg border border-amber-200 bg-white p-2 text-xs text-gray-800">
                {`# Local dev (same PC)
export BASE_URL=http://localhost:7850

# Production (Oracle Cloud, VPS, ecc.)
sudo systemctl edit paramount-stremio
# imposta: Environment=BASE_URL=http://<pub-ip>:3000
sudo systemctl restart paramount-stremio

# Oppure su docker compose:
#   environment:
#     - BASE_URL=http://<pub-ip>:3000`}
            </pre>
            <p className="mt-2">
                Until then, use the <b>Copy Manifest URL</b> button and paste the URL manually
                into Stremio (<i>Addons → Community → Install via URL</i>).
            </p>
            <p className="mt-2 text-xs text-amber-800/80">
                See <code className="rounded bg-amber-100 px-1">deploy/oracle/README.md</code> for the full Oracle Cloud Free Tier guide.
            </p>
        </div>
    );
}

export default function ConfigurePage() {
    const [loginMode, setLoginMode] = useState<"device" | "password">("device");
    const [activationCode, setActivationCode] = useState<string | null>(null);
    const [paramountAuth, setParamountAuth] = useState<ParamountAuthStart | null>(null);
    const [manifestUrl, setManifestUrl] = useState<string | null>(null);
    const [m3uUrl, setM3uUrl] = useState<string | null>(null);
    const [epgUrl, setEpgUrl] = useState<string | null>(null);
    const [key, setKey] = useState("");
    const [toast, setToast] = useState<string | null>(null);
    const [localBannerDismissed, setLocalBannerDismissed] = useState(false);

    // Password login state
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [passwordBusy, setPasswordBusy] = useState(false);
    const [passwordError, setPasswordError] = useState<string | null>(null);
    const [showPassword, setShowPassword] = useState(false);

    function resetAll() {
        setActivationCode(null);
        setParamountAuth(null);
        setManifestUrl(null);
        setM3uUrl(null);
        setEpgUrl(null);
        setPasswordError(null);
    }

    function switchMode(mode: "device" | "password") {
        if (mode === loginMode) return;
        setLoginMode(mode);
        resetAll();
    }

    async function start() {
        resetAll();

        const r = await fetch("/api/auth/device/start", { method: "POST" });
        const j = await r.json();

        if (!r.ok) {
            showToast(j?.error ?? "Error");
            return;
        }

        setActivationCode(j.activationCode);
        setParamountAuth(j);
    }

    async function passwordLogin() {
        setPasswordError(null);
        if (!email.trim() || !password) {
            setPasswordError("Inserisci email e password");
            return;
        }
        setPasswordBusy(true);
        try {
            const r = await fetch("/api/auth/password/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: email.trim(), password }),
            });
            const j = await r.json().catch(() => ({}));
            if (r.ok && j?.ok) {
                setManifestUrl(j.manifestUrl);
                setM3uUrl(j.m3uUrl ?? null);
                setEpgUrl(j.epgUrl ?? null);
                // svuota la password dalla memoria del browser (best effort)
                setPassword("");
                showToast("Logged in ✅");
            } else if (r.status === 429) {
                setPasswordError(j?.error ?? "Troppi tentativi. Riprova pi\u00f9 tardi.");
            } else {
                setPasswordError(j?.error ?? "Login failed");
            }
        } catch (e: any) {
            setPasswordError(e?.message ?? "Network error");
        } finally {
            setPasswordBusy(false);
        }
    }

    async function pollOnce(paramountAuth: ParamountAuthStart) {
        const r = await fetch("/api/auth/device/poll", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(paramountAuth),
        });
        const j = await r.json();
        if (j.ok) {
            setManifestUrl(j.manifestUrl);
            setM3uUrl(j.m3uUrl ?? null);
            setEpgUrl(j.epgUrl ?? null);
            return true;
        }
        return false;
    }

    useEffect(() => {
        if (!paramountAuth || manifestUrl) return;

        const t = setInterval(async () => {
            try {
                const ok = await pollOnce(paramountAuth);
                if (ok) clearInterval(t);
            } catch { }
        }, 3000);

        return () => clearInterval(t);
    }, [paramountAuth, manifestUrl]);


    useEffect(() => {
        const url = new URL(window.location.href);
        const q = url.searchParams.get("key");
        if (q && !key) setKey(q);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const stremioInstallUrl = useMemo(() => {
        if (!manifestUrl) return "";
        return `stremio://` + manifestUrl;
    }, [manifestUrl]);

    function showToast(msg: string) {
        setToast(msg);
        setTimeout(() => setToast(null), 1800);
    }

    async function onCopyManifest() {
        if (!manifestUrl) return;
        const ok = await copyToClipboard(manifestUrl);
        showToast(ok ? "Manifest URL copied ✅" : "Unable to copy 😅");
    }

    async function onCopyM3u() {
        if (!m3uUrl) return;
        const ok = await copyToClipboard(m3uUrl);
        showToast(ok ? "M3U URL copied ✅" : "Unable to copy 😅");
    }

    async function onCopyEpg() {
        if (!epgUrl) return;
        const ok = await copyToClipboard(epgUrl);
        showToast(ok ? "EPG URL copied ✅" : "Unable to copy 😅");
    }

    // --- Sports preferences (Fase 3) ---
    const [prefs, setPrefs] = useState<{ favoriteTeams: { name: string; key: string }[]; hiddenLeagues: string[] } | null>(null);
    const [newTeam, setNewTeam] = useState("");
    const [leagues, setLeagues] = useState<{ key: string; name: string }[]>([]);

    async function loadPrefs() {
        if (!key) return;
        try {
            const r = await fetch(`/api/stremio/${encodeURIComponent(key)}/prefs`);
            const j = await r.json();
            if (r.ok) {
                setPrefs(j.prefs);
                setLeagues(j.leagues ?? []);
            }
        } catch { }
    }

    useEffect(() => {
        if (key) loadPrefs();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);

    async function prefsAction(action: string, extra: Record<string, unknown> = {}) {
        if (!key) return;
        try {
            const r = await fetch(`/api/stremio/${encodeURIComponent(key)}/prefs`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action, ...extra }),
            });
            const j = await r.json();
            if (r.ok) {
                setPrefs(j.prefs);
                showToast("Preferences saved ✅");
            } else {
                showToast(j?.error ?? "Error 😅");
            }
        } catch {
            showToast("Error 😅");
        }
    }

    async function onAddTeam() {
        const name = newTeam.trim();
        if (!name) return;
        await prefsAction("addTeam", { name });
        setNewTeam("");
    }

    async function onQuickAddTeam(name: string) {
        const trimmed = name.trim();
        if (!trimmed) return;
        // Non aggiungere duplicati.
        if (prefs?.favoriteTeams.some((t) => t.name.toLowerCase() === trimmed.toLowerCase())) return;
        await prefsAction("addTeam", { name: trimmed });
    }

    async function onRemoveTeam(teamKey: string) {
        await prefsAction("removeTeam", { teamKey });
    }

    async function onToggleLeague(leagueKey: string, hidden: boolean) {
        await prefsAction(hidden ? "showLeague" : "hideLeague", { leagueKey });
    }

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            <div className="mx-auto w-full max-w-4xl px-4 py-10 flex-grow">
                <div className="mb-8">
                    <div className="mb-8 flex flex-col items-start">
                        <div className="flex items-center gap-4 mb-4">
                            <div
                                className="h-16 w-16 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                                <img
                                    src="/icon.png" // Assicurati di avere il logo in public/logo.png
                                    alt="Addon Logo"
                                    className="h-full w-full object-contain"
                                />
                            </div>
                            <div>
                                <div
                                    className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 font-medium">
                                    v{packageInfo.version}
                                </div>
                            </div>
                        </div>

                        <h1 className="text-3xl font-bold tracking-tight text-gray-900">
                            Unofficial <span className="text-blue-600">Paramount+</span> Addon
                        </h1>
                        <p className="mt-2 text-sm text-gray-600 max-w-md">
                            Log in to Paramount+ and get the link to your add-on.
                        </p>
                    </div>

                </div>

                {/* Banner sport ben visibile: appare appena l'utente è loggato */}
                {key && (
                    <div className="mb-8 rounded-2xl border-2 border-blue-300 bg-gradient-to-br from-blue-50 via-white to-emerald-50 p-5 shadow-sm">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <div className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">
                                    ⚽ Sports View
                                </div>
                                <h2 className="mt-2 text-xl font-bold text-gray-900">
                                    Start here — pick your favorite team
                                </h2>
                                <p className="mt-1 text-sm text-gray-700 max-w-xl">
                                    Type the team name (e.g. <code className="rounded bg-white px-1">Inter</code>) and press <b>Add</b>.
                                    Your favorite teams will be highlighted at the top of every <b>Sport</b> catalog in Stremio
                                    (live, upcoming and replays when available). Use the <b>Altro</b> catalog to browse the
                                    remaining leagues (UFC, NFL, NBA…).
                                </p>
                            </div>
                            <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[320px]">
                                <div className="flex gap-2">
                                    <input
                                        value={newTeam}
                                        onChange={(e) => setNewTeam(e.target.value)}
                                        onKeyDown={(e) => e.key === "Enter" && onAddTeam()}
                                        placeholder="Team name, e.g. Inter"
                                        className="flex-1 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-blue-500"
                                    />
                                    <Button onClick={onAddTeam} disabled={!newTeam.trim()}>
                                        Add
                                    </Button>
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="text-xs font-medium text-gray-500 mr-1">Esempi:</span>
                                    {QUICK_PICKS.map((name) => {
                                        const already = prefs?.favoriteTeams.some(
                                            (t) => t.name.toLowerCase() === name.toLowerCase()
                                        );
                                        return (
                                            <button
                                                key={name}
                                                onClick={() => onQuickAddTeam(name)}
                                                disabled={already}
                                                title={already ? `${name} già aggiunta` : `Aggiungi ${name}`}
                                                className={`rounded-full border px-2.5 py-0.5 text-xs transition ${already
                                                    ? "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed"
                                                    : "border-blue-300 bg-white text-blue-700 hover:bg-blue-50"
                                                    }`}
                                            >
                                                {already ? `✓ ${name}` : `+ ${name}`}
                                            </button>
                                        );
                                    })}
                                </div>
                                {prefs && prefs.favoriteTeams.length > 0 ? (
                                    <div className="flex flex-wrap gap-2">
                                        {prefs.favoriteTeams.map((t) => (
                                            <span
                                                key={t.key}
                                                className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white px-3 py-1 text-sm text-gray-800"
                                            >
                                                ⭐ {t.name}
                                                <button
                                                    onClick={() => onRemoveTeam(t.key)}
                                                    className="text-gray-400 hover:text-red-500"
                                                    aria-label={`Remove ${t.name}`}
                                                >
                                                    ✕
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <Card
                        title="1 → Sign in to Paramount+"
                        subtitle="Choose how to log in. Both methods run server-side through the configured proxy."
                    >
                        <div className="space-y-4">
                            {/* Tab toggle */}
                            <div className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1 text-sm">
                                <button
                                    onClick={() => switchMode("device")}
                                    className={`rounded-lg px-3 py-1.5 transition ${loginMode === "device"
                                        ? "bg-black text-white shadow-sm"
                                        : "text-gray-700 hover:bg-white"
                                        }`}
                                >
                                    Device code
                                </button>
                                <button
                                    onClick={() => switchMode("password")}
                                    className={`rounded-lg px-3 py-1.5 transition ${loginMode === "password"
                                        ? "bg-black text-white shadow-sm"
                                        : "text-gray-700 hover:bg-white"
                                        }`}
                                >
                                    Email + password
                                </button>
                            </div>

                            {loginMode === "device" ? (
                                <div className="space-y-3">
                                    <div className="flex flex-wrap gap-2">
                                        {!activationCode && (
                                            <Button onClick={start} variant="primary">
                                                Start login (device code)
                                            </Button>
                                        )}
                                    </div>

                                    {activationCode && !manifestUrl && (
                                        <div className="mt-3 text-black">
                                            <p>
                                                Go <a href="https://www.paramountplus.com/activate/androidtv/" target="_blank"
                                                    rel="noreferrer" className="text-blue-400">
                                                    here
                                                </a> and insert:
                                            </p>
                                            <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: 6 }}>
                                                {activationCode}
                                            </div>
                                            <p style={{ opacity: 0.8 }}>I am automatically checking every 3 seconds...</p>
                                            <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                                                <p className="font-semibold">⚠️ US account required</p>
                                                <p className="mt-1">
                                                    This addon works with the <b>US</b> Paramount+ service. If you are outside
                                                    the US, the activation page will redirect you to your local Paramount+
                                                    (a separate system) and the code will never be accepted.
                                                </p>
                                                <p className="mt-2">
                                                    The link above is just the standard Paramount+ device-code activation
                                                    page. The androidtv name in the URL is only their internal convention:
                                                    the login works on any device (TV, phone, tablet, browser, IPTV player).
                                                </p>
                                                <p className="mt-2">
                                                    If you can't open that page through a US proxy/VPN, switch to the
                                                    <b> Email + password</b> tab above: the login runs on this server,
                                                    which already has the US proxy configured.
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <p className="text-sm text-gray-600">
                                        Enter your Paramount+ credentials. They are sent only to this server
                                        (over HTTPS) and forwarded to Paramount+ through the configured
                                        <code className="mx-1 rounded bg-gray-100 px-1 font-mono">HTTP_PROXY</code>;
                                        they are <b>never stored</b>, only the resulting session cookies are kept.
                                    </p>
                                    <div className="space-y-2">
                                        <input
                                            type="email"
                                            autoComplete="username"
                                            placeholder="Email (Paramount+ account)"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            disabled={passwordBusy || !!manifestUrl}
                                            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-blue-500 disabled:bg-gray-100"
                                        />
                                        <div className="relative">
                                            <input
                                                type={showPassword ? "text" : "password"}
                                                autoComplete="current-password"
                                                placeholder="Password"
                                                value={password}
                                                onChange={(e) => setPassword(e.target.value)}
                                                onKeyDown={(e) => e.key === "Enter" && passwordLogin()}
                                                disabled={passwordBusy || !!manifestUrl}
                                                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 pr-16 text-sm text-gray-800 outline-none focus:border-blue-500 disabled:bg-gray-100"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowPassword((v) => !v)}
                                                className="absolute inset-y-0 right-2 my-1 rounded-md px-2 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                                                aria-label={showPassword ? "Hide password" : "Show password"}
                                            >
                                                {showPassword ? "Hide" : "Show"}
                                            </button>
                                        </div>
                                    </div>
                                    {passwordError && (
                                        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                                            {passwordError}
                                        </div>
                                    )}
                                    {!manifestUrl && (
                                        <Button onClick={passwordLogin} disabled={passwordBusy} variant="primary">
                                            {passwordBusy ? "Logging in..." : "Log in"}
                                        </Button>
                                    )}
                                    <p className="text-xs text-gray-500">
                                        ⚠️ Too many failed attempts may temporarily block this server's IP on
                                        Paramount+. If login fails repeatedly, switch back to the <b>Device code</b> tab.
                                    </p>
                                </div>
                            )}

                            {manifestUrl && (
                                <div className="text-center text-2xl">
                                    <h3 className="text-black font-bold">✅</h3>
                                    <h3 className="font-bold text-teal-700">Logged in</h3>
                                </div>
                            )}

                            <p className="text-gray-500 text-sm inline-block align-text-bottom">
                                By proceeding with the login, you confirm that you have read the disclaimer at the bottom of the page.
                            </p>
                        </div>
                    </Card>

                    <div>
                        <Card
                            title="2 → Install to Stremio"
                            subtitle="Copy the manifest URL and paste it into Stremio → Addons → Community → Install via URL."
                        >
                            <div className="space-y-3">
                                <TextArea value={manifestUrl || "Login to generate the manifest URL..."} readOnly />
                                <div className="flex flex-wrap gap-2">
                                    <Button onClick={onCopyManifest} disabled={!manifestUrl}>
                                        Copy Manifest URL
                                    </Button>

                                    <a
                                        href={stremioInstallUrl || "#"}
                                        onClick={(e) => !stremioInstallUrl && e.preventDefault()}
                                        className={`inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium transition ${stremioInstallUrl
                                            ? "bg-gray-100 text-gray-900 hover:bg-gray-200"
                                            : "bg-gray-100/60 text-gray-500 cursor-not-allowed"
                                            }`}
                                    >
                                        Open in Stremio
                                    </a>
                                </div>
                                {manifestUrl && isLocalManifestUrl(manifestUrl) && !localBannerDismissed && (
                                    <LocalAddressBanner
                                        manifestUrl={manifestUrl}
                                        onDismiss={() => setLocalBannerDismissed(true)}
                                    />
                                )}
                            </div>
                        </Card>

                        <Card
                            title="3 → IPTV (optional)"
                            subtitle="Use the M3U playlist and EPG in any IPTV player (e.g. TiviMate, VLC)."
                        >
                            <div className="space-y-3">
                                <TextArea value={m3uUrl || "Login to generate the M3U playlist..."} readOnly />
                                <div className="flex flex-wrap gap-2">
                                    <Button onClick={onCopyM3u} disabled={!m3uUrl} variant="secondary">
                                        Copy M3U URL
                                    </Button>
                                </div>
                                <TextArea value={epgUrl || "Login to generate the EPG..."} readOnly />
                                <div className="flex flex-wrap gap-2">
                                    <Button onClick={onCopyEpg} disabled={!epgUrl} variant="secondary">
                                        Copy EPG URL
                                    </Button>
                                </div>
                            </div>
                        </Card>
                    </div>
                </div>

                {key && (
                    <div className="mt-8">
                        <Card
                            title="⚽ Leagues — Hide what you don't want to see"
                            subtitle="Optional. The home shows 5 fixed Sport sections: Serie A, UEFA Champions League, UEFA Europa League, UEFA Conference League, and Altro (everything else). Hide leagues here if you don't want them in 'Altro'."
                        >
                            <div>
                                {leagues.length > 0 ? (
                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                        {leagues.map((l) => {
                                            const hidden = prefs?.hiddenLeagues.includes(l.key) ?? false;
                                            return (
                                                <label
                                                    key={l.key}
                                                    className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
                                                >
                                                    <span className={hidden ? "text-gray-400 line-through" : "text-gray-800"}>
                                                        {l.name}
                                                    </span>
                                                    <button
                                                        onClick={() => onToggleLeague(l.key, hidden)}
                                                        className={`rounded-full px-3 py-1 text-xs font-medium transition ${hidden
                                                            ? "bg-gray-200 text-gray-600 hover:bg-gray-300"
                                                            : "bg-black text-white hover:bg-black/85"
                                                            }`}
                                                    >
                                                        {hidden ? "Show" : "Hide"}
                                                    </button>
                                                </label>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <p className="text-sm text-gray-500">
                                        Loading leagues... (requires a valid session)
                                    </p>
                                )}
                            </div>
                        </Card>
                    </div>
                )}

                {toast ? (
                    <div
                        className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-black px-4 py-2 text-sm text-white shadow-lg">
                        {toast}
                    </div>
                ) : null}
            </div>

            <footer className="w-full border-t border-gray-200 bg-white py-8 mt-10">
                <div className="mx-auto max-w-4xl px-4 text-center">
                    <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">
                        Legal Disclaimer
                    </p>
                    <p className="text-xs leading-relaxed text-gray-500">
                        This add-on is an unofficial tool and is not affiliated with, endorsed by, or
                        associated with Paramount Global or its subsidiaries. It is intended for
                        personal use only. Users are responsible for ensuring they have a valid
                        subscription to the service. We do not host or provide any media content;
                        this tool simply acts as a proxy for legitimate API requests. As described in the Paramount terms and conditions,
                        using proxy services is considered abuse. Use of this software is at the sole discretion of the user,
                        and we assume no responsibility for its use or any repercussions on the account used.
                    </p>
                    <div className="mt-2">
                        <a href="https://github.com/RioNoir/paramount-stremio"
                            className="text-xs text-purple-900 hover:underline">
                            Source Code
                        </a>
                        <span className="mx-2 text-gray-300">•</span>
                        <a href="https://buymeacoffee.com/rionoir"
                            className="text-xs text-purple-900 hover:underline">
                            Buy me a coffee
                        </a>
                    </div>
                </div>
            </footer>
        </div>
    );
}
