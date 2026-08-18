# Revisione Completa: Add-on Stremio per Paramount+ (`paramount-stremio`)

**Data:** 2026-08-18
**Ambito:** Revisione senior del codice sorgente, con focus sui problemi VOD/DRM descritti in `analysis.md`.
**Repository analizzato:** `RioNoir/paramount-stremio` (clone locale, versione `0.2.6`).

---

## 1. Riepilogo Esecutivo

Il progetto è un add-on Stremio per Paramount+ basato su **Next.js 16 (App Router) + TypeScript**, ben organizzato in `app/` (route API e UI) e `lib/` (logica di business). L'architettura di base è ragionevole: un client HTTP con proxy, un client API Paramount, un layer di mapping verso i tipi Stremio e route proxy per HLS.

Tuttavia la revisione evidenzia **problemi critici** che spiegano direttamente il comportamento VOD descritto in `analysis.md` (video che parte, mostra 5-6 secondi, poi si blocca):

1. **CRITICO — Route proxy MPD/licenza inesistenti.** La route [`stream/route.ts`](app/api/stremio/[key]/stream/[type]/[[...id]]/route.ts:161) genera URL verso `/api/proxy/${sid}/mpd` e `/api/proxy/${sid}/license`, ma **queste route non esistono** nel progetto. Il player Stremio riceve un manifest MPD proxato verso un endpoint 404: i primi segmenti "clear lead" si riproducono, poi la richiesta di licenza Widevine fallisce → blocco permanente. È la causa root del problema VOD.
2. **CRITICO — Il player desktop Stremio non ha CDM Widevine.** Anche implementando le route mancanti, il player desktop (MPV/ExoPlayer) non può decifrare Widevine. Serve una strategia server-side (CDM L3 + remux HLS) o l'uso di MediaFlow Proxy con supporto DRM.
3. **ALTO — SSRF e token esposti.** Il middleware [`proxy.ts`](proxy.ts:4) logga la query string completa (inclusi `key` e token di sessione). Le route proxy consentono relay verso host consentiti senza autenticazione oltre alla key. Il token `lsSession` viaggia in query string.
4. **ALTO — Cache cross-tenant.** Le cache in-memory di [`live.ts`](lib/paramount/types/live.ts:48) e [`sports.ts`](lib/paramount/types/sports.ts:55) sono globali (module-level), non per-sessione: un utente può vedere i dati di un altro.
5. **ALTO — Nessun test, nessuna validazione runtime.** Zero test, uso massiccio di `any`, nessuna validazione degli input (URIError su `decodeURIComponent`, crash su `auth` null nel poll).
6. **MEDIO — Codice morto e dipendenze inutilizzate.** L'intero modulo [`iptv.ts`](lib/paramount/iptv.ts:1) (M3U/EPG) non è referenziato da alcuna route, ma il poll auth genera URL `/api/iptv/...` inesistenti. Molte funzioni di [`client.ts`](lib/paramount/client.ts:241) (VOD: `getMovie`, `getShow`, `getSeasons`, `getEpisodes`, `getSearch`, ecc.) sono già implementate ma **mai usate**: il supporto VOD è a metà strada.

---

## 2. Architettura Complessiva

### 2.1 Struttura e separazione delle responsabilità

```
app/
  api/
    auth/device/{start,poll}/route.ts      → flusso Device Code
    img/route.ts                            → proxy immagini con cache
    stremio/[key]/
      manifest.json/route.ts                → manifest Stremio
      catalog/[type]/[id]/[[...extra]]/     → cataloghi
      meta/[type]/[[...id]]/                → metadati
      stream/[type]/[[...id]]/              → risoluzione stream
      proxy/{hls,seg,license}/route.ts      → proxy HLS/segmenti/licenze
  configure/page.tsx                        → UI di configurazione
lib/
  auth/jwe.ts                               → cifratura sessione (JWE/AES-GCM)
  http/{client,agent,sid}.ts                → client HTTP, keep-alive, short-id
  mediaflowproxy/mediaflowproxy.ts          → integrazione MediaFlow Proxy
  paramount/
    client.ts                               → client API Paramount+
    catalogs.ts                             → aggregazione cataloghi
    iptv.ts                                 → mapping M3U/EPG (INUTILIZZATO)
    mapping.ts                              → ID pplus:...
    utils.ts                                → costanti, helper, allowlist host
    proxy/hls.ts                            → riscrittura playlist HLS
    types/{live,sports}.ts                  → mapping listing → meta/stream
  stremio/{types,cors}.ts                   → tipi e CORS
```

