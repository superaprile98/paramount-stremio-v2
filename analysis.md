# Analisi, Setup e Diagnostica: Add-on Stremio per Paramount+ (Live vs DRM)

---

## 1. Preludio e Obiettivo del Progetto

L'obiettivo iniziale era integrare i contenuti di **Paramount+ USA** (nello specifico match sportivi, dirette UEFA Champions League, canali Live TV e replay on-demand) all'interno del client **Stremio Desktop**.

Dovendo gestire l'accesso e le chiamate API dall'Italia verso server statunitensi soggetti a restrizioni geografiche, è stato predisposto un proxy HTTP (Webshare).

### Dettagli Rete e Proxy
* **Provider:** Webshare
* **Tipo Autenticazione:** IP Authentication (whitelist dell'IP pubblico 87.19.189.25)
* **Endpoint Proxy USA:** http://31.56.127.193:7684
* **Test di connettività:**
  * Da host/WSL via cURL:
    ```bash
    curl -x http://31.56.127.193:7684 https://api.ipify.org
    # Output: 31.56.127.193 (Proxy funzionante)
    ```
  * Da container Docker (runtime Node.js / Undici):
    ```bash
    docker exec -it Paramount-Stremio node -e "fetch('https://api.ipify.org', { dispatcher: new (require('undici').ProxyAgent)('http://31.56.127.193:7684') }).then(r => r.text()).then(console.log).catch(console.error)"
    # Output: 31.56.127.193
    ```

---

## 2. Adozione dell'Add-on `paramount-stremio`

È stato individuato il progetto open-source [RioNoir/paramount-stremio](https://github.com/RioNoir/paramount-stremio), un add-on per Stremio basato su **Next.js / Node.js** progettato per interfacciarsi con le API di Paramount+, gestire il login e fare da relay per i flussi streaming.

### Setup Locale e Repository Privato
Per consentire lo sviluppo, il debug e la modifica del codice sorgente mantenendo la riservatezza delle modifiche, il codice è stato importato in un repository privato su GitHub:
* **Nuovo repository privato:** https://github.com/superaprile98/paramount-stremio-v2.git
* **Allineamento iniziale:**
  ```bash
  git clone https://github.com/RioNoir/paramount-stremio.git paramount-stremio-local
  cd paramount-stremio-local
  git remote set-url origin https://github.com/superaprile98/paramount-stremio-v2.git
  git push -u origin main --force
  ```

### Configurazione Docker Compose (`docker-compose.yml`)
```yaml
services:
  paramount-stremio:
    build: .
    container_name: Paramount-Stremio
    environment:
      - BASE_URL=http://localhost:7850
      - KEY_SECRET=4f9a2b8c1d3e5f7a9b0c2d4e6f8a1b3c
      - PORT=7850
      - HTTP_PROXY=http://31.56.127.193:7684
    restart: unless-stopped
    ports:
      - "7850:7850"
```

### Autenticazione e Manifest
1. Accesso all'interfaccia di configurazione locale: http://localhost:7850/configure
2. Generazione del **Device Code** (estratto tramite DevTools Network alla chiamata `/api/auth/device/start`).
3. Convalida del codice su https://www.paramountplus.com/activate/ tramite sessione con IP USA.
4. Generazione del **Manifest URL** e installazione dell'add-on all'interno di Stremio.

---

## 3. Problemi Riscontrati e Diagnostica Tecnica

Una volta configurato l'add-on, il comportamento riscontrato in fase di riproduzione video si è differenziato a seconda della natura del contenuto:

### Comportamento Riscontrato
1. **Canali Live TV / Dirette Sportive in tempo reale (es. CBS Sports Golazo Network):**  
   * **Esito:** Funzionano regolarmente.
   * **Dettaglio:** I flussi HLS in chiaro (`.m3u8` e segmenti `.ts`) vengono proxati dal backend locale (`/proxy/hls`, `/proxy/seg`) e riprodotti fluidamente dal player di Stremio.

2. **Match Replay / VOD / Serie TV / Film (es. UEFA Champions League Replay):**  
   * **Esito:** Il video parte, mostra circa 5-6 secondi di flusso (anteprima/bumper iniziale), poi va in blocco permanente o schermo nero con caricamento infinito.

### Analisi dei Log e Causa Root (Widevine DRM)
Dall'analisi combinata dei log del container Docker e della dashboard di attività del proxy Webshare:

* **Chiamata di licenza DRM:**  
  Durante il caricamento del Replay viene effettuata una chiamata verso `cbsi.live.ott.irdeto.com` (server di licenze **Irdeto / Widevine DRM**).
* **Interruzione del download segmenti:**  
  Il container scarica i primi 3-4 frammenti video non protetti (circa 105 KB ciascuno da `prope7494a53.airspace-cdn.cbsivideo.com`), dopodiché il flusso si blocca. Nei log successivi compaiono unicamente chiamate analitiche/telemetriche verso `dai.google.com`.
* **Incompatibilità del Client Stremio:**  
  L'add-on originario dichiara esplicitamente nelle sue specifiche:
  > *"Automatically generated catalogs/meta (currently only live TV and sports) - Auto-proxed streams directly from the addon (currently only HLS streams work)"*  
  I contenuti on-demand e i replay di Paramount+ utilizzano flussi protetti da **Widevine DRM**. Poiché il player desktop di Stremio (basato su MPV/ExoPlayer standard) non include il modulo CDM per decifrare le chiavi Widevine fornite da Irdeto, non è in grado di riprodurre il video protetto.

---

## 4. Requisiti per il Refactoring / Fix

Per rendere fruibili anche i contenuti protetti da DRM (Replay e VOD) all'interno dell'ecosistema Stremio tramite questo repository privato (`paramount-stremio-v2`), il backend dell'add-on deve essere modificato per superare l'incapacità del player di Stremio di decifrare flussi Widevine.

### Interventi Necessari da Progettare:
1. **Integrazione CDM / Decrittazione lato Server (Proxy Transcoder):**
   * Implementare nel backend Node.js (o tramite modulo ausiliario Python/Rust/FFmpeg) un client Widevine (CDM L3).
   * Intercettare la richiesta di licenza verso `cbsi.live.ott.irdeto.com`, estrarre le chiavi di decifratura (KID:KEY) e decifrare al volo i blocchi cifrati (`.m4s` / `.mpd` / `.ts`).
2. **Remuxing / HLS Streaming in Chiaro:**
   * Ricomporre i segmenti decifrati in una playlist HLS standard (`.m3u8`) non protetta servita dagli endpoint `/proxy/hls` e `/proxy/seg`.
   * Esporre lo stream decifrato a Stremio come normale flusso HLS in chiaro, eliminando la necessità di supporto DRM da parte del player client.
3. **Estensione Cataloghi e Metadati:**
   * Estendere `src/app/api/stremio/` e `manifest.ts` per indicizzare non solo i canali Live, ma anche i cataloghi VOD/Replay con i relativi metadati completi.