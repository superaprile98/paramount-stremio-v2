# Piano di Ristrutturazione /configure

## Diagnosi

### Problema 1: UI caotica
La pagina `/configure` e la `vpn-card` usano troppi colori:
- `emerald` per badge delay, bottoni, bordi attivi
- `amber` per delay medio, banner local address
- `orange` per delay alto, geo-block
- `red` per delay critico, errori
- `sky` per serverTag, free source button
- `blue` per speed test, login input focus, quick picks
- `green` per stato attivo
- `purple` per link footer

Risultato: sembra una dashboard di monitoraggio, non una configurazione utente.

### Problema 2: Metrica delay non rappresentativa
- Voce attiva: Clash API → HTTP probe through tunnel (metric REALISTIC)
- Voci non attive: TCP dial → solo handshake (NON rappresentativo)
- L'utente vede 12ms TCP ma lo streaming lagga perché non c'è test di throughput reale

### Problema 3: Nessun auto-failover
- Se un nodo muore durante lo streaming, i segmenti HLS falliscono silenziosamente
- L'utente deve manualmente switchare nodo
- Non c'è health-check periodico

### Problema 4: Free sources manuali
- L'utente deve cliccare "Aggiorna sorgente gratuita"
- Non c'è refresh automatico server-side

### Problema 5: Nessuna raccomandazione automatica
- Dopo un delay test, l'utente deve manualmente selezionare il nodo migliore
- Non c'è auto-race tra voci diverse

---

## Fase 1 — UI Minimale Apple-style (NOW)

### Principi di design
- **Paletta**: solo `gray-50/100/200/300/500/700/900` + un accento `emerald-600` per elementi interattivi
- **Zero badge colorati**: niente bg-emerald, bg-amber, bg-red, bg-sky, bg-blue
- **Zero icone decorative nell'header**: solo testo
- **Azioni dentro pannelli espandibili**: Attiva/Delay/Speed/Elimina non in vista sempre
- **Stato attivo**: solo un pallino verde `●` + testo "Attivo", niente badge
- **Delay**: solo testo grigio, niente colore
- **Select nativo**: pulito, senza decorazioni

### File da modificare

#### 1. `app/configure/vpn-card.tsx` — Riscrittura completa
- Rimuovere TUTTE le icone SVG inline (IconPlus, IconTrash, IconCheck, IconPing, IconSpeed, IconChevronDown, IconChevronRight, IconRefresh, IconShield, Spinner)
- Sostituire con testo semplice o emoji minimali (`→`, `✕`, `●`)
- Rimuovere `delayChip()` — sostituire con testo grigio semplice
- Ristrutturare la riga server: solo `nome + kind + ● attivo + →`
- Azioni (Attiva/Delay/Speed/Elimina) dentro il pannello espandibile
- Pannello nodi: select nativo, delay in testo grigio
- Header card: solo "VPN" + bottone "Aggiungi" minimali
- Form input: stile coerente con resto pagina

#### 2. `app/configure/page.tsx` — Unificare stile
- `Card` component: stesso stile della vpn-card (bordi, padding, font)
- Login card: stile coerente (stessi input, stessi bottoni)
- Sports prefs: stile coerente
- Install card: stile coerente
- Footer: stile coerente
- Rimuovere colori blu dal titolo "Unofficial Paramount+"
- Sostituire emoji colorati con testo semplice

#### 3. `app/globals.css` — Eventuali aggiustamenti
- Aggiungere variabili per accento unico se necessario

### Risultato atteso Fase 1
Tutta la pagina `/configure` sembra una pagina delle Impostazioni di sistema:
- Card grigie con bordi sottili
- Testo grigio scuro su sfondo bianco
- Unico accento emerald-600 per bottoni primari
- Zero badge colorati
- Zero icone decorative
- Informazioni chiare e gerarchia visiva pulita

---

## Fase 2 — Metrica Reale + Auto-Failover (DOPO FASE 1)

### 2.1 Metrica reale
**Già implementato (ma non etichettato chiaramente)**:
- Voce attiva → Clash API (HTTP probe through tunnel) → delay REALE
- Voci non attive → TCP dial → solo handshake

**Cosa aggiungere**:
- Etichettare chiaramente nella UI: "Tunnel" vs "TCP handshake"
- Aggiungere metrica `via` nel salvataggio e mostrarla
- Speed test (già implementato) come metrica complementare

