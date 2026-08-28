import { NextRequest, NextResponse } from 'next/server';
import { fetchSubscription } from '@/lib/vpn/singbox';

/**
 * POST /api/vpn/preview
 *   Scarica e parsa una subscription URL SENZA salvarla (anteprima).
 *
 * Body: { subscriptionUrl: string }
 * Risposta: { ok, servers: [{ tag, protocol, host, port }], count }
 *
 * Utile per la UI /configure: l'utente incolla l'URL, clicca "Fetch servers"
 * e vede la lista dei server prima di salvare.
 */
export async function POST(req: NextRequest) {
    let body: any;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
    }
    const subscriptionUrl = String(body?.subscriptionUrl || '').trim();
    if (!subscriptionUrl || !/^https?:\/\//i.test(subscriptionUrl)) {
        return NextResponse.json(
            { ok: false, error: 'subscriptionUrl deve essere un URL http(s):// valido' },
            { status: 400 },
        );
    }
    try {
        const servers = await fetchSubscription(subscriptionUrl);
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