import { NextRequest, NextResponse } from 'next/server';
import { setProxyUrls, getProxyUrls } from '@/lib/http/client';
import { saveCreds } from '@/lib/vpn/storage';
import {
    fetchSubscription,
    writeSingBoxConfig,
    clearSingBoxConfig,
} from '@/lib/vpn/singbox';
import { parseShareLink, parseConfigText, type ParsedServer } from '@/lib/vpn/share-links';

/**
 * POST /api/vpn/setup
 *
 * Body: uno dei formati:
 *   { mode: 'vless', subscriptionUrl: string, serverTag?: string }
 *       → scarica la subscription, genera config.json per sing-box,
 *         imposta PROXY_URLS = http://sing-box:8888
 *   { mode: 'proxy', url: string }
 *       → imposta un proxy HTTP esterno (no VPN tunnel)
 *   { mode: 'clear' }
 *       → rimuove la config VPN/proxy e resetta ai default
 *
 * `proton-login` è DEPRECATO: risponde con errore "usa mode vless".
 *
 * Effetti:
 *   - Scrive `vpn-data/sing-box/config.json` (bind-mount sul container
 *     sing-box). La systemd path unit (scripts/install-vpn-watcher.sh)
 *     osserva il file e riavvia il container automaticamente.
 *   - Aggiorna process.env.PROXY_URLS con il proxy di sing-box (o il proxy
 *     HTTP esterno) e ricostruisce lo stato del round-robin.
 *   - Salva le creds cifrate (AES-256-GCM via KEY_SECRET) per idempotenza.
 */
export async function POST(req: NextRequest) {
    let body: any;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
    }
    if (!body || typeof body !== 'object') {
        return NextResponse.json({ ok: false, error: 'Missing body' }, { status: 400 });
    }
    const mode = String(body.mode || '');

    try {
        if (mode === 'clear') {
            await clearSingBoxConfig();
            const defaults = process.env.HTTP_PROXY || 'http://sing-box:8888';
            setProxyUrls([defaults]);
            await saveCreds({ mode: 'none', updatedAt: new Date().toISOString() });
            return NextResponse.json({
                ok: true,
                message: 'VPN/proxy config rimossa. PROXY_URLS resettato al default.',
                proxyUrls: getProxyUrls(),
            });
        }

        if (mode === 'proton-login') {
            return NextResponse.json(
                { ok: false, error: 'ProtonVPN deprecato: usa mode "vless" con la subscription URL' },
                { status: 400 },
            );
        }

        if (mode === 'vless') {
            const shareLink = String(body.shareLink || '').trim();
            const subscriptionUrl = String(body.subscriptionUrl || '').trim();
            const rawConfig = String(body.rawConfig || '').trim();
            const serverTag = String(body.serverTag || 'auto').trim() || 'auto';

            let servers: ParsedServer[];

            if (shareLink) {
                // Share-link diretto (vless://, vmess://, trojan://, ss://, hysteria2://)
                const parsed = parseShareLink(shareLink);
                if (!parsed) {
                    return NextResponse.json(
                        { ok: false, error: 'Share-link non valido o formato non supportato' },
                        { status: 400 },
                    );
                }
                servers = [parsed];
            } else if (rawConfig) {
                // Config incollata direttamente (Xray/V2Ray JSON o share-link).
                servers = parseConfigText(rawConfig);
                if (servers.length === 0) {
                    return NextResponse.json(
                        { ok: false, error: 'Config non valida: nessun server riconosciuto (Xray JSON o share-link)' },
                        { status: 400 },
                    );
                }
            } else if (subscriptionUrl && /^https?:\/\//i.test(subscriptionUrl)) {
                // Subscription URL: scarica + parsa
                servers = await fetchSubscription(subscriptionUrl);
            } else {
                return NextResponse.json(
                    { ok: false, error: 'Fornire subscriptionUrl (http(s)://), shareLink (vless://, ...) o rawConfig (JSON Xray)' },
                    { status: 400 },
                );
            }

            // 1) Genera config.json + cache servers.json.
            const paths = await writeSingBoxConfig(servers, serverTag);

            // 2) Attiva sing-box come proxy di uscita.
            setProxyUrls(['http://sing-box:8888']);

            // 3) Salva creds cifrate (metadata, mai i link in chiaro).
            await saveCreds({
                mode: 'vless',
                subscriptionUrl: subscriptionUrl || shareLink || (rawConfig ? 'rawConfig' : ''),
                serverTag,
                serverCount: servers.length,
                updatedAt: new Date().toISOString(),
            });

            return NextResponse.json({
                ok: true,
                message: `Config sing-box salvata: ${servers.length} server, tag "${serverTag}". Il container si riavvierà automaticamente entro ~5s.`,
                config: {
                    kind: 'vless',
                    serverTag,
                    serverCount: servers.length,
                    paths,
                },
                servers: servers.map(s => ({ tag: s.tag, protocol: s.protocol, host: s.host, port: s.port })),
                proxyUrls: getProxyUrls(),
            });
        }

        if (mode === 'proxy') {
            const url = String(body.url || '').trim();
            if (!url || !/^https?:\/\//i.test(url)) {
                return NextResponse.json(
                    { ok: false, error: 'proxy url must start with http(s)://' },
                    { status: 400 },
                );
            }
            // Rimuovi eventuale config VPN (vogliamo "solo proxy esterno").
            await clearSingBoxConfig();
            setProxyUrls([url]);
            await saveCreds({
                mode: 'proxy',
                proxyUrl: url,
                updatedAt: new Date().toISOString(),
            });
            return NextResponse.json({
                ok: true,
                message: `Proxy HTTP configurato: ${url.replace(/:[^:@/]+@/, ':***@')}`,
                proxyUrls: getProxyUrls(),
            });
        }

        return NextResponse.json(
            { ok: false, error: `Unknown mode "${mode}". Expected: vless | proxy | clear` },
            { status: 400 },
        );
    } catch (err: any) {
        return NextResponse.json(
            { ok: false, error: err?.message || String(err) },
            { status: 500 },
        );
    }
}

export async function GET() {
    return NextResponse.json({
        ok: true,
        proxyUrls: getProxyUrls(),
        envProxyUrls: process.env.PROXY_URLS || '',
        envHttpProxy: process.env.HTTP_PROXY || '',
    });
}
