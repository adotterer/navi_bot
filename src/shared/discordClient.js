/**
 * Lightweight module for sharing the Discord.js Client instance between
 * main.js (which creates the client) and Express route handlers (which need it).
 * No Discord.js imports — just a module-level reference.
 */

let _client = null;

/** Called once in main.js after the bot is ready. */
export function setClient(client) {
    _client = client;
}

/** Returns the Discord client, or null if the bot is not yet ready. */
export function getClient() {
    return _client;
}
