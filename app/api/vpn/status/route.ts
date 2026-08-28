import { NextResponse } from 'next/server';
import { httpClient } from '@/lib/http/client';
import { loadCreds } from '@/lib/vpn/storage';
import { readCurrentVlessConfig } from '@/lib/vpn/singbox';

/**
 * GET /api/vpn/status
 *   Ritorna lo stato corrente:
 *   - config VPN/proxy persistito su disco (wireguard .conf, gluetun env,
 *     sing-box config.json, oppure proxy URL)
 *   - stato di tutti i proxy attivi (score, alive/blocked/...)
 *   - credenziali cifrate (metadata, mai il contenuto!)
 */
export async function GET() {
    try {
        const [proxies, vless, creds] = await Promise.all([
            Promise.resolve(httpClient.getProxyStatus()),
            readCurrentVlessConfig(),
            loadCreds<{
                mode: string;
                username?: string;
                country?: string;
                serverCode?: string;
                proxyUrl?: string;
                subscriptionUrl?: string;
                serverTag?: string;
                serverCount?: number;
                updatedAt?: string;
            }>(),
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
            username: creds.username
                ? (creds.username.length > 4 ? creds.username.slice(0, 2) + '…' + creds.username.slice(-2) : '***')
                : undefined,
            country: creds.country,
            serverCode: creds.serverCode,
            proxyUrl: creds.proxyUrl ? creds.proxyUrl.replace(/:[^:@/]+@/, ':***@') : undefined,
            subscriptionUrl: creds.subscriptionUrl
                ? creds.subscriptionUrl.replace(/^(\w+:\/\/[^/]+).*$/, '$1/…')
                : undefined,
            serverTag: creds.serverTag,
            serverCount: creds.serverCount,
            updatedAt: creds.updatedAt,
        } : null;
        return NextResponse.json({
            ok: true,
            summary,
            proxies: maskedProxies,
            config: vless,
            savedCreds: maskedCreds,
        });
    } catch (err: any) {
        return NextResponse.json(
            { ok: false, error: err?.message || String(err) },
            { status: 500 },
        );
    }
}