### 2.2 Health-check periodico server-side
**Nuovo file**: `lib/vpn/health-check.ts`
- `setInterval` ogni 5 minuti
- Per ogni utente con voce attiva:
  - Testa il nodo attivo via Clash API
  - Se fallisce per 3 check consecutivi → auto-switch al miglior nodo della stessa voce
  - Se tutti i nodi della voce falliscono → auto-switch alla prossima voce salvata
  - Logga l'evento

**Modifiche**:
- `app/api/configure/vpn-switch/route.ts` — esporre endpoint per auto-switch programmatico
- `lib/vpn/user-storage.ts` — aggiungere campo `health: { failures: number, lastOk: string }`

### 2.3 Streaming error hook
**Modifiche**:
- `app/api/stremio/[key]/proxy/seg/route.ts` — intercettare errori HTTP nel proxy segmenti
- Quando un segmento fallisce (4xx/5xx/timeout), segnare il nodo come "degraded"
- Se N errori consecutivi → trigger auto-failover

---

## Fase 3 — Cron Free Sources + Auto-Race (DOPO FASE 2)

### 3.1 Cron job server-side
**Nuovo file**: `lib/vpn/cron-refresh.ts`
- `setInterval` ogni 6 ore
- Per ogni utente con `autoProvisioned`:
  - Fetcha openproxylist
  - Delay-testa i nuovi nodi
  - Se i nuovi nodi sono migliori dell'attuale → aggiorna la lista
  - Notifica in UI (flag `hasUpdate` nello store)

**Modifiche**:
- `lib/vpn/user-storage.ts` — aggiungere campo `pendingUpdate: boolean`
- `app/api/configure/free-sources/route.ts` — endpoint GET restituisce anche `pendingUpdate`

### 3.2 Auto-race
**Dopo ogni refresh**:
- Delay test su tutti i nodi di tutte le voci
- Seleziona automaticamente il migliore
- Mostra in UI: "Miglior server: XYZ (45ms tunnel)"

### 3.3 Notifica UI
- Se il cron trova nodi migliori → mostra notifica "Nuovi server disponibili, vuoi usarli?"
- Bottone "Usa migliori" che attiva lo switch

---

## Diagramma Architetturale

```mermaid
flowchart TD
    subgraph Client [Browser - /configure]
        UI[Pagina Configure]
        AutoTest[Auto-test on load]
        Notifica[Notifica aggiornamento]
    end

    subgraph Server [Next.js API]
        VPN_Servers[/api/configure/vpn-servers]
        VPN_Switch[/api/configure/vpn-switch]
        VPN_Delay[/api/configure/vpn-delaytest]
        VPN_Speed[/api/configure/vpn-speedtest]
        FreeSources[/api/configure/free-sources]
        HealthCheck[Health Check 5min]
        CronRefresh[Cron Refresh 6h]
    end

    subgraph Backend [Infrastruttura]
        SingBox[sing-box multi-tenant]
        ClashAPI[Clash API :9090]
        UserStore[user-storage.json]
        OpenProxy[openproxylist.com]
    end

    UI --> VPN_Servers
    UI --> VPN_Switch
    UI --> VPN_Delay
    UI --> VPN_Speed
    UI --> FreeSources

    VPN_Delay --> ClashAPI
    VPN_Delay --> SingBox
    VPN_Switch --> SingBox

    HealthCheck --> ClashAPI
    HealthCheck --> VPN_Switch
    HealthCheck --> UserStore

    CronRefresh --> OpenProxy
    CronRefresh --> VPN_Delay
    CronRefresh --> UserStore

    FreeSources --> OpenProxy
    FreeSources --> UserStore
```

---

## Todo List Esecuzione

### Fase 1 — UI (priorità massima)
1. Riscrivere `vpn-card.tsx` con design minimale (solo gray + emerald accent)
2. Unificare stile in `page.tsx` (stessa palette per tutte le card)
3. Rimuovere icone SVG decorative, sostituire con testo/emoji minimali
4. Spostare azioni dentro pannelli espandibili
5. Test visivo: tutta la pagina deve avere stile coerente

### Fase 2 — Metrica + Failover
6. Etichettare chiaramente "Tunnel" vs "TCP handshake" nella UI
7. Implementare health-check periodico server-side (5 min)
8. Implementare auto-failover su N fallimenti consecutivi
9. Aggiungere streaming error hook nel proxy segmenti

### Fase 3 — Cron + Auto-Race
10. Implementare cron job per refresh automatico free sources (6h)
11. Implementare auto-race (delay test + selezione miglior nodo)
12. Aggiungere notifica UI per nuovi server disponibili