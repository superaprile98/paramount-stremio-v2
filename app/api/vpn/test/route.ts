import { NextRequest, NextResponse } from 'next/server';
import { testConnection, quickTest, ProbeResult } from '@/lib/vpn/probe';

/**
 * GET /api/vpn/test
 *   Test rapido sul primo proxy alive. Ritorna { ok, ip, country, vpnDetected, ... }.
 *
 * POST /api/vpn/test
 *   Body: { proxyUrl?: string } — se specificato testa solo quel proxy.
 *         Altrimenti testa TUTTI i proxy configurati in parallelo.
 *   Ritorna: array di ProbeResult.
 */
export async function GET() {
    try {
        const result = await quickTest();
        return NextResponse.json({ ok: true, result });
    } catch (err: any) {
        return NextResponse.json(
            { ok: false, error: err?.message || String(err) },
            { status: 500 },
        );
    }
}

export async function POST(req: NextRequest) {
    let body: any = {};
    try {
        body = await req.json();
    } catch {
        // body vuoto va bene per il quickTest
    }
    try {
        const proxyUrl = body?.proxyUrl === undefined ? undefined : (body.proxyUrl ? String(body.proxyUrl) : null);
        const results: ProbeResult[] = await testConnection(proxyUrl);
        const allOk = results.every(r => r.ok);
        return NextResponse.json({
            ok: allOk,
            count: results.length,
            results,
        });
    } catch (err: any) {
        return NextResponse.json(
            { ok: false, error: err?.message || String(err) },
            { status: 500 },
        );
    }
}