**Punti di forza:**
- Separazione netta tra client HTTP, client API Paramount e layer di mapping Stremio.
- Allowlist degli host upstream ([`utils.ts`](lib/paramount/utils.ts:46)) — buona difesa anti-SSRF.
- Cache immagini con TTL e limite di entry ([`img/route.ts`](app/api/img/route.ts:7)).
- Riscrittura HLS robusta (master + media playlist, `#EXT-X-KEY`, I-FRAME) in [`proxy/hls.ts`](lib/paramount/proxy/hls.ts:159).

**Punti deboli:**
- **Codice morto significativo**: [`iptv.ts`](lib/paramount/iptv.ts:1) (intero modulo), `keepAliveAgent` ([`agent.ts`](lib/http/agent.ts:3)), `extend()` ([`sid.ts`](lib/http/sid.ts:25)), `checkMyIp()` ([`utils.ts`](lib/paramount/utils.ts:32)), e ~15 metodi VOD di [`client.ts`](lib/paramount/client.ts:241) mai chiamati.
- **Route referenziate ma inesistenti**: `/api/proxy/[sid]/mpd`, `/api/proxy/[sid]/license` (da [`stream/route.ts`](app/api/stremio/[key]/stream/[type]/[[...id]]/route.ts:162)) e `/api/iptv/[key]/playlist.m3u`, `/api/iptv/[key]/epg.xml` (da [`poll/route.ts`](app/api/auth/device/poll/route.ts:30)). Questi URL vengono restituiti all'utente ma risolvono in 404.
- **Duplicazione**: `buildCookieHeader` è implementata 3 volte ([`utils.ts`](lib/paramount/utils.ts:80), [`mediaflowproxy.ts`](lib/mediaflowproxy/mediaflowproxy.ts:15), inline in [`client.ts`](lib/paramount/client.ts:59) e [`license/route.ts`](app/api/stremio/[key]/proxy/license/route.ts:43)).

### 2.2 Gestione dipendenze, configurazione e build

| Aspetto | Valutazione |
|---|---|
| `package.json` | Dipendenze sensate ma **3 pacchetti inutilizzati**: `hls-parser`, `m3u8-parser`, `socks-proxy-agent`. `undici` usato solo in codice morto. |
| `next.config.ts` | Vuoto — nessuna ottimizzazione (es. `output: "standalone"` per Docker). |
| `Dockerfile` | Multi-stage corretto, ma: copia **tutti** i `node_modules` (dev incluse) nell'immagine finale; gira come **root** (manca `USER node`); base `node:25-alpine` (versione non-LTS). |
| `docker-compose.yml` | `KEY_SECRET=[random]` è un placeholder: se non sostituito, chiave debole e prevedibile. |
| `tsconfig.json` | `strict: true` ✅, ma il codice lo aggira con `any` ovunque. |
| `eslint.config.mjs` | Config standard Next; nessuno script `typecheck` separato. |
| Script | `dev`, `build`, `start`, `lint`. **Nessuno script di test.** |

---

## 3. Problemi Dettagliati (con priorità)

### 3.1 CRITICO — VOD/DRM

