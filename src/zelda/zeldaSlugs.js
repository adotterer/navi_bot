import { getCanonicalCharacterThreads } from '../matchups/characterAliases.js';

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
 * Resolves a URL slug back to the real channel name by comparing against the live canonical
 * list (rather than trying to reverse the lossy transform) — one source of truth.
 */
export async function resolveUrlSlugToChannelName(slug) {
    const channelNames = await getCanonicalCharacterThreads();
    return channelNames.find((name) => channelNameToUrlSlug(name) === slug) || null;
}
