export type StremioMeta = {
    id: string;
    type: "tv" | "sport";
    name: string;
    logo?: string;
    poster?: string;
    posterShape?: "poster" | "landscape";
    background?: string;
    description?: string;
    releaseInfo?: string;
    genres?: string[];
};
