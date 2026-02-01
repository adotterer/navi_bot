export const nicknameAliases = {
    bayo: "bayonetta",
    diddy: "diddy-kong",
    dk: "donkey-kong",
    "DK": "donkey-kong",
    icies: "ice-climbers",
    iceclimbers: "ice-climbers",
    "ice climbers": "ice-climbers",
    palu: "palutena",
    pika: "pikachu",
    pit: "pit|dark-pit",
    "dark pit": "pit|dark-pit",
    rosalina: "rosalina-and-luma",
    "rosalina & luma": "rosalina-and-luma",
    "rosalina and luma": "rosalina-and-luma",
    simon: "simon-richter",
    richter: "simon-richter",
    "richter belmont": "simon-richter",
    peach: "peach|daisy",
    plant: "piranha-plant",
    daisy: "peach|daisy",
    GaW: "mr-game-and-watch",
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
        .replace(/['']/g, "")
        .replace(/[^a-z0-9|\s]/g, " ")
        .replace(/\s+/g, " ")
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

        if (slug.includes("|")) {
            const parts = slug.split("|").map(part => normalizeCharacterText(part));
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

    for (const alias of aliases) {
        const pattern = new RegExp(`(^|\\s)${escapeRegex(alias)}(\\s|$)`);
        if (pattern.test(normalizedText)) {
            return { slug: aliasMap.get(alias), alias };
        }
    }

    return null;
}
