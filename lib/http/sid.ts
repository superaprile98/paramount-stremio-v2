import { createHash } from 'crypto';

const globalCache = global as any;
if (!globalCache.urlCache) {
    globalCache.urlCache = new Map<string, {
        key: string,
        u: string | null,
        t: string | null,
        l?: string | null,
        f?: string | null,
    }>();
}
const urlCache = globalCache.urlCache;

// Limite massimo di entry per evitare memory leak sotto carico (P13).
const MAX_URL_CACHE_ENTRIES = 10_000;
const URL_CACHE_TTL = 24 * 60 * 60 * 1000;

export function shorten(key: string, u: string, t: string, l?: string, f?: string) {
    const seed = `${key}-${u}-${t}-${l}-${f}`;
    const sid = createHash('md5').update(seed).digest('hex').substring(0, 20).toString().toUpperCase();
    if (!urlCache.has(sid)) {
        // Eviction FIFO quando la cache raggiunge il limite
        if (urlCache.size >= MAX_URL_CACHE_ENTRIES) {
            const oldestKey = urlCache.keys().next().value;
            if (oldestKey !== undefined) urlCache.delete(oldestKey);
        }
        urlCache.set(sid, { key, u, t, l, f });
        setTimeout(() => urlCache.delete(sid), URL_CACHE_TTL);
    }
    return sid;
}

export function extend(sid: string): {
    key: string;
    u: string | null;
    t: string | null;
    l?: string | null;
    f?: string | null
} | null {
    return urlCache.get(sid) ?? null;
}