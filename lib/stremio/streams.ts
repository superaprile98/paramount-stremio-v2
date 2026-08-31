/**
 * Builder per gli oggetti stream serviti a Stremio.
 *
 * Centralizza i default (name, notWebReady) così le route specificano solo
 * ciò che varia davvero: title, url e isLive. Evita i blocchi
 * `streams.push({ ... })` ripetuti e duplicati nelle route.
 */
export interface AddonStream {
    name: string;
    title: string;
    url: string;
    isLive?: boolean;
    notWebReady?: boolean;
    behaviorHints?: Record<string, unknown>;
}

export class StreamBuilder {
    private streamTitle = "";
    private streamUrl = "";
    private streamIsLive = false;
    private streamNotWebReady = false;
    private streamBehaviorHints: Record<string, unknown> | undefined;

    title(t: string): this {
        this.streamTitle = t;
        return this;
    }

    url(u: string | URL): this {
        this.streamUrl = u.toString();
        return this;
    }

    isLive(v = true): this {
        this.streamIsLive = v;
        return this;
    }

    notWebReady(v = true): this {
        this.streamNotWebReady = v;
        return this;
    }

    behaviorHints(hints: Record<string, unknown>): this {
        this.streamBehaviorHints = hints;
        return this;
    }

    build(): AddonStream {
        const stream: AddonStream = {
            name: "Paramount+",
            title: this.streamTitle,
            url: this.streamUrl,
            isLive: this.streamIsLive,
            notWebReady: this.streamNotWebReady,
        };
        if (this.streamBehaviorHints) stream.behaviorHints = this.streamBehaviorHints;
        return stream;
    }
}

/** Shortcut per lo stream HLS standard dell'addon. */
export function hlsStream(title: string, url: string | URL, isLive: boolean): AddonStream {
    return new StreamBuilder().title(title).url(url).isLive(isLive).build();
}
