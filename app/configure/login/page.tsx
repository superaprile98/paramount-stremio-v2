"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Login per /configure: credenziali da env (CONFIG_CREDENTIALS o
 * CONFIG_USER/CONFIG_PASSWORD). Al successo imposta il cookie di sessione
 * (via API) e reindirizza a /configure.
 */
export default function ConfigureLoginPage() {
    const router = useRouter();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [configured, setConfigured] = useState<boolean | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        fetch("/api/configure/session")
            .then((r) => r.json())
            .then((s) => {
                setConfigured(s.configured);
                if (s.authenticated) router.replace("/configure");
            })
            .catch(() => setConfigured(false));
    }, [router]);

    return (
        <main className="min-h-screen flex items-center justify-center bg-gray-950 px-4">
            <div className="w-full max-w-sm bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl">
                <h1 className="text-lg font-semibold text-gray-100 mb-1">Area configurazione</h1>
                <p className="text-sm text-gray-400 mb-6">
                    Accedi per gestire VPN (VLESS) e account Paramount+.
                </p>

                {configured === false && (
                    <div className="mb-4 rounded-lg bg-red-950/60 border border-red-800 px-3 py-2 text-sm text-red-200">
                        Auth non configurata sul server: impostare <code>CONFIG_CREDENTIALS</code> (oppure{" "}
                        <code>CONFIG_USER</code> / <code>CONFIG_PASSWORD</code>) nel file <code>.env</code>.
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label htmlFor="username" className="block text-xs font-medium text-gray-400 mb-1">
                            Username
                        </label>
                        <input
                            id="username"
                            type="text"
                            autoComplete="username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            required
                            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                    </div>
                    <div>
                        <label htmlFor="password" className="block text-xs font-medium text-gray-400 mb-1">
                            Password
                        </label>
                        <input
                            id="password"
                            type="password"
                            autoComplete="current-password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                    </div>

                    {error && (
                        <p className="text-sm text-red-400" role="alert">
                            {error}
                        </p>
                    )}

                    <button
                        type="submit"
                        disabled={loading || configured === false}
                        className="w-full rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold text-white"
                    >
                        {loading ? "Accesso…" : "Accedi"}
                    </button>
                </form>
            </div>
        </main>
    );

    async function handleSubmit() {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch("/api/configure/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.ok) {
                setError(data?.error || "Login fallito");
                return;
            }
            router.replace("/configure");
        } catch {
            setError("Errore di rete");
        } finally {
            setLoading(false);
        }
    }
}