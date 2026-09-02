# Piano: Fix audio DVR + lingua preferita + /configure protetta con VLESS multipli per utente

## Diagnosi (dai log VPS del 31/08)

### 1. DVR "From Start" senza audio
[`lib/paramount/proxy/dvr.ts`](../lib/paramount/proxy/dvr.ts) + [`app/api/stremio/[key]/proxy/dvr/route.ts`](../app/api/stremio/[key]/proxy/dvr/route.ts):
- `pickVariantUrl()` considera **solo** i blocchi `#EXT-X-STREAM-INF` (video).
- I master Paramount hanno le tracce audio come **rendition separate** (`#EXT-X-MEDIA:TYPE=AUDIO` con propri media playlist e group-id).
- La playlist DVR sintetizzata contiene quindi solo i segmenti video → **video ok, audio assente**.

### 2. Lingua: "Auto" non preferisce l'italiano
- Lo stream route genera varianti `lang=ita/eng` separate, ma lo stream **Auto** principale non imposta `lang`.
- Dai log Android: il player ha richiesto `master.m3u8&lang=ita` e poi si è fermato (caricamento infinito) → da verificare il percorso master+lang nella route [`proxy/hls`](../app/api/stremio/[key]/proxy/hls/route.ts).

### 3. /configure
- Attualmente aperta a chiunque e mostra subito "VLESS — Connesso" (config **globale**, un solo `creds.enc`, un solo sing-box).
- Le API `/api/vpn/*` non hanno auth.

---

## Lavorazione

### A. Fix audio DVR (video-only → video+audio)
File: [`lib/paramount/proxy/dvr.ts`](../lib/paramount/proxy/dvr.ts), route `proxy/dvr`, test `tests/dvr.test.ts`.

1. Nuova funzione `pickAudioRenditions(masterText, masterUrl, lang?)`: estrae i `#EXT-X-MEDIA:TYPE=AUDIO` (group-id, name, language, URI assoluta).
2. Selezione traccia audio: **ita → eng → DEFAULT=YES → prima disponibile** (param `lang` override).
3. Per la traccia audio scelta: fetch media playlist audio → `parseMediaPlaylist()` → se i segmenti audio sono numerati (`_N.ts`) sintetizza **DVR EVENT audio** con lo stesso meccanismo (template + `dvrseg`); se NON numerati, fallback: synth playlist EVENT con segmenti espliciti mappati su `/proxy/seg` (serve nuova route/param o riuso `rewriteM3U8`).
4. La route DVR ritorna un **master playlist riscritto**: `#EXT-X-STREAM-INF` → URI = DVR playlist video proxata; `#EXT-X-MEDIA:TYPE=AUDIO` → URI = DVR playlist audio proxata (chiavi/IV coerenti, KEY proxata via `/proxy/license`).
5. Cache key include la traccia audio scelta. Test: master con audio group → playlist DVR contiene rendition audio + segmenti audio; master muxed (audio nel TS) → comportamento invariato.

### B. Lingua preferita ita→eng di default
File: route `stream/[[...id]]`, [`lib/paramount/proxy/hls.ts`](../lib/paramount/proxy/hls.ts).

1. Nuovo helper `pickPreferredLang(tracks): string | null` → `ita` se presente, altrimenti `eng`, altrimenti `DEFAULT=YES`, altrimenti prima traccia.
2. Stream **Auto** (e quality streams senza lang esplicito): aggiungono `lang=<preferita>` al proxy URL. Le varianti per-lingua esplicite restano invariate (l'utente può scegliere).
3. Verifica route `proxy/hls` con `lang` su **master**: deve riscrivere il master filtrato (`filterMasterByLanguage`) rimuovendo le altre `#EXT-X-MEDIA` e forzando `DEFAULT=YES/AUTOSELECT=YES` sulla lingua scelta — così i player nativi (ExoPlayer/Android) non restano in caricamento. Aggiungere test regression per il caso `master.m3u8&lang=ita`.

### C. /configure protetta da login (basic-style in-app)
1. Env: `CONFIG_USER` + `CONFIG_PASSWORD` (in `.env`; se mancanti → /configure mostra errore di setup, API rifiutano, fail-closed).
2. `POST /api/configure/login` → verifica credenziali (timing-safe) → cookie **HttpOnly + Secure + SameSite=Lax** con JWE (`seal()` esistente, payload `{u, exp}` validità 30 giorni, rinnovabile).
3. Protezione: middleware Next (`middleware.ts`) su `/configure` (redirect a `/configure/login`) e su `/api/vpn/*`, `/api/configure/*` (401 JSON). Logout: `POST /api/configure/logout` che invalida il cookie.
4. All'ingresso: se nessun dato salvato per l'utente → pagina **vuota** (Step 1 VPN, Step 2 login Paramount) come richiesto.

### D. VLESS multipli per utente (lista + switch)
1. Storage per-utente: nuovo `lib/vpn/user-storage.ts` che usa la stessa cifratura AES-GCM di [`lib/vpn/storage.ts`](../lib/vpn/storage.ts) ma con path `/app/.data/vpn/users/<userId>/`:
   - `servers.enc`: lista voci `{ id, label, input (subscriptionUrl | shareLink | rawConfig), addedAt }`
   - `activeId`: voce attiva.
2. Nuove API (protette): `GET/POST/DELETE /api/configure/vpn-servers` (lista/aggiungi/rimuovi), `POST /api/configure/vpn-switch` (imposta attiva → riusa il flusso esistente `writeSingBoxConfig` → watcher riavvia sing-box).
3. UI `vpn-card.tsx`: lista dei server salvati con radio "attiva", pulsanti aggiungi/elimina/switch; pre-compilazione dallo storage per-utente (nessun cookie di dati sensibili: i VLESS restano cifrati su disco, il cookie contiene solo l'identità di sessione).
4. Login Paramount (Step 2) resta per-sessione chiave Stremio (già per-utente di fatto).

⚠️ **Nota/limite architetturale**: c'è **un solo container sing-box** con un solo outbound attivo. Lo "switch" VLESS cambia l'uscita per **tutti** gli utenti dell'addon (l'egress è condiviso). Se vuoi isolamento totale servirebbe un sing-box per utente (fuori dal perimetro di questo piano, decidi dopo).

---

## Ordine di esecuzione

1. B — lingua preferita + fix master+lang (risolve anche il caricamento infinito Android)
2. A — audio DVR
3. C — auth /configure
4. D — VLESS multipli per utente

Deploy: commit → push → `sudo bash scripts/update-docker.sh` sulla VPS (regola d'oro: solo via git).