#### P1. Route proxy MPD/licenza mancanti (causa root del blocco VOD)
- **File:** [`app/api/stremio/[key]/stream/[type]/[[...id]]/route.ts`](app/api/stremio/[key]/stream/[type]/[[...id]]/route.ts:159)
- La branch `.mpd` genera:
  ```ts
  const internal = new URL(`${baseUrl}/api/proxy/${sid}/mpd`);
  const license = new URL(`${baseUrl}/api/proxy/${sid}/license`);
  ```
  Nessuna route `/api/proxy/...` esiste. Il player riceve un URL MPD che risponde 404 e un `licenseUrl` che risponde 404. I primi segmenti non protetti (clear lead) vengono scaricati direttamente dal CDN (per questo si vedono 5-6 secondi), poi la richiesta licenza fallisce → blocco.
- **Fix:** implementare le route `/api/proxy/[sid]/mpd` e `/api/proxy/[sid]/license` (proxy DASH + relay licenza Widevine), oppure riusare le route esistenti `/api/stremio/[key]/proxy/...` con la key. **Nota:** questo da solo non basta per il player desktop (vedi P2).

#### P2. Il player desktop Stremio non supporta Widevine
- **File:** [`analysis.md`](analysis.md:80), [`README.md`](README.md:26)
- Il README dichiara "currently only HLS streams work". I contenuti VOD/Replay usano **Widevine DRM (Irdeto)**. Il player desktop Stremio non ha CDM → non può decifrare.
- **Fix (strategia):** decifratura server-side (CDM L3 + remux HLS in chiaro) o delega a MediaFlow Proxy con supporto DRM. Dettagli in §6.

#### P3. `pickManifestUrl` non gestisce correttamente i flussi protetti
- **File:** [`lib/paramount/utils.ts`](lib/paramount/utils.ts:207)
- La funzione cerca `.m3u8`/`.mpd` in tutto il payload. Per i VOD il payload contiene sia il manifest MPD sia l'URL licenza (`/widevine/getlicense`). Se trova l'MPD lo restituisce (bene), ma se il payload contiene solo l'URL licenza restituisce `null` → `streams: []` silenzioso. Inoltre `isLicenseUrl` viene usato come guardia in [`live.ts`](lib/paramount/types/live.ts:114) e [`sports.ts`](lib/paramount/types/sports.ts:139): se il manifest è protetto, il flusso viene scartato senza log.
- **Fix:** loggare il motivo dello scarto; distinguere "manifest non trovato" da "manifest protetto"; per i VOD preferire esplicitamente l'MPD e gestire la licenza.

#### P4. La route `license` esistente è solo per AES-128 HLS, non Widevine
- **File:** [`app/api/stremio/[key]/proxy/license/route.ts`](app/api/stremio/[key]/proxy/license/route.ts:6)
- È una route `POST` che inoltra il challenge, ma il `rewriteM3U8` la usa per `#EXT-X-KEY` (GET). Per Widevine serve un endpoint dedicato con header `x-dtp`/`Content-Type: application/octet-stream` e gestione della risposta binaria. La route attuale non valida che l'URL sia effettivamente una licenza.

#### P5. Nessun supporto cataloghi VOD (movie/series)
- **File:** [`lib/paramount/catalogs.ts`](lib/paramount/catalogs.ts:29) — `//TODO: movies and shows`; [`manifest.json/route.ts`](app/api/stremio/[key]/manifest.json/route.ts:53) — `types: ["tv"]`.
- I metodi VOD in [`client.ts`](lib/paramount/client.ts:327) (`getTrendingMovies`, `getTrendingShows`, `getSearch`, `getMovie`, `getShow`, `getSeasons`, `getEpisodes`, `getFeaturedHome`, `getCarouselItems`) sono già scritti ma **mai chiamati**. Il supporto VOD è a metà: manca solo il wiring.

### 3.2 ALTO — Sicurezza

#### P6. Token di sessione e key esposti nei log
- **File:** [`proxy.ts`](proxy.ts:4) (middleware Next)
  ```ts
  console.log(`${request.method} ${request.nextUrl.pathname}${request.nextUrl.search}`);
  ```
  Logga la **query string completa** di ogni richiesta, inclusi `key` (JWE di sessione) e `t` (token `lsSession`). In produzione questi finiscono nei log del container.
