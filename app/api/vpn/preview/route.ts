import { NextRequest, NextResponse } from 'next/server';
import { fetchSubscription } from '@/lib/vpn/singbox';
import { parseConfigText } from '@/lib/vpn/share-links';

/**
 * POST /api/vpn/preview
 *   Anteprima dei server da una subscription URL o da una config incollata,
 *   SENZA salvarla.
 *
 * Body: { subscriptionUrl?: string, rawConfig?: string }
 * Risposta: { ok, servers: [{ tag, protocol, host, port }], count }
 *
 * Utile per la UI /configure: l'utente incolla l'URL (o la config), clicca
 * "Fetch servers" e vede la lista dei server prima di salvare.
 */
export async function POST(req: NextRequest) {
    let body: any;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
    }
    const subscriptionUrl = String(body?.subscriptionUrl || '').trim();
    const rawConfig = String(body?.rawConfig || '').trim();

    let servers;
    try {
        if (rawConfig) {
            servers = parseConfigText(rawConfig);
            if (servers.length === 0) {
                return NextResponse.json(
                    { ok: false, error: 'Config non valida: nessun server riconosciuto (Xray JSON o share-link)' },
                    { status: 400 },
                );
            }
        } else if (subscriptionUrl && /^https?:\/\//i.test(subscriptionUrl)) {
            servers = await fetchSubscription(subscriptionUrl);
        } else {
            return NextResponse.json(
                { ok: false, error: 'Fornire subscriptionUrl (http(s)://) o rawConfig (JSON Xray / share-link)' },
                { status: 400 },
            );
        }
        return NextResponse.json({
            ok: true,
            count: servers.length,
            servers: servers.map(s => ({
                tag: s.tag,
                protocol: s.protocol,
                host: s.host,
                port: s.port,
            })),
        });
    } catch (err: any) {
        return NextResponse.json(
            { ok: false, error: err?.message || String(err) },
            { status: 500 },
        );
    }
}