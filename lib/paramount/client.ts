import crypto from "crypto";
import { seal, unseal } from "@/lib/auth/jwe";
import {
    PPLUS_BASE_URL,
    PPLUS_LOCALE_US,
    PPLUS_HEADER,
    getAtToken,
} from "@/lib/paramount/utils";
import { httpClient } from "@/lib/http/client";
import {
    IrdetoSessionToken,
    LiveChannelItem,
    ListResponse,
    SportListingItem,
    VodItem,
} from "@/lib/paramount/types/api";

type ParamountUserProfile = { id: number; isMasterProfile: boolean };
type ParamountUser = { activeProfile: ParamountUserProfile; accountProfiles: ParamountUserProfile[] };

export type ParamountAuthStart = {
    deviceIdRaw: string;
    deviceIdHashed: string;
    activationCode: string;
    deviceToken: string;
    createdAt: string;
};

export type ParamountSession = {
    cookies: string[];
    expiresAt: number;
    profileId?: number | undefined;
};

export class ParamountClient {
    public session: ParamountSession | undefined;

    private async getJson<T>(
        apiPath: string,
        params?: Record<string, any>
    ): Promise<T> {

        const url = new URL(`${PPLUS_BASE_URL}/apps-api${apiPath}`);
        url.searchParams.set("at", getAtToken());
        url.searchParams.set("locale", PPLUS_LOCALE_US);

        if (params) {
            for (const [k, v] of Object.entries(params)) {
                if (v === undefined || v === null) continue;
                url.searchParams.set(k, String(v));
            }
        }

        const debug = process.env.DEBUG_PARAMOUNT === "1";
        if (debug) {
            console.log("[PPLUS] GET", apiPath);
            console.log("[PPLUS] URL", url.toString());
        }

        const userAgent = await PPLUS_HEADER();
        const { status: status, data: json } = await httpClient.get(url.toString(), {
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": userAgent,
                ...(this.session?.cookies?.length ? { Cookie: this.session.cookies.map((c) => c.split(";")[0]).join("; ") } : {}),
            },
        });

        if (status >= 400) {
            // P16: log con contesto completo (URL, status, body troncato).
            console.error(`[PPLUS] GET ${apiPath} returned ${status} (${url.toString()}):`, JSON.stringify(json)?.slice(0, 300));
        }

        if (debug) {
            console.log("[PPLUS] Status", status);
            console.log("[PPLUS] Body first 300", json.toString().slice(0, 300));
        }

