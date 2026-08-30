# Recap progetto — Paramount+ Stremio Addon

> Documento di sintesi: goal, scelte, problematiche, ragionamento e stato raggiunto.
> Ultimo aggiornamento: 30/08/2026 (dopo il deploy della funzione DVR).

---

## 1. Il goal

Addon **non ufficiale Paramount+ per Stremio** con focus sport (Serie A, coppe UEFA, ecc.), guardabile da **tutti i dispositivi** (desktop, web, Android, Firestick), con:

- catalogo sportivo dedicato (live / upcoming / replay per lega),
- streaming HLS live **proxato** dall'addon (bypass geo-restrizioni via VLESS),
- **DVR "From Start"**: guardare una partita live dall'inizio con seek avanti/indietro (come l'app nativa Paramount+),
- replay disponibili post-partita.

L'addon gira su VPS Oracle Cloud (Docker) e l'egress verso Paramount+ passa per **sing-box** (VLESS), così da avere IP USA coerenti e stabili.

---

## 2. Organizzazione del repository

```
paramount-stremio/
├── app/                        # Next.js App Router
│   ├── api/
│   │   ├── install/[token]/    # entry-point Stremio (manifest, catch-all)
│   │   ├── stremio/[key]/      # catalog, meta, stream, prefs, proxy HLS/license/seg/DVR
│   │   ├── proxy/[sid]/        # proxy compatti per MPD (sid in-process): mpd, license, seg, dvrseg
│   │   ├── auth/               # device auth + login password
│   │   └── vpn/                # setup/preview/status VLESS
│   └── configure/              # UI wizard configurazione
├── lib/
│   ├── auth/                   # JWE session sealing + install-token store
│   ├── http/                   # httpClient (proxy pool sing-box) + sid shortener
│   ├── paramount/
│   │   ├── client.ts           # client API Paramount+ (apps-api)
│   │   ├── sports.ts           # logica catalogo/risoluzione stream sport
│   │   ├── proxy/              # hls.ts, mpd.ts, dvr.ts (logica pura, testabile)
│   │   └── types/              # modelli normalizzati (sport, live, vod, api)
│   ├── stremio/                # manifest, tipi, CORS
│   └── vpn/                    # sing-box config builder, share-links parser, storage
├── scripts/                    # deploy/update VPS, systemd, watcher VPN
├── tests/                      # vitest (125 test, inclusi 15 sul DVR)
├── plans/                      # spec delle feature (VLESS, configure wizard, ...)
├── deploy/oracle/              # guida deploy VPS
└── docs/                       # documentazione (questo recap)
```

**Pulizia fatta in questa sessione:**
- ❌ rimosso `superaprile98/` — era il clone del repo del **profilo GitHub** (superaprile98/superaprile98, quello con README+slides del profilo) finito dentro il workspace. Non c'entrava nulla col progetto: il repo su GitHub resta intatto.
- ❌ rimossi `scripts/debug-irdeto-dump.mjs` e `scripts/patch-irdeto-dump.mjs` (strumenti temporanei di investigazione, ora obsoleti).

---

## 3. Come comunico con la VPS

**Non uso GitHub** (la repo è privata e non ne ho bisogno): lavoro su due fronti:

1. **Workspace locale** (`/home/superaprile/streaming/paramount-stremio`) — dove sviluppo, testo (vitest) e committto.
2. **VPS via SSH** — connessione diretta:
   ```
   ssh -i ~/.ssh/oracle-vm.key ubuntu@92.4.220.196
   ```
   Con questa eseguo comandi, `scp` per trasferire file, e `docker compose` per rebuildare.

**Flusso di deploy che ho usato:** sviluppo locale → test → `scp` dei file modificati sulla VPS → `docker compose up -d --build paramount` → verifica endpoint su `http://localhost:7850`.

---

## 4. Dove stanno i file sulla VPS (e cosa ho toccato io)

La tua riorganizzazione è **intatta**: `server-stack/` contiene komodo, ngix, taninator e paramount-stremio, ognuno nel suo folder. Io ho lavorato **solo** dentro il deployment vivo:

| Percorso | Cos'è | Cosa ho fatto |
|---|---|---|
| `/home/ubuntu/server-stack/paramount-stremio/` | **Il deployment vivo** (compose project `paramount-stremio`: container `paramount-stremio` + `sing-box`) | Deploy dei file DVR, rebuild ×2 |
| `.../lib/paramount/sports.ts` | logica sport | Strumentazione temporanea debug (v2+v4) → **ripristinato pulito** |
| `.../.env` | env container | Aggiunto `DUMP_IRDETO=1` per il debug → **rimosso** |
| `.../app/api/stremio/[key]/proxy/dvr/route.ts` | **NUOVO** — playlist DVR | creato |
| `.../app/api/proxy/[sid]/dvrseg/route.ts` | **NUOVO** — proxy segmenti DVR | creato |
| `.../lib/paramount/proxy/dvr.ts` | **NUOVO** — logica pura DVR | creato |
| `.../app/api/stremio/[key]/stream/.../route.ts` | route stream | modificato (stream DVR + fix isLive) |
| `/tmp/` (VPS) | file temporanei | i miei script/segmenti di test → **puliti**. Restano file **tuoi** precedenti (`debug-live-listings.cjs`, `mpd2.xml`, `seg.ts`, ...) — non li ho toccati |
| Volume Docker `paramount-stremio_paramount-data` | dati persistenti (sessioni) | solo lettura (install-tokens) |