- **Fix:** loggare solo `pathname`, mai `search`; o redigere i parametri sensibili.

#### P7. SSRF limitato ma presente (relay verso host consentiti)
- **File:** [`app/api/stremio/[key]/proxy/seg/route.ts`](app/api/stremio/[key]/proxy/seg/route.ts:37), [`hls/route.ts`](app/api/stremio/[key]/proxy/hls/route.ts:36), [`license/route.ts`](app/api/stremio/[key]/proxy/license/route.ts:26)
- L'allowlist [`PPLUS_UPSTREAM_ALLOWED_HOSTS`](lib/paramount/utils.ts:54) include `google.com`, `googleapis.com`, `doubleclick.net`, ecc. Chiunque possieda una key valida può usare l'add-on come **proxy aperto verso questi domini** (es. `googleapis.com`). Inoltre il parametro `f` in [`seg/route.ts`](app/api/stremio/[key]/proxy/seg/route.ts:22) concatena un suffisso arbitrario all'URL base (dopo il check, ma il check è sull'hostname, non sul path).
- **Fix:** restringere l'allowlist ai soli domini necessari per lo streaming; validare che l'URL finale non punti a path sensibili; rate-limit per key.

#### P8. Input non validati → crash/500
- **File:** [`app/api/auth/device/poll/route.ts`](app/api/auth/device/poll/route.ts:8) — `auth` può essere `null` (da `req.json().catch(() => null)`), poi `Date.parse(auth.createdAt)` → `TypeError` non gestito.
- **File:** [`app/api/stremio/[key]/catalog/[type]/[id]/[[...extra]]/route.ts`](app/api/stremio/[key]/catalog/[type]/[id]/[[...extra]]/route.ts:12) — `decodeURIComponent` può lanciare `URIError` su input malformato → 500.
- **File:** [`app/api/stremio/[key]/meta/[type]/[[...id]]/route.ts`](app/api/stremio/[key]/meta/[type]/[[...id]]/route.ts:23) — idem.
- **Fix:** try/catch su decode, validazione del body del poll, risposta 400 invece di 500.

#### P9. Token hardcoded
- **File:** [`lib/paramount/utils.ts`](lib/paramount/utils.ts:5) — `PPLUS_AT_TOKEN_US` è un token di accesso API Paramount+ hardcoded. È un token pubblico dell'app Android (non un segreto utente), ma andrebbe documentato e idealmente spostato in env con fallback.

#### P10. CORS `*` + key nell'URL
- Il design Stremio richiede la key nell'URL del manifest. Chiunque abbia l'URL può usare la sessione. Va documentato esplicitamente (il README lo fa solo parzialmente) e valutato un rate-limit.

### 3.3 ALTO — Prestazioni e correttezza dei dati

#### P11. Cache globali cross-tenant
- **File:** [`lib/paramount/types/live.ts`](lib/paramount/types/live.ts:48) e [`lib/paramount/types/sports.ts`](lib/paramount/types/sports.ts:55)
- `liveListingCache` e `sportListingCache` sono variabili **module-level**: condivise tra tutte le sessioni. Un utente B vede i listing (e i metadati) dell'utente A. Inoltre la cache non è invalidata al refresh dei cookie.
- **Fix:** cache per-sessione (chiave = `profileId` o hash dei cookie) o rimozione della cache a favore di `fetch` con `Cache-Control` upstream.

#### P12. Doppio fetch del manifest master
- **File:** [`app/api/stremio/[key]/stream/[type]/[[...id]]/route.ts`](app/api/stremio/[key]/stream/[type]/[[...id]]/route.ts:87)
- La route stream scarica il master playlist per generare le varianti, poi il player richiede di nuovo lo stesso master via `/proxy/hls`. Doppio download per ogni avvio.
- **Fix:** generare le varianti in modo lazy (il proxy hls può filtrare per bandwidth senza pre-fetch), oppure cache breve del master.

