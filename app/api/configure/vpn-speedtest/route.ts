import { NextRequest, NextResponse } from "next/server";
import axios from "axios";
import { ProxyAgent } from "proxy-agent";
import { requireConfigureUser } from "@/lib/auth/configure-auth";
import { getUserProxyUrl } from "@/lib/vpn/user-proxy";
import { loadUserVpnStore, saveUserVpnStore } from "@/lib/vpn/user-storage";
import {
    DOWNLOAD_BYTES,
    PHASE_TIMEOUT_MS,
    UPLOAD_BYTES,
    gradeSpeed,
    type SpeedTestResult,
} from "@/lib/vpn/speedtest";

/**
 * POST /api/configure/vpn-speedtest — body { id? } (default: voce attiva).
 *
 * Misura latenza/download/upload ATTRAVERSO il tunnel dedicato dell'utente
 * (l'inbound sing-box associato alla voce attiva). Salva il risultato sulla
 * voce (`lastSpeedTest`) così il voto resta visibile anche dopo lo switch.
 *
 * Nota: il test funziona solo sulla voce ATTIVA (solo quella ha un outbound
 * attivo nella config sing-box multi-tenant).
 */

const CF_BASE = "https://speed.cloudflare.com";

function makeAgent(proxyUrl: string): ProxyAgent {
    return new ProxyAgent({ getProxyForUrl: () => proxyUrl });
}

async function measureLatency(agent: ProxyAgent): Promise<number> {
    const start = process.hrtime.bigint();
    await axios.get(`${CF_BASE}/__down?bytes=0`, {
        httpAgent: agent,
        httpsAgent: agent,
        proxy: false,
        timeout: 10000,
        validateStatus: () => true,
    });
    return Number(process.hrtime.bigint() - start) / 1e6;
}

async function measureDownload(agent: ProxyAgent): Promise<number> {
    const start = process.hrtime.bigint();
    let bytes = 0;
    const resp = await axios.get(`${CF_BASE}/__down?bytes=${DOWNLOAD_BYTES}`, {
        httpAgent: agent,
        httpsAgent: agent,
        proxy: false,
        timeout: PHASE_TIMEOUT_MS,
        responseType: "stream",
        validateStatus: () => true,
    });
    if (resp.status !== 200) throw new Error(`download upstream ${resp.status}`);

    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            resp.data.destroy();
            resolve();
        }, PHASE_TIMEOUT_MS);
        resp.data.on("data", (chunk: Buffer) => { bytes += chunk.length; });
        resp.data.on("end", () => { clearTimeout(timer); resolve(); });
        resp.data.on("error", (err: Error) => {
            clearTimeout(timer);
            if (bytes > 0) resolve(); // fallimento parziale: usa i byte già ricevuti
            else reject(err);
        });
    });

    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    return (bytes * 8) / seconds / 1e6;
}

async function measureUpload(agent: ProxyAgent): Promise<number> {
    const payload = Buffer.alloc(UPLOAD_BYTES, 0x61);
    const start = process.hrtime.bigint();
    try {
        await axios.post(`${CF_BASE}/__up`, payload, {
            httpAgent: agent,
            httpsAgent: agent,
            proxy: false,
            timeout: PHASE_TIMEOUT_MS,
            maxBodyLength: Infinity,
            validateStatus: () => true,
        });
    } catch {
        return 0; // alcuni tunnel bloccano POST grandi: upload non misurabile
    }
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    return (UPLOAD_BYTES * 8) / seconds / 1e6;
}

export async function POST(req: NextRequest) {
    const auth = await requireConfigureUser(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const store = await loadUserVpnStore(auth.userId);
    const id = String((body as any)?.id || store.activeId || "");
    const entry = store.servers.find((s) => s.id === id);
    if (!entry) return NextResponse.json({ ok: false, error: "voce non trovata" }, { status: 404 });
    if (entry.id !== store.activeId) {
        return NextResponse.json({ ok: false, error: "Solo la voce attiva ha un tunnel: attivala prima di testarla" }, { status: 400 });
    }

    const proxyUrl = getUserProxyUrl(auth.userId);
    if (!proxyUrl) {
        return NextResponse.json({ ok: false, error: "Nessun tunnel attivo per il tuo utente" }, { status: 400 });
    }

    const agent = makeAgent(proxyUrl);
    const result: SpeedTestResult = {
        at: new Date().toISOString(),
        downMbps: 0,
        upMbps: 0,
        latencyMs: 0,
        grade: "scarsa",
    };

    try {
        result.latencyMs = Math.round(await measureLatency(agent));
        result.downMbps = Math.round((await measureDownload(agent)) * 10) / 10;
        result.upMbps = Math.round((await measureUpload(agent)) * 10) / 10;
        result.grade = gradeSpeed(result.downMbps, result.latencyMs);
    } catch (err: any) {
        result.error = err?.message || String(err);
        result.grade = "scarsa";
    }

    // Persisti il risultato sulla voce
    entry.lastSpeedTest = result;
    await saveUserVpnStore(auth.userId, store);

    return NextResponse.json({ ok: true, id: entry.id, result, proxyUrl });
}