export function pplusSportId(listingId: string | number) {
    return `pplus:sport:${listingId}`;
}

export function pplusLiveId(slug: string) {
    return `pplus:live:${slug}`;
}

export function parsePplusId(id: string):
    | { kind: "sport"; key: string }
    | { kind: "live"; key: string }
    | { kind: "unknown"; key: string } {
    const parts = id.split(":");
    if (parts.length >= 3 && parts[0] === "pplus") {
        const kind = parts[1];
        const key = parts.slice(2).join(":");
        if (kind === "sport") return { kind: "sport", key };
        if (kind === "live") return { kind: "live", key };
    }
    return { kind: "unknown", key: id };
}