#### P13. `sid` cache senza limite
- **File:** [`lib/http/sid.ts`](lib/http/sid.ts:18) — `urlCache` è un `Map` globale con TTL 24h ma **senza limite di dimensione**: memory leak potenziale sotto carico.
- **Fix:** limite di entry (come `imgCache`) o TTL più breve.

#### P14. `HttpClient` con `validateStatus: (s) => s < 500`
- **File:** [`lib/http/client.ts`](lib/http/client.ts:21) — gli errori 4xx non lanciano: `getJson` ritorna `data` anche su 401/403/404. I chiamanti non controllano mai lo status → errori silenziosi e dati `undefined` propagati.
- **Fix:** lanciare su 4xx/5xx con contesto, oppure restituire un risultato tipizzato `{ ok, status, data }` e controllarlo nei chiamanti.

### 3.4 MEDIO — Qualità del codice

#### P15. Uso massiccio di `any` e assenza di validazione runtime
- `getJson<T>` con `T = any` in tutto [`client.ts`](lib/paramount/client.ts:31). Nessuno schema di validazione (zod/valibot). I mapping (`mapLiveListingToMeta`, ecc.) accedono a campi annidati con `?.` ma senza garanzie.
- **Fix:** introdurre tipi per le risposte API (almeno per i campi usati) e validazione runtime per i punti di ingresso.

#### P16. Error handling silenzioso
- [`pollDeviceAuth`](lib/paramount/client.ts:196) — `catch { return { ok: false } }` nasconde l'errore.
- [`getJson`](lib/paramount/client.ts:63) — logga ma non lancia.
- [`PPLUS_HEADER`](lib/paramount/utils.ts:25) — `catch {}` vuoto.
- **Fix:** log con contesto (URL, status, body troncato) e propagazione controllata.

#### P17. Codice morto e dipendenze inutilizzate
- Modulo [`iptv.ts`](lib/paramount/iptv.ts:1) intero (M3U/EPG) mai importato; `keepAliveAgent` ([`agent.ts`](lib/http/agent.ts:3)); `extend` ([`sid.ts`](lib/http/sid.ts:25)); `checkMyIp` ([`utils.ts`](lib/paramount/utils.ts:32)); `getLinkPlatformUrl` ([`client.ts`](lib/paramount/client.ts:255)); dipendenze `hls-parser`, `m3u8-parser`, `socks-proxy-agent`, `undici` (parzialmente).
- **Fix:** rimuovere o riattivare (vedi §6 per il riuso VOD).

#### P18. `getSessionKey` cifra una sessione vuota
- **File:** [`lib/paramount/client.ts`](lib/paramount/client.ts:165) — se `this.session` è `undefined`, cifra `{ cookies: [], expiresAt: null }` e restituisce una key valida che poi `setSessionKey` rifiuta. Comportamento confuso; meglio lanciare o restituire `null`.

#### P19. MFP: password e header in query string
- **File:** [`lib/mediaflowproxy/mediaflowproxy.ts`](lib/mediaflowproxy/mediaflowproxy.ts:57) — `api_password` e tutti gli header (incluso `authorization`) finiscono nella query string dell'URL MFP: esposti nei log del proxy e nei referrer.
- **Fix:** usare header HTTP per la password (se MFP lo supporta) o firmare l'URL con TTL.

### 3.5 MEDIO — Docker/Deploy

#### P20. Immagine Docker non ottimizzata
- **File:** [`Dockerfile`](Dockerfile:12) — copia `node_modules` completi (dev incluse); nessun `USER node`; `node:25-alpine` non-LTS.
- **Fix:** `npm ci --omit=dev` nello stage run, `USER node`, base LTS (`node:22-alpine`), e valutare `output: "standalone"` in `next.config.ts`.

