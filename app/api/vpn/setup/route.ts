import { NextRequest, NextResponse } from 'next/server';
import { setProxyUrls, getProxyUrls } from '@/lib/http/client';
import {
    writeProtonLoginEnv,
    clearConfig,
    PROTON_COUNTRIES,
} from '@/lib/vpn/gluetun';
import { saveCreds } from '@/lib/vpn/storage';

/**
 * POST /api/vpn/setup
 *
 * Body: uno dei formati:
 *   { mode: 'proton-login', username: string, password: string, country?: string }
 *       → scrive env_file OpenVPN per gluetun e imposta PROXY_URLS = http://gluetun:8888
 *   { mode: 'proxy', url: string }
 *       → imposta un proxy HTTP esterno (no VPN tunnel)
 *   { mode: 'clear' }
 *       → rimuove la config VPN/proxy e resetta ai default
 *
 * Effetti:
 *   - Scrive `vpn-data/gluetun.env` (se mode = proton-login) con creds OpenVPN
 *     Proton. Il file viene montato come env_file sul container gluetun.
 *   - Aggiorna process.env.PROXY_URLS con il proxy di gluetun (o il proxy
 *     HTTP esterno) e ricostruisce lo stato del round-robin.
 *   - Salva le creds cifrate (AES-256-GCM via KEY_SECRET) per idempotenza.
 *
 * Auto-restart di gluetun: il file env è bind-mountato sull'host in
 * `vpn-data/gluetun.env`. Una systemd path unit (installata con
 * `scripts/install-gluetun-watcher.sh`) osserva quel file e riavvia
 * automaticamente gluetun ad ogni cambio. Niente SSH richiesto.
 */
export async function POST(req: NextRequest) {
    let body: any;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
    }
    if (!body || typeof body !== 'object') {
        return NextResponse.json({ ok: false, error: 'Missing body' }, { status: 400 });
    }
    const mode = String(body.mode || '');

    try {
        if (mode === 'clear') {
            await clearConfig();
            const defaults = process.env.HTTP_PROXY || 'http://gluetun:8888';
            setProxyUrls([defaults]);
            await saveCreds({ mode: 'none', updatedAt: new Date().toISOString() });
            return NextResponse.json({
                ok: true,
                message: 'VPN/proxy config rimossa. PROXY_URLS resettato al default.',
                proxyUrls: getProxyUrls(),
            });
        }

        if (mode === 'proton-login') {
            const username = String(body.username || '').trim();
            const password = String(body.password || '');
            const countryRaw = String(body.country || 'US').trim().toUpperCase();
            if (!username || !password) {
                return NextResponse.json(
                    { ok: false, error: 'username e password sono obbligatori' },
                    { status: 400 },
                );
            }
            // Validazione country code contro la lista supportata da gluetun.
            const country = PROTON_COUNTRIES.find(c => c.code === countryRaw)?.code || 'US';
            const paths = await writeProtonLoginEnv({
                kind: 'proton-login',
                username,
                password,
                country,
                updatedAt: new Date().toISOString(),
            });
            // Attiva il tunnel gluetun come proxy di uscita.
            setProxyUrls(['http://gluetun:8888']);
            await saveCreds({
                mode: 'proton-login',
                username,
                country,
                updatedAt: new Date().toISOString(),
            });
            const maskedUser = username.length > 4 ? username.slice(0, 2) + '…' + username.slice(-2) : '***';
            return NextResponse.json({
                ok: true,
                message: `Credenziali Proton salvate (utente ${maskedUser}, paese ${country}). Gluetun si riavvierà automaticamente entro ~5s.`,
                config: {
                    kind: 'proton-login',
                    usernameMasked: maskedUser,
                    country,
                    paths,
                },
                proxyUrls: getProxyUrls(),
                countries: PROTON_COUNTRIES,
            });
        }

        if (mode === 'proxy') {
            const url = String(body.url || '').trim();
            if (!url || !/^https?:\/\//i.test(url)) {
                return NextResponse.json(
                    { ok: false, error: 'proxy url must start with http(s)://' },
                    { status: 400 },
                );
            }
            // Rimuovi eventuale config VPN (vogliamo "solo proxy esterno").
            await clearConfig();
            setProxyUrls([url]);
            await saveCreds({
                mode: 'proxy',
                proxyUrl: url,
                updatedAt: new Date().toISOString(),
            });
            return NextResponse.json({
                ok: true,
                message: `Proxy HTTP configurato: ${url.replace(/:[^:@/]+@/, ':***@')}`,
                proxyUrls: getProxyUrls(),
            });
        }

        return NextResponse.json(
            { ok: false, error: `Unknown mode "${mode}". Expected: proton-login | proxy | clear` },
            { status: 400 },
        );
    } catch (err: any) {
        return NextResponse.json(
            { ok: false, error: err?.message || String(err) },
            { status: 500 },
        );
    }
}

export async function GET() {
    return NextResponse.json({
        ok: true,
        proxyUrls: getProxyUrls(),
        envProxyUrls: process.env.PROXY_URLS || '',
        envHttpProxy: process.env.HTTP_PROXY || '',
        countries: PROTON_COUNTRIES,
    });
}
