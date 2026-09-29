import { getMatchupChannelMap } from '../shared/discordRest.js';

/** Lossy, display-only transform: real channel name -> URL-safe path segment. */
export function channelNameToUrlSlug(name) {
    return name
        .toLowerCase()
        .replace(/\s*\|\s*/g, '-')
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

/** Same display convention used by the Discord bot's !mu command (matchupHandler.js). */
export function channelNameToDisplayName(name) {
    return name.replace('|', '/');
}

/**
 * Resolves a URL slug back to the real channel name by comparing against the live REST-fetched
 * channel list (rather than trying to reverse the lossy transform, or relying on the S3-cached
 * canonical-character-threads.json snapshot, which is only refreshed when someone runs
 * !export matchups and can go stale) — one source of truth, always current.
 */
export async function resolveUrlSlugToChannelName(slug) {
    const channelMap = await getMatchupChannelMap(process.env.GUILD_ID);
    for (const name of channelMap.keys()) {
        if (channelNameToUrlSlug(name) === slug) return name;
    }
    return null;
}

/** All matchup channel names, live from Discord (not the possibly-stale S3 canonical snapshot). */
export async function getAllMatchupChannelNames() {
    const channelMap = await getMatchupChannelMap(process.env.GUILD_ID);
    return [...channelMap.keys()];
}