#### P21. `docker-compose.yml` con placeholder
- `KEY_SECRET=[random]` — se l'utente non lo cambia, la cifratura JWE usa una chiave nota. Aggiungere un commento esplicito e, se possibile, un check all'avvio che rifiuti il placeholder.

### 3.6 MEDIO — Test e Documentazione

#### P22. Zero test
- Nessun framework di test configurato, nessun test presente. Le funzioni pure ([`proxy/hls.ts`](lib/paramount/proxy/hls.ts:9), [`iptv.ts`](lib/paramount/iptv.ts:30), [`mapping.ts`](lib/paramount/mapping.ts:1)) sono perfettamente testabili.
- **Fix:** aggiungere `vitest` + test unitari per: riscrittura M3U8, parsing cataloghi, mapping ID, `pickManifestUrl`, `filterMasterByClosestBandwidth`. Test di integrazione per le route proxy con mock di `httpClient`.

#### P23. Documentazione
- Il README è buono (env vars, installazione, disclaimer) ma: non documenta i limiti VOD/DRM in modo esplicito (dice solo "currently only HLS streams work"); non documenta le route `/api/iptv/...` e `/api/proxy/...` che non esistono; non documenta il flusso di contribuzione con test.
- **Fix:** sezione "Known limitations" dettagliata, tabella delle route, istruzioni per test.

---

## 4. Priorità di Intervento

| # | Problema | Priorità | Impatto |
|---|---|---|---|
| P1 | Route proxy MPD/licenza mancanti | **ALTA** | VOD bloccato (causa root) |
| P2 | Player desktop senza CDM Widevine | **ALTA** | VOD non riproducibile |
| P5 | Cataloghi VOD non collegati | **ALTA** | Funzionalità VOD assente |
| P6 | Token/key nei log | **ALTA** | Sicurezza |
| P7 | SSRF limitato | **ALTA** | Sicurezza |
| P8 | Input non validati → 500 | **ALTA** | Stabilità |
| P11 | Cache cross-tenant | **ALTA** | Privacy/correttezza |
| P12 | Doppio fetch manifest | MEDIA | Prestazioni |
| P3/P4 | Gestione manifest/licenza protetti | MEDIA | Correttezza VOD |
| P13 | sid cache senza limite | MEDIA | Memoria |
| P14 | Errori 4xx silenziosi | MEDIA | Manutenibilità |
| P15/P16 | `any` e error handling | MEDIA | Qualità |
| P17 | Codice morto | MEDIA | Manutenibilità |
| P19 | MFP password in query | MEDIA | Sicurezza |
| P20/P21 | Docker | MEDIA | Deploy |
| P22 | Zero test | MEDIA | Qualità |
| P23 | Documentazione | BASSA | UX |
| P9/P10/P18 | Token hardcoded, CORS, sessione vuota | BASSA | Varie |

---

## 5. Suggerimenti di Ottimizzazione e Best Practice

1. **Tipizzazione end-to-end**: definire interfacce per le risposte API Paramount (almeno i campi usati) e validare con un runtime validator (zod) ai confini del sistema (route API).
2. **Error handling esplicito**: `HttpClient` deve lanciare su 4xx/5xx; i chiamanti devono gestire il fallimento con log contestuali e fallback (es. `streams: []` con motivo).
3. **Cache per-sessione**: chiave = `profileId`; TTL breve; invalidazione al refresh dei cookie.
4. **Logging sicuro**: mai loggare query string complete; redigere `key`, `t`, `u`, `api_password`.
5. **SSRF hardening**: allowlist minima, validazione del path, rate-limit per key, rifiuto di URL con credenziali.
6. **Docker**: immagine standalone, `--omit=dev`, `USER node`, base LTS.
7. **Test**: vitest per le funzioni pure; mock di `httpClient` per le route.
8. **Rimozione codice morto** o riattivazione (vedi §6).

---

## 6. Proposta Concreta per i Problemi VOD

### 6.1 Diagnosi confermata

