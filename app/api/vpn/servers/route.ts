import { NextResponse } from 'next/server';
import { listProtonServers } from '@/lib/vpn/wireguard';

/**
 * GET /api/vpn/servers
 *   Ritorna la lista dei server ProtonVPN conosciuti (per il dropdown UI).
 *   Public endpoint (no auth) — sono dati pubblici da config Proton ufficiali.
 */
export async function GET() {
    return NextResponse.json({
        ok: true,
        servers: listProtonServers(),
    });
}
