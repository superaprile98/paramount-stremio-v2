import packageInfo from "@/package.json";
import { ParamountSession, ParamountClient } from "@/lib/paramount/client";
import { getSportLeagues } from "@/lib/paramount/sports";

/**
 * Costruisce il manifest Stremio per una session Paramount+ valida.
 * Riutilizzato da /api/stremio/[key]/manifest.json e /api/install/[token].
 *
 * Vista sports-only con due cataloghi:
 *  - "Live e Prossimi" (slider home): live+upcoming delle 4 leghe curate,
 *    raggruppati per lega nell'ordine fisso Serie A → Champions → Europa
 *    → Conference.
 *  - "Sport": dropdown genre con tutte le leghe (Serie A, Champions, UFC,
 *    NFL, ...). Ogni categoria mostra prima gli eventi live e poi gli
 *    upcoming in ordine di orario.
 *
 * I replay Paramount+ sono DASH Widevine (DRM) e non riproducibili su
 * Stremio, quindi restano esclusi; live e DVR "From Start" sono HLS AES-128
 * e funzionano su tutti i client.
 */
export async function buildManifest(session: ParamountSession, baseUrl: string): Promise<object> {
    // Unico dropdown: "Tutte" (default) + tutte le leghe disponibili.
    let leagueOptions: string[] = [];
    try {
        const leagues = await getSportLeagues(session);
        leagueOptions = leagues.map((l) => l.name);
    } catch {
        // Se la chiamata fallisce, il dropdown resta con la sola opzione "Tutte".
    }

    const sportExtra = [
        {
            name: "genre",
            isRequired: true,
            options: ["Tutte", ...leagueOptions],
        },
        { name: "search" },
        { name: "skip" },
    ];

    const catalogs: any[] = [
        {
            // Slider home: live+upcoming delle 4 leghe curate, raggruppati
            // per lega (Serie A → Champions → Europa → Conference).
            type: "sport",
            id: "pplus_sports_home",
            name: "Live e Prossimi",
            extra: [{ name: "search" }, { name: "skip" }],
        },
        {
            type: "sport",
            id: "pplus_sports",
            name: "Sport",
            extra: sportExtra,
        },
    ];

    const cleanBaseUrl = baseUrl.replace(/\/$/, "");
    const logo = `${cleanBaseUrl}/icon.png`;
    const background = `${cleanBaseUrl}/fanart.png`;

    return {
        id: "org.pplus.stremio",
        version: packageInfo.version,
        name: "Paramount+",
        description: `Unofficial Paramount+ Addon for Stremio. (Profile ID: ${session.profileId})`,
        logo,
        background,
        resources: ["catalog", "meta", "stream"],
        types: ["movie", "series", "tv", "sport"],
        idPrefixes: ["pplus:"],
        catalogs,
    };
}