Il flusso VOD attuale è:

```
Stremio → /stream/[type]/pplus:sport:ID
  → resolveSportStream() → getIrdetoSessionToken(contentId)
  → pickManifestUrl(tokenResp) → URL MPD (DASH + Widevine)
  → genera URL /api/proxy/[sid]/mpd  (404!)
  → genera URL /api/proxy/[sid]/license (404!)
  → behaviorHints.drm.widevine.licenseUrl = /api/proxy/[sid]/license (404!)
Player:
  → scarica MPD (404) → fallisce
  → oppure, se il manifest è raggiungibile direttamente, scarica i primi segmenti clear
  → richiede licenza Widevine → 404 → blocco
```

### 6.2 Strategia a 3 livelli

#### Livello 1 — Fix immediato (ripristino del flusso DASH/Widevine per player con CDM)
Implementare le route mancanti riusando l'infrastruttura esistente:

- **`app/api/proxy/[sid]/mpd/route.ts`**: proxy del manifest DASH con riscrittura degli URL dei segmenti verso il proxy interno (analogo a `rewriteM3U8` ma per MPD: riscrivere `BaseURL`, `SegmentTemplate` media, `ContentProtection`).
- **`app/api/proxy/[sid]/license/route.ts`**: relay POST del challenge Widevine verso l'URL licenza (Irdeto), con header `Content-Type: application/octet-stream`, `x-dtp`, cookie di sessione e `Authorization: Bearer <lsSession>`.
- **`app/api/proxy/[sid]/seg/route.ts`**: proxy dei segmenti `.m4s` (riusare la logica di [`seg/route.ts`](app/api/stremio/[key]/proxy/seg/route.ts:11)).

Questo sblocca i VOD su **Stremio Web/Android** (che hanno CDM Widevine). **Non** sblocca il desktop.

#### Livello 2 — Decifratura server-side per il player desktop (CDM L3 + remux HLS)
Per il desktop (obiettivo dichiarato in `analysis.md`):

1. **Integrare un CDM Widevine L3** lato server. Opzioni:
   - **pywidevine** (Python) esposto come microservizio interno (es. `/cdm`), chiamato dal backend Node.
   - **widevine-l3-decryptor** o librerie Node native (es. `widevine-l3`).
2. **Flusso proposto**:
   ```
   /stream → getIrdetoSessionToken → MPD + license URL
   → backend: ottiene licenza via CDM (challenge → response → KID:KEY)
   → scarica segmenti .m4s, decifra (AES-CTR con KID:KEY)
   → remux in HLS chiaro (ffmpeg o mux.js) → /proxy/hls + /proxy/seg
   ```
3. **Caching dei segmenti decifrati** (TTL breve, per sessione) per evitare di decifrare due volte lo stesso segmento.
4. **Fallback**: se il CDM fallisce, restituire comunque lo stream MPD con `behaviorHints` (per player con CDM).

**Nota legale/operativa**: il README dichiara esplicitamente "No DRM bypass". La decifratura server-side con CDM L3 è tecnicamente un bypass del DRM e viola i ToS di Paramount+. Va valutata la compatibilità con il disclaimer del progetto e con le policy di distribuzione. In alternativa, **MediaFlow Proxy** (già integrato) supporta il proxying di flussi protetti in alcune configurazioni: verificare se la versione usata supporta Widevine e, in caso positivo, estendere [`wrapUrlWithMediaFlow`](lib/mediaflowproxy/mediaflowproxy.ts:35) per i flussi MPD.

#### Livello 3 — Estensione cataloghi VOD (movie/series)
Riattivare i metodi già presenti in [`client.ts`](lib/paramount/client.ts:327):

