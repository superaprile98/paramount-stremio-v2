import { NextResponse } from 'next/server';
import { PROTON_COUNTRIES } from '@/lib/vpn/gluetun';

/**
 * GET /api/vpn/servers
 *   Ritorna la lista dei paesi (country code ISO) supportati da gluetun per
 *   la selezione server ProtonVPN nella UI /configure.
 *   Public endpoint (no auth) — sono solo label/country code.
 *
 *   In modalità login (OpenVPN) gluetun seleziona automaticamente il server
 *   migliore per il paese scelto, quindi qui ritorniamo solo i country code.
 */
export async function GET() {
    return NextResponse.json({
        ok: true,
        servers: PROTON_COUNTRIES.map(c => ({
            code: c.code,
            country: c.code,
            city: c.label,
            endpoint: c.label,
            publicKey: '',
        })),
        countries: PROTON_COUNTRIES,
    });
}
