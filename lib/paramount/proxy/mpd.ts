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
        u.searchParams.set("u", Buffer.from(absUrl).toString("base64url"));
        return u.toString();
    };

    let out = text;

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

    return out;
}