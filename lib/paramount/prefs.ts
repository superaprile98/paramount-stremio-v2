/**
 * Preferenze per-profilo (Fase 3): squadre preferite + leghe nascoste.
 *
 * Persistenza: file JSON su disco (volume Docker) con fallback in-memory.
 * Le preferenze sono chiavate per profileId, così ogni profilo Paramount
 * ha la propria configurazione.
 */
import fs from "fs";
import path from "path";
import { SportPrefs, SportTeam } from "@/lib/paramount/sport-models";

const PREFS_DIR = process.env.PREFS_DIR || path.join(process.cwd(), ".data", "prefs");
const PREFS_FILE = path.join(PREFS_DIR, "sport-prefs.json");

const DEFAULT_PREFS: SportPrefs = { favoriteTeams: [], hiddenLeagues: [] };

// Fallback in-memory (usato se il filesystem non è scrivibile, es. Vercel).
const memoryStore = new Map<string, SportPrefs>();

function ensureDir() {
    try {
        fs.mkdirSync(PREFS_DIR, { recursive: true });
    } catch {
        // filesystem non scrivibile: usiamo la memoria
    }
}

function readAll(): Record<string, SportPrefs> {
    try {
        ensureDir();
        if (fs.existsSync(PREFS_FILE)) {
            const raw = fs.readFileSync(PREFS_FILE, "utf-8");
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") return parsed;
        }
    } catch {
        // fallback sotto
    }
    return {};
}

function writeAll(all: Record<string, SportPrefs>) {
    try {
        ensureDir();
        fs.writeFileSync(PREFS_FILE, JSON.stringify(all, null, 2), "utf-8");
    } catch {
        // filesystem non scrivibile: la memoria resta l'unica fonte
    }
}

/** Recupera le preferenze di un profilo. */
export function getPrefs(profileId: string | number): SportPrefs {
    const key = String(profileId);
    const fromDisk = readAll()[key];
    if (fromDisk) return { ...DEFAULT_PREFS, ...fromDisk };
    const fromMem = memoryStore.get(key);
    if (fromMem) return { ...DEFAULT_PREFS, ...fromMem };
    return { ...DEFAULT_PREFS };
}

/** Salva le preferenze di un profilo. */
export function setPrefs(profileId: string | number, prefs: SportPrefs): SportPrefs {
    const key = String(profileId);
    const clean: SportPrefs = {
        favoriteTeams: (prefs.favoriteTeams ?? []).filter((t) => t && t.name && t.key),
        hiddenLeagues: (prefs.hiddenLeagues ?? []).filter((s) => typeof s === "string" && s),
    };
    const all = readAll();
    all[key] = clean;
    writeAll(all);
    memoryStore.set(key, clean);
    return clean;
}

/** Aggiunge una squadra preferita (dedup per key). */
export function addFavoriteTeam(profileId: string | number, team: SportTeam): SportPrefs {
    const prefs = getPrefs(profileId);
    if (!prefs.favoriteTeams.some((t) => t.key === team.key)) {
        prefs.favoriteTeams.push(team);
    }
    return setPrefs(profileId, prefs);
}

/** Rimuove una squadra preferita. */
export function removeFavoriteTeam(profileId: string | number, teamKey: string): SportPrefs {
    const prefs = getPrefs(profileId);
    prefs.favoriteTeams = prefs.favoriteTeams.filter((t) => t.key !== teamKey);
    return setPrefs(profileId, prefs);
}

/** Nasconde una lega. */
export function hideLeague(profileId: string | number, leagueKey: string): SportPrefs {
    const prefs = getPrefs(profileId);
    if (!prefs.hiddenLeagues.includes(leagueKey)) {
        prefs.hiddenLeagues.push(leagueKey);
    }
    return setPrefs(profileId, prefs);
}

/** Mostra una lega nascosta. */
export function showLeague(profileId: string | number, leagueKey: string): SportPrefs {
    const prefs = getPrefs(profileId);
    prefs.hiddenLeagues = prefs.hiddenLeagues.filter((k) => k !== leagueKey);
    return setPrefs(profileId, prefs);
}
