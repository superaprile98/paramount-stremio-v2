import { NextResponse } from 'next/server';
import { httpClient } from '@/lib/http/client';
import { loadCreds } from '@/lib/vpn/storage';
import { readCurrentConfig } from '@/lib/vpn/gluetun';

/**
 * GET /api/vpn/status
 *   Ritorna lo stato corrente:
 *   - config VPN/proxy persistito su disco (wireguard .conf, oppure proxy URL)
 *   - stato di tutti i proxy attivi (score, alive/blocked/...)
 *   - credenziali cifrate (metadata, mai il contenuto!)
 */
export async function GET() {
    try {
        const [proxies, current, creds] = await Promise.all([
            Promise.resolve(httpClient.getProxyStatus()),
            readCurrentConfig(),
            loadCreds<{ mode: string; serverCode?: string; proxyUrl?: string; updatedAt?: string }>(),
        ]);
        const summary = {
            count: proxies.length,
            alive: proxies.filter(p => p.status === 'alive').length,
            blocked: proxies.filter(p => p.status === 'blocked').length,
            throttled: proxies.filter(p => p.status === 'throttled').length,
            dead: proxies.filter(p => p.status === 'dead').length,
            unknown: proxies.filter(p => p.status === 'unknown').length,
        };
        // Maschera qualsiasi URL con credenziali.
        const maskedProxies = proxies.map(p => ({
            ...p,
            url: p.url.replace(/:[^:@/]+@/, ':***@'),
        }));
        const maskedCreds = creds ? {
            mode: creds.mode,
            serverCode: creds.serverCode,
            proxyUrl: creds.proxyUrl ? creds.proxyUrl.replace(/:[^:@/]+@/, ':***@') : undefined,
            updatedAt: creds.updatedAt,
        } : null;
        return NextResponse.json({
            ok: true,
            summary,
            proxies: maskedProxies,
            config: current,
            savedCreds: maskedCreds,
        });
    } catch (err: any) {
        return NextResponse.json(
            { ok: false, error: err?.message || String(err) },
            { status: 500 },
        );
    }
}
