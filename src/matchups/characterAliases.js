import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchFromS3 } from '../shared/s3Helper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ALIASES_PATH = path.join(__dirname, '../../data/character-aliases.json');
const CANONICAL_THREADS_PATH = path.join(__dirname, '../../data/canonical-character-threads.json');
const WEIGHT_CSV_PATH = path.join(__dirname, '../../data/stats/weight.csv');

/** S3 key for canonical character threads (same as in exportHandler). Source of truth across redeploys. */
export const CANONICAL_THREADS_S3_KEY = 'admin/canonical-character-threads.json';

/** Path to the local canonical character threads file (for reference; may be ephemeral on deploy). */
export const canonicalCharacterThreadsPath = CANONICAL_THREADS_PATH;

function parseCanonicalList(data) {
    if (!Array.isArray(data)) return [];
    return data.filter(s => typeof s === 'string');
}

/**
 * Read the canonical list of character thread names (Discord channel names from Match Ups (B-L) and (M-Z)).
 * Same format as the values in character-aliases.json (e.g. "mr-game-and-watch", "peach | daisy").
 * Loads from S3 first (persists across redeploys); falls back to local file if S3 key missing or unconfigured.
 * Refreshed when !export matchups or the weekly export runs. Returns [] if both S3 and local are missing/invalid.
 */
export async function getCanonicalCharacterThreads() {
    try {
        const data = await fetchFromS3(CANONICAL_THREADS_S3_KEY);
        return parseCanonicalList(data);
    } catch (_) {
        // S3 key missing or credentials not configured
    }
    try {
        const raw = fs.readFileSync(CANONICAL_THREADS_PATH, 'utf8');
        const data = JSON.parse(raw);
        return parseCanonicalList(data);
    } catch (_) {
        // Local file missing or invalid
    }
    return [];
}

// Related characters that should be fetched together
export const relatedCharacters = {
    "pokemon-trainer": ["squirtle", "ivysaur", "charizard"],
    "pyra": ["mythra"],
    "mythra": ["pyra"]
};

const DEFAULT_NICKNAME_ALIASES = {
    bayo: "bayonetta",
    banjo: "banjo-and-kazooie",
    "banjo & kazooie": "banjo-and-kazooie",
    "banjo and kazooie": "banjo-and-kazooie",
    bowser: "bowser",
    bowserj: "bowser-jr",
    bowserjr: "bowser-jr",
    brawler: "mii-brawler",
    bubba: "king-k-rool",
    capfalcon: "captain-falcon",
    "captain falcon": "captain-falcon",
    cf: "captain-falcon",
    char: "charizard",
    d3: "king-dedede",
    daisy: "peach | daisy",
    darkpit: "pit | dark-pit",
    "dark pit": "pit | dark-pit",
    dedede: "king-dedede",
    kingdedede: "king-dedede",
    dh: "duck-hunt",
    diddy: "diddy-kong",
    dq: "hero",
    "dq hero": "hero",
    hero: "hero",
    dk: "donkey-kong",
    "DK": "donkey-kong",
    "drmario": "dr-mario",
    "dr.mario": "dr-mario",
    "dr mario": "dr-mario",
    "game & watch": "mr-game-and-watch",
    "game and watch": "mr-game-and-watch",
    "G&W": "mr-game-and-watch",
    GaW: "mr-game-and-watch",
    ganon: "ganondorf",
    "g&w": "mr-game-and-watch",
    gunner: "mii-gunner",
    "ice climbers": "ice-climbers",
    iceclimbers: "ice-climbers",
    icies: "ice-climbers",
    incin: "incineroar",
    isa: "isabelle",
    ivy: "ivysaur",
    "King K Rool": "king-k-rool",
    "King K. Rool": "king-k-rool",
    "k.rool": "king-k-rool",
    "k rool": "king-k-rool",
    kaz: "kazuya",
    krool: "king-k-rool",
    lm: "little-mac",
    "little-mac": "little-mac",
    littlemac: "little-mac",
    luma: "rosalina-and-luma",
    m2: "mewtwo",
    mac: "little-mac",
    "meta-knight": "meta-knight",
    metaknight: "meta-knight",
    "mii brawler": "mii-brawler",
    "mii gunner": "mii-gunner",
    "mii swordfighter": "mii-swordfighter",
    "min min": "min-min",
    minmin: "min-min",
    mk: "meta-knight",
    megaman: "mega-man",
    "mega man": "mega-man",
    "Mr. G&W": "mr-game-and-watch",
    "mr g&w": "mr-game-and-watch",
    "mr-game-and-watch": "mr-game-and-watch",
    "p t": "pokemon-trainer",
    "pac man": "pac-man",
    "pac woman": "pac-man",
    mm: "mega-man",
    swordsfighter: "mii-swordfighter",
    brawler: "mii-brawler",
    gunner: "mii-gunner",
    palu: "palutena",
    peach: "peach | daisy",
    pika: "pikachu",
    pit: "pit | dark-pit",
    plant: "piranha-plant",
    pt: "pokemon-trainer",
    richter: "simon-richter",
    "richter belmont": "simon-richter",
    rosa: "rosalina-and-luma",
    rosalina: "rosalina-and-luma",
    "rosalina & luma": "rosalina-and-luma",
    "rosalina and luma": "rosalina-and-luma",
    seph: "sephiroth",
    Seph: "sephiroth",
    simon: "simon-richter",
    swordfighter: "mii-swordfighter",
    tink: "toon-link",
    "toon link": "toon-link",
    toonlink: "toon-link",
    wft: "wii-fit-trainer",
    "wii fit": "wii-fit-trainer",
    wiifit: "wii-fit-trainer",
    yink: "young-link",
    "young link": "young-link",
    younglink: "young-link",
    zard: "charizard",
    "zero suit samus": "zero-suit-samus",
    zss: "zero-suit-samus",
};

