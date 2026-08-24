# Fix "Install in Stremio" & "Open in web app"

## Problema

1. **"Install in Stremio" → "Failed to fetch"**  
   `/api/install/[token]` restituisce un `302 redirect` al vero manifest. Stremio (desktop/mobile) esegue una GET sull'URL corta, riceve il 302, ma in alcune build **non segue il redirect** e va in errore.

2. **"Open in web app" apre solo la home di Stremio**  
   L'URL `https://app.strem.io/shell-v4.4?addon=...` non è più supportato dalla web app corrente. L'utente vede la home ma nessun prompt di installazione.

## Soluzione

### 1. `/api/install/[token]` → restituisce il manifest JSON direttamente

**File: `app/api/install/[token]/route.ts`**

- Rimuovere `NextResponse.redirect()`
- Risolvere il token → JWE key via `getSessionKey()`
- Istanzia un `ParamountClient`, carica la session, e costruisce il manifest (stessa logica di `manifest.json/route.ts`)
- Restituisce `NextResponse.json(manifest, { headers: cors })`

### 2. Estrarre `buildManifest()` in `lib/stremio/manifest.ts`

**Nuovo file: `lib/stremio/manifest.ts`**

```ts
export async function buildManifest(session: ParamountSession, baseUrl: string): Promise<object>
```

Contiene tutta la logica di costruzione del catalogo (curated + other leagues, genre options, CORS headers). Esportata come funzione pura e riutilizzata da:
- `app/api/stremio/[key]/manifest.json/route.ts` (invocata con `session` già validata)
- `app/api/install/[token]/route.ts` (invocata dopo risoluzione token)

### 3. Rimuovere il bottone "Open in web app" da `/configure`

**File: `app/configure/page.tsx`**

- Rimuovere `stremioWebInstallUrl` (righe 230-233 e usi)
- Mantenere solo:
  - ⚡ **Install in Stremio** (deep link `stremio://para.khnum.duckdns.org/api/install/<token>`)
  - 📋 **Copy URL** (testo normale, copia in clipboard)

### 4. Test E2E

- `curl -s https://para.khnum.duckdns.org/api/install/<token>` → JSON manifest valido (non redirect)
- `stremio://para.khnum.duckdns.org/api/install/<token>` da browser → apre Stremio e installa

## File da toccare

| File | Azione |
|------|--------|
| `app/api/install/[token]/route.ts` | Rewrite: da redirect a GET diretta con buildManifest |
| `lib/stremio/manifest.ts` | **Nuovo**: `buildManifest()` estratto da manifest route |
| `app/api/stremio/[key]/manifest.json/route.ts` | Sostituire corpo con `return NextResponse.json(await buildManifest(...))` |
| `app/configure/page.tsx` | Rimuovere `stremioWebInstallUrl` + bottone "Open in web app" |