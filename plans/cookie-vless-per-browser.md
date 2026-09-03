# Piano: Toast neutro + VLESS per-browser (cookie identity)

## Problemi identificati

### 1. Toast rosso
Il componente [`Toast`](app/configure/page.tsx:102) usa `bg-red-600` per `type === "error"`. La VPN card chiama `onToast("❌ ...")` su ogni fallimento, producendo un pallino rosso rimbalzante che l'utente giudica "fa schifo".

### 2. VLESS condiviso tra browser
Lo storage VPN è già per-utente, ma la chiave è il **login username** ([`sanitizeUserId(session.u)`](lib/auth/configure-auth.ts:95)). Se due browser fanno login con le stesse credenziali, condividono lo stesso file cifrato → stessa lista VLESS.

L'utente chiede: "salvati su cookie, ognuno ha le sua".

## Soluzione

### Issue 1: Toast neutro
- Sostituire `bg-red-600` con `bg-gray-700` per `type === "error"` (stesso stile di `info`).
- Rimuovere `animate-bounce` (sostituire con `animate-fade-in` o niente).
- Il toast "error" diventa un pill grigio, non più rosso.

### Issue 2: Per-browser storage via `browser_id` cookie

**Approccio:** generare un `browser_id` casuale (16 byte hex) al primo accesso a `/configure`, salvarlo in un cookie `vpn_browser_id` (duratata 1 anno). Usare questo ID come chiave dello storage server-side, al posto dello username.

**Vantaggi:**
- Ogni browser ha il suo ID → ogni browser ha la sua lista VLESS
- Lo storage server-side (file cifrato) rimane invariato — cambia solo la chiave
- L'architettura multi-tenant sing-box continua a funzionare (porte allocate per browser_id)
- Se l'utente cancella i cookie → nuovo ID → lista vuota (come da aspettativa)

**File da modificare:**

| File | Cosa cambiare |
|------|--------------|
| [`app/configure/page.tsx`](app/configure/page.tsx:102) | Toast: `bg-red-600` → `bg-gray-700`, rimuovi `animate-bounce` |
| [`app/configure/page.tsx`](app/configure/page.tsx:113) | Aggiungere `useEffect` che genera/legge `vpn_browser_id` cookie |
| [`lib/auth/configure-auth.ts`](lib/auth/configure-auth.ts:95) | `requireConfigureUser()` → leggere anche cookie `vpn_browser_id`, ritornare `browserId` |
| [`app/api/configure/vpn-servers/route.ts`](app/api/configure/vpn-servers/route.ts) | Tutti i `auth.userId` → `auth.browserId` |
| [`app/api/configure/vpn-switch/route.ts`](app/api/configure/vpn-switch/route.ts) | `auth.userId` → `auth.browserId` |
| [`app/api/configure/vpn-delaytest/route.ts`](app/api/configure/vpn-delaytest/route.ts) | `auth.userId` → `auth.browserId` |
| [`app/api/configure/free-sources/route.ts`](app/api/configure/free-sources/route.ts) | `auth.userId` → `auth.browserId` |
| [`app/api/configure/vpn-speedtest/route.ts`](app/api/configure/vpn-speedtest/route.ts) | `auth.userId` → `auth.browserId` (se ancora presente) |
| [`lib/vpn/reconfigure.ts`](lib/vpn/reconfigure.ts) | `loadUserVpnStore(uid)` → `loadUserVpnStore(uid)` (uid ora è browserId, funziona uguale) |
| [`lib/vpn/user-proxy.ts`](lib/vpn/user-proxy.ts) | Porte allocate per browserId invece che userId (nessun cambio logico) |

**Dettaglio implementazione:**

#### Passo 1: Cookie `vpn_browser_id` in page.tsx

```tsx
// In ConfigurePage(), aggiungere:
const [browserId, setBrowserId] = useState<string | null>(null);

useEffect(() => {
    const existing = document.cookie
        .split("; ")
        .find((r) => r.startsWith("vpn_browser_id="));
    if (existing) {
        setBrowserId(existing.split("=")[1]);
    } else {
        const id = Array.from({ length: 16 }, () =>
            Math.floor(Math.random() * 16).toString(16)
        ).join("");
        document.cookie = `vpn_browser_id=${id}; path=/; max-age=${365 * 24 * 60 * 60}; SameSite=Lax`;
        setBrowserId(id);
    }
}, []);
```

#### Passo 2: Modificare `requireConfigureUser()` in configure-auth.ts

```ts
export async function requireConfigureUser(req: NextRequest): Promise<{
    userId: string;
    username: string;
    browserId: string;
} | null> {
    const session = await verifyConfigureSession(req.cookies.get(CONFIG_COOKIE)?.value);
    if (!session) return null;
    const browserId = req.cookies.get("vpn_browser_id")?.value;
    if (!browserId) return null; // nessun browser_id → nega (non dovrebbe succedere)
    return {
        userId: sanitizeUserId(session.u),
        username: session.u,
        browserId, // ← usato come chiave storage
    };
}
```

#### Passo 3: Sostituire `auth.userId` → `auth.browserId` in tutte le API route

In ogni route protetta, cercare `auth.userId` e sostituire con `auth.browserId`. Esempio:

```ts
// PRIMA
const store = await loadUserVpnStore(auth.userId);
ensureUserPort(auth.userId);

// DOPO
const store = await loadUserVpnStore(auth.browserId);
ensureUserPort(auth.browserId);
```

#### Passo 4: Delay test — prefisso Clash API

In [`app/api/configure/vpn-delaytest/route.ts`](app/api/configure/vpn-delaytest/route.ts:100):
```ts
// PRIMA
const tagPrefix = `u${auth.userId}-`;

// DOPO
const tagPrefix = `u${auth.browserId}-`;
```

#### Passo 5: Toast neutro

In [`app/configure/page.tsx`](app/configure/page.tsx:102-109):
```tsx
function Toast({ msg, type = "success" }: { msg: string; type?: "success" | "error" | "info" }) {
    const colors = type === "error" ? "bg-gray-700" : type === "info" ? "bg-gray-700" : "bg-emerald-600";
    return (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full px-4 py-2 text-sm text-white shadow-lg z-50 ${colors}`}>
            {msg}
        </div>
    );
}
```

## Diagramma flusso

```mermaid
flowchart TD
    A[Browser carica /configure] --> B{Cookie vpn_browser_id?}
    B -->|No| C[Genera ID 16 byte hex]
    C --> D[Set cookie path=/ max-age=1y]
    B -->|Sì| E[Leggi ID dal cookie]
    D --> E
    E --> F[Login utente]
    F --> G[API VPN: auth.userId = login, auth.browserId = cookie]
    G --> H[loadUserVpnStore auth.browserId]
    H --> I[File cifrato: users/{browserId}/vpn-servers.enc]
    I --> J[Ogni browser ha il suo file]
```

## Verifica

- `npx tsc --noEmit` → 0 errori
- `npx eslint app/configure/page.tsx` → 0 errori
- `npx eslint lib/auth/configure-auth.ts` → 0 errori
- `npm run build` → success
- Test manuale: aprire /configure in due browser diversi, aggiungere VLESS diversi in ciascuno, verificare che le liste siano separate