/** Returns the current nickname aliases (alias -> canonical). Loaded from data/character-aliases.json when present.
 *  Defaults are always merged in so built-in aliases (e.g. hero) work even when S3 overwrites the file at startup. */
export function getNicknameAliases() {
    const merged = { ...DEFAULT_NICKNAME_ALIASES };
    try {
        const raw = fs.readFileSync(ALIASES_PATH, 'utf8');
        const data = JSON.parse(raw);
        if (data && typeof data === 'object' && !Array.isArray(data)) {
            Object.assign(merged, data);
        }
    } catch (_) {
        // File missing or invalid: use defaults only
    }
    return merged;
}

/** @deprecated Use getNicknameAliases() for fresh data. Kept for backward compatibility. */
export const nicknameAliases = DEFAULT_NICKNAME_ALIASES;

export function normalizeCharacterText(text) {
    return text
        .toLowerCase()
        .replace(/['']s\b/g, "")           // Remove possessive 's (e.g., "peach's" -> "peach")
        .replace(/['']/g, "")              // Remove other apostrophes
        .replace(/[|︱｜]/g, "|")           // Normalize pipe characters
        .replace(/[^a-z0-9|\s\-]/g, " ")  // Remove special characters except pipes, spaces, hyphens
        .replace(/\s+/g, " ")              // Collapse multiple spaces
        .trim();
}

/** Display name (e.g. "King K. Rool") to slug used in stats CSV lookup (e.g. "king-k-rool"). */
function displayNameToSlug(displayName) {
    return (displayName || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
}

/** Canonical character names from stats spreadsheets (weight.csv, synced to S3). Every name in the
 *  Character column is accepted for !stats / !s so users can type e.g. "King K. Rool", "Dr. Mario", "R.O.B.". Cached. */
let statsCanonicalCache = null;
function getStatsCanonicalEntries() {
    if (statsCanonicalCache) return statsCanonicalCache;
    const entries = [];
    try {
        const raw = fs.readFileSync(WEIGHT_CSV_PATH, "utf8");
        const lines = raw.trim().split("\n");
        if (lines.length < 2) return entries;
        const headerLine = lines[0];
        const charIndex = headerLine.split(",").map((h) => h.trim()).indexOf("Character");
        if (charIndex === -1) return entries;
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(",").map((v) => v.trim());
            const displayName = values[charIndex];
            if (displayName) {
                const slug = displayNameToSlug(displayName);
                if (slug) entries.push({ displayName, slug });
            }
        }
        statsCanonicalCache = entries;
    } catch (_) {
        // weight.csv missing or unreadable
    }
    return entries;
}

