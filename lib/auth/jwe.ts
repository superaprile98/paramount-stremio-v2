import { CompactEncrypt, compactDecrypt } from "jose";

async function to32BytesKey(secret: string): Promise<Uint8Array> {
    const data = new TextEncoder().encode(secret);
    const buf = await crypto.subtle.digest("SHA-256", data);
    return new Uint8Array(buf);
}

// P21: il placeholder "[random]" (presente nel docker-compose.yml di esempio)
// è una chiave nota pubblicamente: se l'utente non la cambia, chiunque può
// decifrare le sessioni JWE. Rifiutiamo l'avvio con il placeholder.
const PLACEHOLDER_SECRETS = new Set(["[random]", "random", "changeme", "change-me", "secret"]);

async function getKeyBytes(): Promise<Uint8Array> {
    const secret = process.env.KEY_SECRET;
    if (!secret) throw new Error("Missing KEY_SECRET");
    if (PLACEHOLDER_SECRETS.has(secret.trim().toLowerCase())) {
        throw new Error(
            "KEY_SECRET is set to a known placeholder value. " +
            "Generate a strong random secret (e.g. `openssl rand -hex 32`) and set it in the environment."
        );
    }
    return await to32BytesKey(secret);
}

export async function seal(payload: object): Promise<string> {
    const keyBytes = await getKeyBytes();
    // @ts-expect-error: Uint8Array<ArrayBufferLike> non è assegnabile a BufferSource
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);

    const plaintext = new TextEncoder().encode(JSON.stringify(payload));
    const encrypted = await new CompactEncrypt(plaintext)
        .setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: "JWE" })
        .encrypt(key);
    // CompactEncrypt.encrypt() ritorna già la stringa JWE compatta (ASCII):
    // base64 via btoa è compatibile sia con Node sia con Edge runtime
    return btoa(encrypted);
}

export async function unseal(token: string): Promise<object> {
    const keyBytes = await getKeyBytes();
    // @ts-expect-error: Uint8Array<ArrayBufferLike> non è assegnabile a BufferSource
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);

    // btoa/atob sono disponibili sia in Node ≥ 18 sia in Edge runtime
    const jwe = atob(token);
    const { plaintext } = await compactDecrypt(jwe, key);
    const json = new TextDecoder().decode(plaintext);
    return JSON.parse(json);
}
