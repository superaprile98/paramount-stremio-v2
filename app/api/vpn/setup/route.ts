import { NextRequest, NextResponse } from 'next/server';
import { setProxyUrls, getProxyUrls } from '@/lib/http/client';
import {
    buildVpnConfigFromText,
    buildVpnConfigFromKey,
    writeWireguardConfig,
    clearConfig,
} from '@/lib/vpn/gluetun';
import { saveCreds } from '@/lib/vpn/storage';

/**
 * POST /api/vpn/setup
 *
 * Body: uno dei tre formati:
 *   { mode: 'wireguard-conf', confText: string, serverCode?: string }
 *   { mode: 'wireguard-key',  privateKey: string, serverCode: string }
 *   { mode: 'proxy',          url: string }
 *   { mode: 'clear' }   → rimuove VPN e torna a PROXY_URLS default
 *
 * Effetti:
 *   - Scrive il config WireGuard (se mode è wireguard-*) sul volume.
 *   - Aggiorna process.env.PROXY_URLS con il proxy di gluetun (o il proxy
 *     HTTP esterno) e ricostruisce lo stato del round-robin.
 *   - Salva le creds cifrate (per idempotenza e per il restart dell'addon).
 *
 * NOTA: il restart del container gluetun NON è fatto qui. Viene triggerato
 * dallo script `scripts/restart-gluetun.sh` sull'host che osserva la
 * modifica del file .conf (via inotify o un cron @reboot + al boot).
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
            // Reset PROXY_URLS a "http://gluetun:8888" (default fallback) — l'utente
            // può poi settare esplicitamente un altro proxy via /api/vpn/setup.
            const defaults = process.env.HTTP_PROXY || 'http://gluetun:8888';
            setProxyUrls([defaults]);
            await saveCreds({ mode: 'none', updatedAt: new Date().toISOString() });
            return NextResponse.json({
                ok: true,
                message: 'VPN config rimossa. PROXY_URLS resettato al default.',
                proxyUrls: getProxyUrls(),
            });
        }

        if (mode === 'wireguard-conf') {
            const confText = String(body.confText || '').trim();
            const serverCode = body.serverCode ? String(body.serverCode) : undefined;
            if (!confText) {
                return NextResponse.json({ ok: false, error: 'confText required' }, { status: 400 });
            }
            const vpn = buildVpnConfigFromText(confText, serverCode);
            const paths = await writeWireguardConfig(vpn);
            // Aggiorna proxy runtime → usa il tunnel gluetun.
            const proxyUrl = 'http://gluetun:8888';
            setProxyUrls([proxyUrl]);
            await saveCreds({
                mode: 'wireguard',
                serverCode: vpn.server.code,
                privateKey: vpn.privateKey,
                address: vpn.address,
                updatedAt: new Date().toISOString(),
            });
            return NextResponse.json({
                ok: true,
                message: `Config WireGuard scritto per ${vpn.server.code}. Gluetun verrà riavviato automaticamente.`,
                config: {
                    kind: 'wireguard',
                    server: vpn.server,
                    privateKeyMasked: vpn.privateKey.slice(0, 4) + '…' + vpn.privateKey.slice(-4),
                    paths,
                },
                proxyUrls: getProxyUrls(),
                note: 'Esegui sul host: bash scripts/restart-gluetun.sh (oppure riavvia il container con --profile vpn)',
            });
        }

        if (mode === 'wireguard-key') {
            const privateKey = String(body.privateKey || '').trim();
            const serverCode = String(body.serverCode || '').trim();
            if (!privateKey || !serverCode) {
                return NextResponse.json(
                    { ok: false, error: 'privateKey and serverCode required' },
                    { status: 400 },
                );
            }
            const vpn = buildVpnConfigFromKey(privateKey, serverCode);
            const paths = await writeWireguardConfig(vpn);
            const proxyUrl = 'http://gluetun:8888';
            setProxyUrls([proxyUrl]);
            await saveCreds({
                mode: 'wireguard',
                serverCode: vpn.server.code,
                privateKey: vpn.privateKey,
                address: vpn.address,
                updatedAt: new Date().toISOString(),
            });
            return NextResponse.json({
                ok: true,
                message: `Config WireGuard generato per ${vpn.server.code}.`,
                config: {
                    kind: 'wireguard',
                    server: vpn.server,
                    privateKeyMasked: vpn.privateKey.slice(0, 4) + '…' + vpn.privateKey.slice(-4),
                    paths,
                },
                proxyUrls: getProxyUrls(),
                note: 'Esegui sul host: bash scripts/restart-gluetun.sh',
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
            // Rimuovi eventuale config WireGuard (vogliamo "solo proxy esterno").
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
            { ok: false, error: `Unknown mode "${mode}". Expected: wireguard-conf | wireguard-key | proxy | clear` },
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
    // GET ritorna la modalità corrente e la lista proxy attiva.
    return NextResponse.json({
        ok: true,
        proxyUrls: getProxyUrls(),
        envProxyUrls: process.env.PROXY_URLS || '',
        envHttpProxy: process.env.HTTP_PROXY || '',
    });
}