/** Normalize slug to a comparable key so "banjo-kazooie" and "banjo-and-kazooie" match the same character. */
function slugKeyForStatsMatch(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/and/g, '');
}

/** Display name from stats spreadsheets for a given slug (e.g. "banjo-kazooie" or "banjo-and-kazooie" → "Banjo & Kazooie").
 *  Used so CSV lookups match the Character column exactly when the alias map uses a different slug form. */
export function getDisplayNameForStatsSlug(slug) {
    if (!slug) return null;
    const entries = getStatsCanonicalEntries();
    let entry = entries.find((e) => e.slug === slug);
    if (!entry) {
        const key = slugKeyForStatsMatch(slug);
        if (key) entry = entries.find((e) => slugKeyForStatsMatch(e.slug) === key);
    }
    return entry ? entry.displayName : null;
}

export function buildCharacterAliasMap(guild) {
    const aliasMap = new Map();

    // Seed with every character from stats spreadsheets (weight.csv) so commands accept exact spreadsheet names
    for (const { displayName, slug } of getStatsCanonicalEntries()) {
        const normDisplay = normalizeCharacterText(displayName);
        const normSlug = normalizeCharacterText(slug);
        if (normDisplay) aliasMap.set(normDisplay, slug);
        if (normSlug && normSlug !== normDisplay) aliasMap.set(normSlug, slug);
    }

    const categoryNames = ["Match Ups (B-L)", "Match Ups (M-Z)"];

    const matchupChannels = guild.channels.cache.filter(
        ch => ch.parent && categoryNames.includes(ch.parent.name)
    );

    for (const channel of matchupChannels.values()) {
        const slug = channel.name.toLowerCase();
        const normalizedSlug = normalizeCharacterText(slug);
        aliasMap.set(normalizedSlug, slug);

        // Match both regular pipe | and special vertical line characters (︱, ｜, etc)
        const pipePattern = /[|︱｜]/;
        if (pipePattern.test(slug)) {
            const parts = slug.split(pipePattern).map(part => normalizeCharacterText(part));
            for (const part of parts) {
                if (part) {
                    aliasMap.set(part, slug);
                }
            }
        }
    }

    for (const [alias, canonical] of Object.entries(getNicknameAliases())) {
        const normalizedAlias = normalizeCharacterText(alias);
        const normalizedCanonical = normalizeCharacterText(canonical);
        const canonicalSlug = aliasMap.get(normalizedCanonical) || canonical.toLowerCase();
        aliasMap.set(normalizedAlias, canonicalSlug);
    }

    return aliasMap;
}

function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function resolveCharacterFromText(text, aliasMap, options = {}) {
    const normalizedText = normalizeCharacterText(text);
    const aliases = Array.from(aliasMap.keys()).sort((a, b) => b.length - a.length);
    const { allowZelda = false } = options;

    let zeldaMatch = null;
    let otherMatch = null;

    for (const alias of aliases) {
        const pattern = new RegExp(`(^|\\s)${escapeRegex(alias)}(\\s|$)`);
        if (pattern.test(normalizedText)) {
            if (alias === 'zelda') {
                zeldaMatch = { slug: aliasMap.get(alias), alias };
            } else {
                otherMatch = { slug: aliasMap.get(alias), alias };
                break; // Found a non-zelda character, use it
            }
        }
    }

    // If we found a non-Zelda character, use that (ignore Zelda match)
    if (otherMatch) {
        return otherMatch;
    }
    // Allow Zelda-only matches when explicitly requested (e.g., ditto questions)
    if (allowZelda && zeldaMatch) {
        return zeldaMatch;
    }
    // If we only found Zelda, return null (user needs to specify opponent)
    return null;
}


