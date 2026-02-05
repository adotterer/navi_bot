// Related characters that should be fetched together
export const relatedCharacters = {
    "pokemon-trainer": ["squirtle", "ivysaur", "charizard"],
    "pyra": ["mythra"],
    "mythra": ["pyra"]
};

export const nicknameAliases = {
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
    "dark pit": "pit | dark-pit",
    dedede: "king-dedede",
    kingdedede: "king-dedede",
    dh: "duck-hunt",
    diddy: "diddy-kong",
    dk: "donkey-kong",
    "DK": "donkey-kong",
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
    "Mr. G&W": "mr-game-and-watch",
    "mr g&w": "mr-game-and-watch",
    "mr-game-and-watch": "mr-game-and-watch",
    "p t": "pokemon-trainer",
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
    zard: "charizard",
    "zero suit samus": "zero-suit-samus",
    zss: "zero-suit-samus",
};

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

export function buildCharacterAliasMap(guild) {
    const aliasMap = new Map();
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

    for (const [alias, canonical] of Object.entries(nicknameAliases)) {
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

export function resolveCharacterFromText(text, aliasMap) {
    const normalizedText = normalizeCharacterText(text);
    const aliases = Array.from(aliasMap.keys()).sort((a, b) => b.length - a.length);

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
    // If we only found Zelda, return null (user needs to specify opponent)
    return null;
}