        return json as T;
    }

    private async postJson<T>(
        apiPath: string,
        body?: any,
        params?: Record<string, any>
    ): Promise<{ data: T; cookies: string[] }> {

        const url = new URL(`${PPLUS_BASE_URL}/apps-api${apiPath}`);
        url.searchParams.set("at", getAtToken());
        url.searchParams.set("locale", PPLUS_LOCALE_US);

        const bodyJson = body ? JSON.stringify(body) : "{}";

        if (params) {
            for (const [k, v] of Object.entries(params)) {
                if (v === undefined || v === null) continue;
                url.searchParams.set(k, String(v));
            }
        }

        const debug = process.env.DEBUG_PARAMOUNT === "1";
        if (debug) {
            console.log("[PPLUS] POST", apiPath);
            console.log("[PPLUS] URL", url.toString());
            console.log("[PPLUS] BODY", bodyJson);
        }

        const userAgent = await PPLUS_HEADER();
        const { status: status, data: json, cookies: cookies } = await httpClient.post(url.toString(),
            bodyJson,
            {
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "User-Agent": userAgent,
                    ...(this.session?.cookies?.length ? { Cookie: this.session.cookies.map((c) => c.split(";")[0]).join("; ") } : {}),
                },
            });

        if (debug) {
            console.log("[PPLUS] Status", status);
            console.log("[PPLUS] Body first 300", json.toString().slice(0, 300));
        }

        const data = json as T;
        return { data, cookies };
    }

    /** Key session **/
    public async setSessionKey(key: string) {
        if (!key) return null;

        let payload: any;
        try {
            payload = await unseal(key);
        } catch (err) {
            console.error("[session] invalid JWE key");
            return null;
        }

        if (!Array.isArray(payload.cookies) || payload.cookies.length === 0) {
            console.error("[session] missing cookies");
            return null;
        }
        if (typeof payload.expiresAt !== "number") {
            console.error("[session] missing expiresAt");
            return null;
        }
        if (Date.now() > payload.expiresAt) {
            console.warn("[session] session expired");
            return null;
        }

        this.session = {
            cookies: payload.cookies,
            expiresAt: payload.expiresAt,
            profileId: payload.profileId,
        };
    }

    public async setSession(session: ParamountSession) {
        this.session = session;
        if (!this.session.profileId) {
            this.session.profileId = await this.getMasterProfileId();
        }
    }

    public getSession(): ParamountSession | undefined {
        return this.session;
    }

    public async getSessionKey(): Promise<string | null> {
        if (!this.session) {
            console.warn("[session] getSessionKey called without an active session");
            return null;
        }
        return await seal(this.session);
    }

    /** Authentication ***/
    async startDeviceAuth(): Promise<ParamountAuthStart> {
        const deviceIdRaw = crypto.randomBytes(32).toString("hex").slice(0, 16);
        const deviceIdHashed = crypto
            .createHmac("sha1", "eplustv")
            .update(deviceIdRaw)
            .digest("base64")
            .substring(0, 16);

        const params = { deviceId: deviceIdHashed };
        const path = `/v2.0/androidtv/ott/auth/code.json`;

        const { data } = await this.postJson<any>(path, null, params);

        return {
            deviceIdRaw,
            deviceIdHashed,
            activationCode: data.activationCode,
            deviceToken: data.deviceToken,
            createdAt: Date.now().toString(),
        };
    }

    async pollDeviceAuth(start: ParamountAuthStart): Promise<{ ok: boolean; cookies?: string[] }> {
        const params = {
            activationCode: start.activationCode,
            deviceId: start.deviceIdHashed,
            deviceToken: start.deviceToken,
        };
        const path = `/v2.0/androidtv/ott/auth/status.json`;
        try {
            const { data, cookies } = await this.postJson<any>(path, {}, params);
            if (!data.success) return { ok: false };
            if (!cookies.length) throw new Error("Auth success but no set-cookie received");
            return { ok: true, cookies: cookies };
        } catch (err: any) {
            // P16: log contestuale — il poll fallisce spesso (utente non ha ancora
            // completato l'attivazione), ma l'errore non deve essere invisibile.
            console.warn(`[PPLUS] pollDeviceAuth failed: ${err?.message ?? err}`);
            return { ok: false };
        }
    }

    /**
     * Login con username/password via API Paramount+ (apps-api).
     * L'intera richiesta passa attraverso l'HTTP_PROXY configurato (Webshare/VPN),
     * quindi funziona correttamente anche quando l'IP del client non e' autorizzato.
     *
     * Endpoint: POST /v2.0/androidphone/auth/login.json
     * Body (form-urlencoded): deviceId=<16hex>&j_username=<email>&j_password=<password>
     * Risposta: { success: true, userId, ... } + set-cookie CBS_COM (e altri).
     *
     * ATTENZIONE: Paramount+ puo' restituire 403/406 (IP ban) se troppi tentativi
     * falliti nella stessa finestra — lato API route facciamo rate-limit.
     */
    async loginWithPassword(
        email: string,
        password: string
    ): Promise<{ ok: boolean; cookies?: string[]; error?: string }> {
        if (!email || !password) {
            return { ok: false, error: "Missing credentials" };
        }

        // deviceId pseudo-random come richiesto dall'endpoint androidphone
        const deviceId = crypto.randomBytes(32).toString("hex").slice(0, 16);

        const url = new URL(`${PPLUS_BASE_URL}/apps-api/v2.0/androidphone/auth/login.json`);
        url.searchParams.set("at", getAtToken());
        url.searchParams.set("locale", PPLUS_LOCALE_US);

        const form = new URLSearchParams({
            deviceId,
            j_username: email,
            j_password: password,
        }).toString();

        const userAgent = await PPLUS_HEADER();

        try {
            const { status, data, cookies } = await httpClient.post(
                url.toString(),
                form,
                {
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
                        "Accept": "application/json",
                        "User-Agent": userAgent,
                    },
                    maxRedirects: 0,
                    // login risponde 4xx in caso di credenziali errate: non dobbiamo
                    // sollevare eccezione, solo ispezionare lo status.
                    validateStatus: () => true,
                }
            );

            if (status >= 400) {
                const msg = (data?.message ?? data?.error ?? "").toString().toLowerCase();
                if (msg.includes("invalid username") || msg.includes("invalid password") || msg.includes("invalid username/password")) {
                    return { ok: false, error: "Invalid email or password" };
                }
                if (status === 403 || status === 406) {
                    return { ok: false, error: "Troppi tentativi: Paramount+ ha bloccato temporaneamente questo IP. Riprova pi\u00f9 tardi o usa il device-code." };
                }
                return { ok: false, error: `Login failed (HTTP ${status})` };
            }

            const ok = data?.success === true || (typeof data?.userId !== "undefined" && data.userId !== null);
            if (!ok) {
                const apiMsg = (data?.message ?? data?.error ?? "").toString();
                return { ok: false, error: apiMsg || "Login failed: invalid response" };
            }

            if (!cookies?.length) {
                return { ok: false, error: "Login succeeded but no session cookies were returned" };
            }

            return { ok: true, cookies };
        } catch (err: any) {
            console.error(`[PPLUS] loginWithPassword failed: ${err?.message ?? err}`);
            return { ok: false, error: err?.message ?? "Network error" };
        }
    }

    /** User Management **/
    async getUser(): Promise<ParamountUser> {
        const path = `/v3.0/androidtv/login/status.json`;
        return await this.getJson<any>(path);
    }

    async getMasterProfileId(): Promise<number> {
        const user = await this.getUser();
        if (user?.activeProfile?.id) return user.activeProfile.id;

        const master = user?.accountProfiles?.find(p => p.isMasterProfile);
        if (!master) throw new Error("No master profile found");
        return master.id;
    }

    async refreshCookies() {
        if (!this.session) return this.session;
        if (!this.session.profileId) this.session.profileId = await this.getMasterProfileId();

        const path = `/v2.0/androidtv/user/account/profile/switch/${this.session.profileId}.json`;
        const { cookies } = await this.postJson<any>(path);
        if (cookies.length) {
            this.session.cookies = cookies;
            this.session.expiresAt = Date.now() + 1000 * 60 * 60 * 24 * 365; //1 Year
        }
        await this.setSession(this.session);
    }

    async getAppConfig(): Promise<any> {
        const path = `/v2.0/androidphone/app/status.json`;
        const data = await this.getJson<any>(path);
        return data?.appConfig;
    }

    /** Stream Management **/
    async getIrdetoSessionToken(contentId: string): Promise<IrdetoSessionToken> {
        return await this.getJson<IrdetoSessionToken>(
            "/v3.1/androidphone/irdeto-control/session-token.json",
            { contentId: contentId }
        );
    }

    /** Catalogs **/
    async getSportsLiveUpcoming(params: Record<string, any> = {}): Promise<ListResponse<SportListingItem>> {
        return await this.getJson<ListResponse<SportListingItem>>(
            "/v3.0/androidtv/hub/multi-channel-collection/live-and-upcoming.json",
            {
                platformType: "androidtv",
                rows: 300,
                start: 0,
                ...params,
            }
        );
    }

    /**
     * Listing per singola competizione (Fase 1/2).
     * Risposta: { listing: SportListingItem[], previousListings: SportListingItem[], channel: any[] }.
     * `previousListings` contiene le partite terminate (replay).
     */
    async getSportLeagueListings(slug: string, params: Record<string, any> = {}): Promise<any> {
        return await this.getJson<any>(
            `/v3.0/androidtv/live/channels/${encodeURIComponent(slug)}/listings.json`,
            {
                platformType: "androidtv",
                rows: 100,
                start: 0,
                ...params,
            }
        );
    }

    async getLiveChannels(params: Record<string, any> = {}): Promise<ListResponse<LiveChannelItem>> {
        return await this.getJson<ListResponse<LiveChannelItem>>(
            `/v3.0/androidphone/live/channels.json`,
            {
                rows: 125,
                start: 0,
                showListing: true,
                ...params,
            }
        );
    }

    async getLiveChannelListings(slug: string, params: Record<string, any> = {}): Promise<ListResponse<LiveChannelItem>> {
        return await this.getJson<ListResponse<LiveChannelItem>>(
            `/v3.0/androidphone/live/channels/${slug}/listings.json`,
            {
                rows: 125,
                start: 0,
                showListing: true,
                ...params,
            }
        );
    }

    async getFeaturedHome(): Promise<any[]> {
        return await this.getJson<any>("/v3.0/androidphone/home/configurator.json", {
            minProximity: 1,
            minCarouselItems: 1,
            maxCarouselItems: 25,
            rows: 50,
        });
    }

    async getCarouselItems(carouselId: string, params: Record<string, any>): Promise<any[]> {
        return this.getJson<any>(
            `/v3.0/androidphone/home/configurator/carousels/${carouselId}/items.json`,
            {
                _clientRegion: "US",
                platformType: "desktop",
                start: 0,
                rows: 200,
                ...params,
            }
        );
    }

    async getTrendingMovies(): Promise<ListResponse<VodItem>> {
        return await this.getJson<ListResponse<VodItem>>("/v3.0/androidphone/movies/trending.json");
    }

    /**
     * Endpoint "All Shows" (gruppo 608). L'endpoint `shows/trending.json`
     * non esiste più: l'API risponde 400 INVALID_PARAMETER ("trending" viene
     * interpretato come showId). Questo è l'endpoint valido per il catalogo serie.
     */
    async getAllShows(): Promise<any> {
        return await this.getJson<any>("/v2.0/androidphone/shows/group/608.json", {
            rows: 100,
            begin: 0,
        });
    }

    async getSearch(term: string): Promise<ListResponse<VodItem>> {
        return await this.getJson<ListResponse<VodItem>>("/v3.0/androidphone/contentsearch/search.json", {
            term,
            rows: 50,
            start: 0,
            includeTrailerInfo: false,
            includeContentInfo: true,
            platformType: "androidphone",
            packageCode: "CBS_ALL_ACCESS_AD_FREE_PACKAGE",
        });
    }

    async getMovie(movieId: string): Promise<ListResponse<VodItem>> {
        return await this.getJson<ListResponse<VodItem>>(`/v3.0/androidphone/movies/${movieId}.json`);
    }

    async getShow(showId: string): Promise<ListResponse<VodItem>> {
        return await this.getJson<ListResponse<VodItem>>(`/v3.0/androidphone/shows/${showId}.json`);
    }

    async getShowsGroups(): Promise<any[]> {
        return await this.getJson<any>("/v2.0/androidphone/shows/groups.json");
    }

    async getShowsGroup(groupId: string): Promise<any[]> {
        return await this.getJson<any>(`/v2.0/androidphone/shows/group/${groupId}.json`, {
            rows: 50,
            begin: 0,
        });
    }

    async getMoviesGroups(): Promise<any[]> {
        return await this.getJson<any>("/v2.0/androidphone/movies/groups.json");
    }

    async getMoviesGroup(groupId: string): Promise<any[]> {
        return this.getJson<any>(`/v2.0/androidphone/movies/group/${groupId}.json`, {
            rows: 50,
            begin: 0,
        });
    }

    async getVideoSection(showId: string, config: string): Promise<any | null> {
        const data = await this.getJson<any>(
            `/v2.0/androidphone/shows/${showId}/videos/config/${config}.json`,
            {
                platformType: "apps",
                rows: 1,
                begin: 0,
            }
        );

        if (!data?.videoSectionMetadata || !data?.numFound) return null;

        const sections: any[] = data.videoSectionMetadata;
        const full = sections.find((s) => s?.section_type === "Full Episodes");
        return full ?? sections[sections.length - 1] ?? null;
    }

    async getSeasons(showId: string): Promise<number[]> {
        const data = await this.getJson<any>(
            `/v3.0/androidphone/shows/${showId}/video/season/availability.json`
        );

        const list = data?.video_available_season?.itemList ?? [];
        const seasons = list
            .map(function (x: any) {
                const n = Number(x?.seasonNum ?? x?.season_number ?? x?.season ?? x);
                return Number.isFinite(n) ? n : null;
            })
            .filter((n: number | null) => n !== null) as number[];

        return seasons.length ? Array.from(new Set(seasons)).sort((a, b) => a - b) : [];
    }

    async getEpisodes(section: any, season?: number): Promise<any[]> {
        const sectionId =
            section?.section_id ?? section?.sectionId ?? section?.id ?? section?.sectionID;
        if (!sectionId) return [];

        const params: Record<string, any> = { rows: 999, begin: 0 };

        if (season) {
            params.params = `seasonNum=${season}`;
            params.seasonNum = season;
        }

        const data = await this.getJson<any>(
            `/v2.0/androidphone/videos/section/${sectionId}.json`,
            params
        );

        return data?.sectionItems?.itemList ?? [];
    }
}


