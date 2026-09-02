import { NextRequest, NextResponse } from "next/server";
import { requireConfigureUser } from "@/lib/auth/configure-auth";
import { loadUserVpnStore, saveUserVpnStore, newServerId, type VpnServerEntry } from "@/lib/vpn/user-storage";
import { fetchFreeSources } from "@/lib/vpn/free-sources";
import { reconfigureAllVpns, ensureUserPort } from "@/lib/vpn/reconfigure";

/**
 * POST /api/configure/free-sources
 *
 * Recupera una lista di share-link VLESS da una "free source" pubblica
 * (default openproxylist.com), crea un singolo VpnServerEntry di tipo
 * "shareLink" multiplo (un input con tutti i link concatenati da \n) e lo
 * salva nello store utente. Lo attiva come default se è il primo server.
 *
 * L'input è una stringa con tutti i share-link separati da \n, così il
 * flusso esistente (vpn-switch → parseShareLink o parseConfigText) continua
 * a funzionare senza modifiche.
 *
 * Body: { country?: 'US'|'DE'|..., label?: string, force?: boolean }
 */

export async function POST(req: NextRequest) {
    const auth = await requireConfigureUser(req);
    if (!auth) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    let body: { country?: string; label?: string; force?: boolean } = {};
    try { body = await req.json(); } catch { /* empty */ }
    const country = (body.country || 'US').toUpperCase();

    const store = await loadUserVpnStore(auth.userId);
    const alreadyHas = store.servers.some((s) => s.autoProvisioned);
    if (alreadyHas && !body.force) {
        return NextResponse.json({ ok: true, skipped: true, message: "Sorgente gratuita già presente (usa force=true per aggiornarla)" });
    }

    let result;
    try {
        result = await fetchFreeSources({ country, minQuality: 2, maxEntries: 12 });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: "fetch_failed", message: e?.message ?? "Impossibile raggiungere la sorgente libera" }, { status: 502 });
    }
    if (result.entries.length === 0) {
        return NextResponse.json({ ok: false, error: "no_servers", message: `Nessun server ${country} trovato nella sorgente libera`, total: result.totalRaw });
    }

    // Concateniamo i singoli share-link separati da \n, così parseConfigText
    // (usato da vpn-switch) li parsa tutti e li ritorna come ParsedServer[].
    const rawInput = result.entries.map((e) => e.server.raw).filter(Boolean).join('\n');
    const label = body.label || `OpenProxy ${country} (${result.entries.length} nodi)`;

    const entry: VpnServerEntry = {
        id: newServerId(),
        label,
        kind: 'shareLink',
        input: rawInput,
        serverTag: `free-${country.toLowerCase()}`,
        addedAt: new Date().toISOString(),
        // Cache dei server risolti per non rifare parseConfigText al primo switch
        resolvedServers: result.entries.map((e) => e.server),
        autoProvisioned: true,
        lastDelayTest: undefined,
    };

    // Rimuovi eventuali entry auto-provisionate precedenti
    store.servers = store.servers.filter((s) => !s.autoProvisioned);
    store.servers.push(entry);
    // Se l'utente non ha ancora un attivo, imposta questo come attivo
    if (!store.activeId) store.activeId = entry.id;
    await saveUserVpnStore(auth.userId, store);

    // Alloca porta e rigenera la config sing-box multi-tenant
    try {
        ensureUserPort(auth.userId);
        await reconfigureAllVpns();
    } catch (e) {
        console.error('[free-sources] reconfigureAllVpns failed:', e);
    }

    return NextResponse.json({
        ok: true,
        entry: {
            id: entry.id,
            label: entry.label,
            count: result.entries.length,
            country,
            quality: result.entries[0].quality,
        },
        totals: { raw: result.totalRaw, kept: result.entries.length, filtered: result.filtered },
        source: result.source,
    });
}

/**
 * GET /api/configure/free-sources
 *
 * Restituisce lo stato della sorgente gratuita per l'utente autenticato:
 *   { hasAutoProvisioned: boolean, lastFetched: string|null, count: number|null }
 *
 * Usato dalla UI per sapere se mostrare il bottone "Aggiorna sorgente gratuita".
 */
export async function GET(req: NextRequest) {
    const auth = await requireConfigureUser(req);
    if (!auth) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const store = await loadUserVpnStore(auth.userId);
    const entry = store.servers.find((s) => s.autoProvisioned);
    return NextResponse.json({
        ok: true,
        hasAutoProvisioned: !!entry,
        lastFetched: entry?.addedAt ?? null,
        count: entry?.resolvedServers?.length ?? null,
        label: entry?.label ?? null,
    });
}