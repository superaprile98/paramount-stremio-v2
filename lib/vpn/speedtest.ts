/**
 * Speed test del tunnel VLESS (lato server, attraverso l'inbound dedicato
 * dell'utente): misura latenza, download e upload, con voto sintetico.
 *
 * Endpoint usati (Cloudflare Speed, no auth):
 *  - latenza: https://speed.cloudflare.com/__down?bytes=0 (TTFB)
 *  - download: https://speed.cloudflare.com/__down?bytes=N
 *  - upload:   https://speed.cloudflare.com/__up
 */

export interface SpeedTestResult {
    at: string;
    /** Mbps download. */
    downMbps: number;
    /** Mbps upload (0 se il test upload è fallito: alcuni proxy bloccano POST lunghi). */
    upMbps: number;
    /** Latenza ms (TTFB su richiesta piccola). */
    latencyMs: number;
    /** Voto sintetico: ottima | buona | discreta | scarsa. */
    grade: "ottima" | "buona" | "discreta" | "scarsa";
    error?: string;
}

export const DOWNLOAD_BYTES = 12 * 1024 * 1024; // ~12 MB: abbastanza per stabilizzare la misura
export const UPLOAD_BYTES = 4 * 1024 * 1024;    // ~4 MB

/** Durata massima di ogni fase (ms): il test non deve bloccare la UI per minuti. */
export const PHASE_TIMEOUT_MS = 20000;

/** Voto sintetico in base a banda e latenza (soglie pensate per HLS 1080p ~6 Mbps). */
export function gradeSpeed(downMbps: number, latencyMs: number): SpeedTestResult["grade"] {
    if (downMbps >= 25 && latencyMs <= 150) return "ottima";
    if (downMbps >= 12 && latencyMs <= 250) return "buona";
    if (downMbps >= 6) return "discreta";
    return "scarsa";
}

export function formatGrade(grade: SpeedTestResult["grade"]): string {
    switch (grade) {
        case "ottima": return "🏆 Ottima";
        case "buona": return "✅ Buona";
        case "discreta": return "⚠️ Discreta";
        case "scarsa": return "❌ Scarsa";
    }
}
