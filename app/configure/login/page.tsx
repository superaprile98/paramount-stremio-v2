"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Login per l'area riservata: pagina volutamente neutra, senza indizi
 * sul servizio dietro. Credenziali da env (CONFIG_CREDENTIALS o
 * CONFIG_USER/CONFIG_PASSWORD). Al successo imposta il cookie di
 * sessione (via API) e reindirizza alla UI.
 */
export default function ConfigureLoginPage() {
    const router = useRouter();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    // Reindirizza subito se la sessione è già valida; la verifica di
    // configurazione lato server non viene esposta all'utente.
    useEffect(() => {
        fetch("/api/configure/session")
            .then((r) => r.json())
            .then((s) => {
                if (s.authenticated) router.replace("/configure");
            })
            .catch(() => { /* silenzioso */ });
    }, [router]);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
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
                setError("Credenziali non valide");
                return;
            }
            router.replace("/configure");
        } catch {
            setError("Servizio non disponibile");
        } finally {
            setLoading(false);
        }
    }

    return (
        <main className="min-h-screen flex items-center justify-center bg-gray-950 px-4">
            <div className="w-full max-w-sm">
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl">
                    <div className="flex justify-center mb-4">
                        <div className="h-10 w-10 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center">
                            <svg className="h-5 w-5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                                <rect x="4" y="10" width="16" height="10" rx="2" />
                                <path d="M8 10V7a4 4 0 118 0v3" />
                            </svg>
                        </div>
                    </div>
                    <h1 className="text-base font-semibold text-gray-200 text-center mb-1">Area riservata</h1>
                    <p className="text-xs text-gray-500 text-center mb-6">Accesso con credenziali personali</p>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label htmlFor="username" className="sr-only">Nome utente</label>
                            <input
                                id="username"
                                type="text"
                                autoComplete="username"
                                placeholder="Nome utente"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                required
                                className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-600"
                            />
                        </div>
                        <div>
                            <label htmlFor="password" className="sr-only">Password</label>
                            <input
                                id="password"
                                type="password"
                                autoComplete="current-password"
                                placeholder="Password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-600"
                            />
                        </div>

                        {error && (
                            <p className="text-sm text-red-400 text-center" role="alert">
                                {error}
                            </p>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full rounded-lg bg-gray-200 hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold text-gray-900"
                        >
                            {loading ? "…" : "Accedi"}
                        </button>
                    </form>
                </div>
                <p className="mt-4 text-center text-[11px] text-gray-700">Uso personale</p>
            </div>
        </main>
    );
}