1. **Cataloghi**: `getTrendingMovies`, `getTrendingShows`, `getFeaturedHome`/`getCarouselItems`, `getSearch` → nuovi cataloghi `pplus_movies`, `pplus_series` in [`catalogs.ts`](lib/paramount/catalogs.ts:14) e nel manifest.
2. **Meta**: `getMovie(movieId)` e `getShow(showId)` + `getSeasons`/`getEpisodes`/`getVideoSection` → `buildMovieMeta`/`buildSeriesMeta` in `lib/paramount/types/`.
3. **Mapping ID**: estendere [`mapping.ts`](lib/paramount/mapping.ts:17) con `pplus:movie:` e `pplus:series:` (già presenti le funzioni `pplusMovieId`/`pplusSeriesId`).
4. **Stream**: `resolveMovieStream`/`resolveSeriesStream` → `getIrdetoSessionToken` + gestione MPD/Widevine (Livello 1/2).
5. **Manifest**: `types: ["tv", "movie", "series"]`, `idPrefixes: ["pplus:"]`.

### 6.3 Esempio di codice — Route proxy MPD (Livello 1)

```ts
// app/api/proxy/[sid]/mpd/route.ts
import { NextRequest, NextResponse } from "next/server";
import { extend } from "@/lib/http/sid";
import { httpClient } from "@/lib/http/client";
import { needsParamountAuth, buildCookieHeader, PPLUS_BASE_URL, PPLUS_HEADER, isAllowedUpstreamUrl } from "@/lib/paramount/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ sid: string }> }) {
  const { sid } = await ctx.params;
  const entry = extend(sid);
  if (!entry?.u) return new NextResponse("Unknown sid", { status: 404 });

  const upstream = new URL(entry.u);
  if (!isAllowedUpstreamUrl(upstream)) return new NextResponse("Forbidden", { status: 403 });

  const headers: Record<string, string> = {
    "user-agent": await PPLUS_HEADER(),
    accept: "application/dash+xml, */*",
  };
  if (needsParamountAuth(upstream.hostname)) {
    headers["authorization"] = `Bearer ${entry.t}`;
    const cookie = buildCookieHeader(entry.key ? undefined : undefined); // session cookies via key
    if (cookie) headers["cookie"] = cookie;
    headers["origin"] = PPLUS_BASE_URL;
    headers["referer"] = PPLUS_BASE_URL;
  }

  const { status, data } = await httpClient.get(upstream.toString(), { headers });
  if (status >= 400) return new NextResponse("Upstream error", { status });

  // Riscrittura MPD: BaseURL/SegmentTemplate → proxy segmenti
  const rewritten = rewriteMpd(data.toString(), upstream, sid);
  return new NextResponse(rewritten, {
    status,
    headers: {
      "Content-Type": "application/dash+xml",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
    },
  });
}
```

### 6.4 Piano di implementazione suggerito

1. **Fix P1/P4**: implementare route `/api/proxy/[sid]/{mpd,license,seg}` e collegarle a `shorten()`/`extend()` già esistenti in [`sid.ts`](lib/http/sid.ts:15).
2. **Fix P6/P7/P8**: logging sicuro, validazione input, hardening SSRF.
3. **Fix P11**: cache per-sessione.
4. **Livello 3**: collegare i cataloghi VOD (riuso dei metodi esistenti).
5. **Livello 2**: valutare CDM L3/MediaFlow Proxy per il desktop (decisione architetturale + legale).
6. **P22**: aggiungere vitest e test per le funzioni pure.
7. **P20/P21**: ottimizzare Docker e compose.

---

## 7. Conclusione

Il progetto ha una base solida (separazione dei layer, allowlist anti-SSRF, riscrittura HLS curata) ma il supporto VOD è **incompleto e rotto**: le route proxy DASH/licenza referenziate non esistono, e il player desktop non può decifrare Widevine. Le priorità immediate sono: (1) implementare le route proxy mancanti, (2) decidere la strategia DRM per il desktop (CDM L3 server-side o MediaFlow Proxy), (3) collegare i cataloghi VOD già implementati in `client.ts`. In parallelo vanno chiusi i buchi di sicurezza (log dei token, SSRF, input non validati) e la cache cross-tenant.