⚠️ **Nota importante — divergenza git sulla VPS:** la VPS è ferma a `c281b32` con modifiche **non committate** che equivalgono ai commit locali `d0e42a1..2145781` (migrazione VLESS) + i file DVR. Il contenuto dei file è allineato al main locale, ma **via scp, non via git**. Prima o poi conviene riallineare: sulla VPS `git stash && git pull && git stash pop` (o equivalentemente verificare che lo stash sia vuoto dopo il pull). Non l'ho fatto autonomamente per non rischiare di toccare il tuo albero.

---

## 5. La funzione DVR "From Start" — il ragionamento completo

### 5.1 Il problema
Sugli eventi live l'addon serviva solo la finestra live (~102s di segmenti): impossibile guardare dall'inizio o fare seek indietro. L'app nativa Paramount+ lo permette ("Restart Available").

### 5.2 L'investigazione (i passi, con i vicoli ciechi)
1. **API Irdeto**: la risposta `session-token.json` NON contiene campi DVR/restart. Parametri `startOver`/`playbackMode`/`mode` ignorati; endpoint `restart-token.json` → 404. ❌
2. **Google DAI**: nessun manifest alternativo (`/live/`, `/ndvr/`, `?dvr=1` → tutti fail). Solo HLS (DASH 404). ❌
3. **Catalogo Replay**: i replay vengono pubblicati solo a partita finita → non risolvono il "guarda dall'inizio durante il live". ❌
4. **Indizio decisivo**: il listing raw contiene `"videoProperties": [..., "DVR", ...]` → il flusso È abilitato DVR a monte. ✅
5. **Architettura dei segmenti**: la media playlist DAI usa segmenti **numerati in modo assoluto e sequenziale** (`manifest_3_{N}.ts`) su `airspace-cdn.cbsivideo.com` con token statico `?m=`, AES-128 con **chiave e IV statici per tutto l'evento**.
6. **Test decisivo**: ho costruito a mano gli URL proxy dell'addon per segmenti **vecchi** (N=0, 50, 200, ..., 1400) → **tutti HTTP 200 con dati reali**. Il CDN conserva l'intera partita. Inoltre il segmento 0 si decripta correttamente con la chiave attuale (sync byte `0x47` valido) → niente rotazione chiavi. ✅✅

### 5.3 Ostacolo superato: i 403
Le chiamate dirette (curl/axios freschi) al CDN video e ad apps-api ricevevano **403 (Fastly)**, mentre l'addon in-process funzionava sempre. Causa: **fingerprinting TLS/connessione** — l'httpClient dell'addon usa connessioni keepAlive longeve e riusate; le connessioni nuove vengono bloccate. Per l'investigazione ho quindi **strumentato l'addon stesso** (patch temporanea in sports.ts, gated da `DUMP_IRDETO=1`) invece di usare script esterni. Tutto l'output del DVR passa quindi **sempre per il proxy dell'addon**, che è l'unico egress affidabile.

### 5.4 L'implementazione (3 pezzi)
1. **`lib/paramount/proxy/dvr.ts`** (logica pura, testabile): parse della media playlist live → estrae KEY line, target duration, media-sequence, segmenti numerati; sintetizza una playlist **`#EXT-X-PLAYLIST-TYPE:EVENT`** dal segmento 0 al live edge. Gestisce entrambi i casi AES: IV esplicito (una KEY line) e IV derivato dal media-sequence (KEY allineata o per-segmento con IV calcolato). Durate reali per la finestra live, media per i segmenti più vecchi. Cap difensivo 20k segmenti.
2. **`app/api/stremio/[key]/proxy/dvr/route.ts`**: fetch master → selezione variante (bandwidth più alta, o closest a `b`) → fetch media playlist → sintesi → cache output 4s (il player ricarica spesso). Fallback: se i segmenti non sono numerati, restituisce la finestra live riscritta.
3. **`app/api/proxy/[sid]/dvrseg/route.ts`**: recupera il segmento `n` ricostruendo l'URL CDN da un template in cache (sid compatto → playlist leggere, ~60 char/segmento invece di ~2400).

