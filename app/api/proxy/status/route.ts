import { NextRequest, NextResponse } from 'next/server';
import { httpClient } from '@/lib/http/client';

/**
 * GET /api/proxy/status
 *   Restituisce lo stato corrente di tutti i proxy configurati.
 *
 * POST /api/proxy/status  (body: { "action": "reprobe" })
 *   Forza un nuovo probe di tutti i proxy.
 *
 * Sicurezza: in produzione si consiglia di limitare l'accesso (es. richiedere
 * un header X-Admin-Token confrontato con process.env.ADMIN_TOKEN). Per ora
 * l'endpoint è pubblico ma non espone dati sensibili (solo URL e stato).
 */
export async function GET() {
    const proxies = httpClient.getProxyStatus();
    const summary = {
        count: proxies.length,
        alive: proxies.filter(p => p.status === 'alive').length,
        blocked: proxies.filter(p => p.status === 'blocked').length,
        throttled: proxies.filter(p => p.status === 'throttled').length,
        dead: proxies.filter(p => p.status === 'dead').length,
        unknown: proxies.filter(p => p.status === 'unknown').length,
    };
    return NextResponse.json({ summary, proxies });
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => ({}));
        if (body?.action === 'reprobe') {
            await httpClient.reprobe();
            return NextResponse.json({ ok: true, action: 'reprobe' });
        }
        return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 });
    }
}
