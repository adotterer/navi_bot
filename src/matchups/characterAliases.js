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
    bowserjr: "bowser-jr",
    bowserj: "bowser-jr",
    bowser: "bowser",
    bubba: "king-k-rool",
    cf: "captain-falcon",
    "captain falcon": "captain-falcon",
    capfalcon: "captain-falcon",
    zard: "charizard",
    char: "charizard",
    isa: "isabelle",
    ivy: "ivysaur",
    "p t": "pokemon-trainer",
    pt: "pokemon-trainer",
    d3: "king-dedede",
    dedede: "king-dedede",
    diddy: "diddy-kong",
    dk: "donkey-kong",
    "DK": "donkey-kong",
    icies: "ice-climbers",
    iceclimbers: "ice-climbers",
    "ice climbers": "ice-climbers",
    kaz: "kazuya",
    krool: "king-k-rool",
    "k.rool": "king-k-rool",
    "k rool": "king-k-rool",
    mac: "little-mac",
    lm: "little-mac",
    littlemac: "little-mac",
    mk: "meta-knight",
    metaknight: "meta-knight",
    "min min": "min-min",
    minmin: "min-min",
    rosa: "rosalina-and-luma",
    luma: "rosalina-and-luma",
    wiifit: "wii-fit-trainer",  
    "wii fit": "wii-fit-trainer",
    wft: "wii-fit-trainer",
    yink: "young-link",
    "young link": "young-link",
    palu: "palutena",
    pika: "pikachu",
    pit: "pit | dark-pit",
    "dark pit": "pit | dark-pit",
    rosalina: "rosalina-and-luma",
    "rosalina & luma": "rosalina-and-luma",
    "rosalina and luma": "rosalina-and-luma",
    simon: "simon-richter",
    richter: "simon-richter",
    "richter belmont": "simon-richter",
    peach: "peach | daisy",
    plant: "piranha-plant",
    daisy: "peach | daisy",
    GaW: "mr-game-and-watch",
    m2: "mewtwo",
    "dr.mario": "dr-mario",
    "dr mario": "dr-mario",
    ganon: "ganondorf",
    dh: "duck-hunt",
    "Mr. G&W": "mr-game-and-watch",
    "mr g&w": "mr-game-and-watch",
    "g&w": "mr-game-and-watch",
    "G&W": "mr-game-and-watch",
    "game and watch": "mr-game-and-watch",
    "game & watch": "mr-game-and-watch",
    zss: "zero-suit-samus",
    "zero suit samus": "zero-suit-samus",
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
