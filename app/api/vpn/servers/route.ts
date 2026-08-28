import { NextResponse } from 'next/server';
import { readServersCache } from '@/lib/vpn/singbox';

/**
 * GET /api/vpn/servers
 *   Ritorna la lista dei server disponibili:
 *   - Se è attiva una config VLESS (sing-box): i server parsati dalla
 *     subscription (cache servers.json), con tag/protocol/host/port.
 *   - Altrimenti (legacy): i country code ISO supportati da gluetun per la
 *     selezione server ProtonVPN.
 *   Public endpoint (no auth) — sono solo label/country code / metadata.
 */
export async function GET() {
    const vless = await readServersCache();
    if (vless && Array.isArray(vless.servers) && vless.servers.length > 0) {
        return NextResponse.json({
            ok: true,
            kind: 'vless',
            serverTag: vless.serverTag,
            updatedAt: vless.updatedAt,
            servers: vless.servers,
            countries: [],
        });
    }
    return NextResponse.json({
        ok: true,
        kind: 'none',
        servers: [],
        countries: [],
    });
}