Nella **stream route**: per gli eventi sportivi **live** viene aggiunto lo stream **"⏪ From Start (DVR)"** con `isLive: false` (esperienza VOD-like: parte dall'inizio, seek libero, playlist che cresce verso il live edge).

### 5.5 I test
- **15 unit test** con dati **reali registrati** dalla partita Juventus–Parma del 29/08 (playlist DAI vera): parse, selezione variante, template, struttura EVENT, proxy KEY line, gestione IV nei 3 casi, cap. Suite completa: **125/125 pass**.
- **Verifiche su VPS**: percorsi d'errore corretti (400 parametri mancanti, 401 chiave invalida, 502 upstream morto — prova che il fetch path funziona, 404 sid sconosciuto).
- **Test E2E su partita vera**: pianificato su Napoli–Como (30/08 ore 15:30) — lo testi tu da Stremio; se qualcosa non va dimmi il sintomo e debuggo dai log.

---

## 6. Fix isLive (bug del loop infinito sui replay)

Prima: **tutti** gli stream (live, replay, VOD) avevano `isLive: true`. I player trattano i playlist finiti come live → su desktop i replay andavano in **loop infinito**. Ora: `isLive` è `true` solo per canali live ed eventi sportivi con `status === "live"`; replay e VOD → `false` (seek bar corretta, fine riproduzione normale).

---

## 7. Stato raggiunto

| Funzione | Stato |
|---|---|
| Catalogo sport (live/upcoming/replay, preferenze, leghe) | ✅ funzionante |
| Live HLS proxato (desktop + web) | ✅ funzionante |
| **DVR "From Start" su eventi live** | ✅ implementato, deployato, unit-testato — **manca solo la verifica E2E su partita live** |
| Fix loop replay desktop (isLive) | ✅ deployato (da confermare col tuo test) |
| Replay (MPD+Widevine) | ⚠️ desktop ok, **web no** (limitazione DRM del player web di Stremio) |
| Android | ❌ da diagnosticare |
| Firestick | ❓ non testato |
| VPN/VLESS (sing-box, wizard /configure) | ✅ funzionante (probe: sing-box alive, proxy legacy throttled) |

---

## 8. Problematiche aperte / debiti tecnici

1. **Divergenza git VPS ↔ locale** (vedi §4): allineare con stash+pull.
2. **sid in-process**: le playlist DVR/MPD referenziano sid in memoria; un restart dell'addon a partita in corso rompe il playback (bisogna riaprire lo stream). Accettabile per ora, documentato.
3. **Replay su web**: architetturale (MPD+Widevine non supportato bene dal player web Stremio). Possibili strade: transcodifica lato server (pesante) o accettare la limitazione.
4. **Android**: mai diagnosticato in dettaglio — prossimo passo di debug (log + confronto richieste).
5. **Discontinuity nei segmenti vecchi**: la playlist DVR sintetica non ricostruisce i tag `EXT-X-DISCONTINUITY` degli ad-break passati (non conoscibili dalla finestra live). Possibili micro-glitch ai confini pubblicitari; la decriptazione resta corretta (chiave/IV uniformi).

---

## 9. Prossimi passi consigliati (in ordine)

1. **Test DVR su partita live** (oggi 15:30 Napoli–Como, 18:00 Cagliari–Inter e Lazio–Genoa) → aprire l'evento in Stremio e scegliere "⏪ From Start (DVR)".
2. Riallineare git sulla VPS (stash + pull).
3. Push del commit locale `d1b6957` (main è ahead 1).
4. Diagnosi Android.
5. Decisione replay web (accettare limitazione o investire in transcodifica).
## 2026-08-30 — Vista LIVE-ONLY (decisione finale sui replay)

**Diagnosi DRM** (sessione di test Napoli–Como replay):
- Replay/VOD Paramount+ = **solo DASH MPD con Widevine CENC** (`encv`/`pssh`/`tenc` verificati nell'init segment).
- Stremio **desktop** usa mpv → nessun supporto Widevine → riproduce i segmenti cifrati grezzi (video illeggibile).
- Stremio **web** (EME) → il flusso licenza via proxy non completa (nessuna richiesta `/license` arrivata o Irdeto rifiuta).
- **Live + DVR "From Start" = HLS AES-128** → funziona su tutti i client (desktop, web, Android, TV).

**Fix tecnici correlati** (commit `0ea8ecc`, `e0f237e`):
- Iniezione `<ms:laurl>` nei ContentProtection Widevine dell'MPD.
- XML-escape degli URL proxy iniettati: un `&` crudo rendeva l'MPD malformato (il player lo rifiutava in parsing senza mai chiedere licenza/segmenti).

**Decisione**: rimossi Upcoming e Replay dai cataloghi; resta solo **Live**.
- Slider home "Sport" → `pplus_sports_live` "Live adesso" (eventi live delle 4 leghe curate, ordinati per inizio).
- Genre options dei cataloghi: solo `Live` (+ nomi leghe in "Altro").
- `getLeagueEvents(..., includeReplays=false)` → niente chiamate VOD catch-up (più veloce).
- Il codice replay in `sports.ts` resta (usato da `findSportEvent` per stream resolution) ma non è più esposto nei cataloghi.
