/**
 * Riscrittura di manifest DASH (MPD) per instradare i segmenti e le licenze
 * attraverso il proxy interno dell'add-on.
 *
 * Gestisce:
 *  - <BaseURL> (assoluti e relativi)
 *  - <SegmentTemplate media=... initialization=...>
 *  - <SegmentList><SegmentURL media=...>
 *  - <ms:laurl> / <dashif:laurl> (URL licenza Widevine)
 */

function resolveRef(ref: string, upstreamUrl: URL): string {
    const trimmed = ref.trim();
    if (!trimmed) return ref;
    try {
        return new URL(trimmed, upstreamUrl).toString();
    } catch {
        return ref;
    }
}

export function rewriteMpd(params: {
    text: string;
    upstreamUrl: URL;
    baseOrigin: string;
    sid: string;
}): string {
    const { text, upstreamUrl, baseOrigin, sid } = params;

    const toProxy = (absUrl: string, route: "seg" | "license" = "seg") => {
        const u = new URL(`${baseOrigin}/api/proxy/${sid}/${route}`);

        // I placeholder DASH ($Number$, $Time$, $RepresentationID$, ...) devono
        // restare LEGGIBILI nell'URL: è il player a sostituirli prima della
        // richiesta. Se finissero dentro il base64 di `u` la sostituzione non
        // avverrebbe e il CDN risponderebbe 404. Si splitta quindi al primo `$`:
        // il prefisso va in `u` (base64), il resto in `s` (con `$` letterale).
        const dollarIdx = route === "seg" ? absUrl.indexOf("$") : -1;
        if (dollarIdx !== -1) {
            const prefix = absUrl.slice(0, dollarIdx);
            const templatePart = absUrl.slice(dollarIdx);
            u.searchParams.set("u", Buffer.from(prefix).toString("base64url"));
            // encodeURIComponent per sicurezza, ma `$` deve restare letterale
            const encoded = encodeURIComponent(templatePart).replace(/%24/g, "$");
            return `${u.toString()}&s=${encoded}`;
        }

        u.searchParams.set("u", Buffer.from(absUrl).toString("base64url"));
        return u.toString();
    };

    let out = text;

    // URL del proxy licenze, usato per iniettare <ms:laurl> nel ContentProtection
    const licenseProxyUrl = `${baseOrigin}/api/proxy/${sid}/license`;

    // <BaseURL>...</BaseURL>
    out = out.replace(/<BaseURL>([^<]+)<\/BaseURL>/g, (_m, ref: string) => {
        return `<BaseURL>${toProxy(resolveRef(ref, upstreamUrl))}</BaseURL>`;
    });

    // <SegmentTemplate ... media="..." ...>
    out = out.replace(
        /(<SegmentTemplate[^>]*\bmedia=")([^"]+)(")/g,
        (_m, pre: string, ref: string, post: string) => {
            return `${pre}${toProxy(resolveRef(ref, upstreamUrl))}${post}`;
        }
    );

    // <SegmentTemplate ... initialization="..." ...>
    out = out.replace(
        /(<SegmentTemplate[^>]*\binitialization=")([^"]+)(")/g,
        (_m, pre: string, ref: string, post: string) => {
            return `${pre}${toProxy(resolveRef(ref, upstreamUrl))}${post}`;
        }
    );

    // <SegmentURL ... media="..." ...>
    out = out.replace(
        /(<SegmentURL[^>]*\bmedia=")([^"]+)(")/g,
        (_m, pre: string, ref: string, post: string) => {
            return `${pre}${toProxy(resolveRef(ref, upstreamUrl))}${post}`;
        }
    );

    // <ms:laurl>...</ms:laurl> e <dashif:laurl>...</dashif:laurl>
    out = out.replace(
        /(<(?:ms|dashif):laurl[^>]*>)([^<]+)(<\/)/g,
        (_m, pre: string, ref: string, post: string) => {
            return `${pre}${toProxy(resolveRef(ref, upstreamUrl), "license")}${post}`;
        }
    );

    // Se c'è un ContentProtection Widevine ma nessun laurl esplicito,
    // il player (ExoPlayer/Stremio desktop) proverebbe a contattare il
    // license server dal PSSH (geo-bloccato). Iniettiamo un laurl che
    // punta al proxy dell'addon.
    const hasLaurl = /<(?:ms|dashif):laurl/.test(out);
    if (!hasLaurl && out.includes('urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed')) {
        out = out.replace(
            /(<ContentProtection[^>]*urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed[^>]*>)/g,
            `$1<ms:laurl xmlns:ms="urn:microsoft">${licenseProxyUrl}</ms:laurl>`
        );
    }

    return out;
}