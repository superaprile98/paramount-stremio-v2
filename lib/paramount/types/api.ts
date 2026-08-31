/**
 * Tipi per le risposte API Paramount+ (P15).
 *
 * Le risposte reali variano tra endpoint e versioni: usiamo tipi "best effort"
 * con campi opzionali e accessi difensivi nei mapping. Questi tipi documentano
 * i campi effettivamente consumati dal codebase e danno un minimo di garanzia
 * statica al posto di `any` sparsi.
 */

/** Item di un listing live (canale). */
export interface LiveChannelItem {
    slug?: string;
    channelName?: string;
    channelTypes?: string[];
    filePathLogo?: string;
    description?: string;
    videoContentId?: string;
    contentId?: string;
    brand?: { filePathLogo?: string };
    currentListing?: Array<{
        title?: string;
        description?: string;
        videoContentId?: string;
        contentId?: string;
        [key: string]: unknown;
    }>;
    upcomingListing?: Array<{
        title?: string;
        description?: string;
        videoContentId?: string;
        contentId?: string;
        [key: string]: unknown;
    }>;
    [key: string]: unknown;
}

/** Item di un listing sportivo. */
export interface SportListingItem {
    id?: string | number;
    title?: string;
    description?: string;
    channelName?: string;
    channelSlug?: string;
    filePathLogo?: string;
    videoContentId?: string;
    isListingLive?: boolean;
    startTimestamp?: number;
    streamStartTimestamp?: number;
    endTimestamp?: number;
    streamEndTimestamp?: number;
    league?: { name?: string;[key: string]: unknown };
    [key: string]: unknown;
}

/** Risposta del token di sessione Irdeto (streaming). */
export interface IrdetoSessionToken {
    ls_session?: string;
    url?: string;
    /** Manifest MPD/HLS selezionabile (struttura variabile). */
    [key: string]: unknown;
}

/** Risposta generica con struttura `{ items | itemList | result | ... }`. */
export interface ListResponse<T = unknown> {
    items?: T[];
    itemList?: T[];
    result?: T[];
    channels?: T[];
    listings?: T[];
    data?: {
        items?: T[];
        itemList?: T[];
        channels?: T[];
        listings?: T[];
        data?: { listings?: T[]; channels?: T[];[key: string]: unknown };
        [key: string]: unknown;
    };
    [key: string]: unknown;
}