# Refine UI: pulizia finale della card VPN

Basato sul feedback dopo il deploy di Fase 1+2.

## Diagnosi

### 1. Speed test inutile (sempre 0/0 Mbps)
Il test [`lib/vpn/speedtest.ts`](lib/vpn/speedtest.ts:1) scarica 12 MB da `speed.cloudflare.com` attraverso il proxy agent HTTP dell'utente. Per tunnel VLESS:
- Il proxy agent instrada su `http://127.0.0.1:8888` (inbound sing-box)
- Molti server VLESS non gestiscono bene download/upload grandi via HTTP proxy
- Risultato: `downMbps: 0, upMbps: 0` sempre

La metrica **realmente utile** per lo streaming è il **delay via tunnel** (Clash API probe) — misura la latenza attraverso il proxy attivo, che è ciò che determina se lo streaming è fluido.

**Azione**: rimuovere il pulsante "Speed test" e ogni riferimento a `lastSpeedTest` nella UI.

### 2. UI ancora troppo caotica
Il pannello espandibile (righe 549-672 di `vpn-card.tsx`) contiene:
- 5 bottoni azione in flex-wrap (`Attiva`/`Attivo`, `Delay test`, `Speed test`, `✕ Rimuovi`, `Disattiva`)
- Radio button nodi (`Auto` + N nodi)
- Testo metriche
- Testo esplicativo

Troppe cose in 200px di altezza.

**Azione**:
- Spostare `✕ Rimuovi` sulla **riga principale del server** (accanto al nome), non dentro il pannello
- Rimuovere `Speed test` (punto 1)
- Rimuovere `Disattiva` (ridondante: c'è già `Attiva` per switchare, e `✕ Rimuovi` per rimuovere)
- Risultato: nel pannello restano solo `Attiva`/`Attivo` + `Delay test` + radio nodi

### 3. Free sources non devono essere esposte
Le free sources sono auto-provisionate silenziosamente (righe 266-271 di `vpn-card.tsx`):
```ts
useEffect(() => {
    if (savedServers.length === 0 && !freeSourceInfo?.hasAutoProvisioned && !freeSourceLoading) {
        loadFreeSource(false);
    }
}, [savedServers.length, freeSourceInfo?.hasAutoProvisioned]);
```

Appaiono come server normali con kind `free` nella lista "Server salvati". L'utente non deve vederle — sono infrastruttura di default.

**Azione**:
- Filtrare i server con `kind === "free"` dalla lista visiva "Server salvati"
- Rimuovere il bottone `↻ Aggiorna sorgente gratuita`
- Mantenere l'auto-provisioning silenzioso in background
- Mostrare un contatore discreto tipo "Include N server gratuiti" in grigio chiaro

## Modifiche ai file

### `app/configure/vpn-card.tsx`

1. **Rimuovere Speed test**: eliminare il pulsante (righe 577-585), eliminare `testingId`, `setTestingId`, `speedTest()`, `formatSpeed()`, `lastSpeedTest` dal type `SavedServer`.

2. **Spostare ✕ Rimuovi sulla riga principale**: aggiungere un bottone `✕` piccolo sulla destra della riga del server (riga 523-546), fuori dal pannello espandibile. Rimuoverlo da dentro il pannello (righe 587-591).

3. **Rimuovere Disattiva**: eliminare le righe 592-598 (bottone Disattiva dentro pannello). `clearAll()` rimane per uso interno ma non serve un bottone dedicato.

4. **Filtrare free sources dalla lista**: nel `.map()` a riga 511, filtrare `savedServers.filter(s => s.kind !== "free")`. Aggiungere un testo grigio sotto il counter tipo `· ${savedServers.filter(s => s.kind === "free").length} gratuiti`.

5. **Rimuovere bottone "↻ Aggiorna sorgente gratuita"**: eliminare righe 502-508.

### `app/api/configure/vpn-speedtest/route.ts`
Nessuna modifica — l'API rimane per compatibilità, semplicemente non la chiamiamo più dalla UI.

## Diagramma: layout finale della riga server

```
┌──────────────────────────────────────────────────────────────┐
│  ▸  server-label  [kind]  ● Attivo              ✕          │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  [Attiva]  [Delay test]                               │ │
│  │                                                        │ │
│  │  Metriche: 45 ms via tunnel (3/5 ok)                  │ │
│  │                                                        │ │
│  │  ○ Auto — failover su tutti i nodi       45 ms         │ │
│  │  ○ node-us-01  1.2.3.4:443               32 ms         │ │
│  │  ○ node-us-02  5.6.7.8:443               51 ms         │ │
│  │  ...                                                  │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

## Todo

- [ ] Rimuovere `speedTest()`, `testingId`, `formatSpeed()`, `lastSpeedTest` da vpn-card.tsx
- [ ] Spostare `✕ Rimuovi` sulla riga principale del server
- [ ] Rimuovere `Disattiva` dal pannello
- [ ] Filtrare `kind === "free"` dalla lista server salvati
- [ ] Rimuovere bottone "↻ Aggiorna sorgente gratuita"
- [ ] Aggiungere testo "N gratuiti" sotto il counter
- [ ] Typecheck + build
- [ ] Deploy su VPS via SSH