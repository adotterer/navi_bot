/**
 * Stateless Discord REST helpers (bot token only, no Gateway/websocket connection).
 * Used by the web app so it never needs client.login() in production.
 */
import { REST, Routes } from 'discord.js';
import { MATCHUP_CATEGORY_NAMES, EXCLUDED_MATCHUP_CHANNEL_NAMES } from '../export/exportHandler.js';

const CATEGORY_CHANNEL_TYPE = 4;
const AUDIT_LOGS_CHANNEL_NAME = 'audit-logs';

let auditLogsChannelIdCache = null;

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

let channelsCache = null;
let channelsCacheAt = 0;
const CHANNELS_CACHE_MS = 60 * 1000;

let rolesCache = null;
let rolesCacheAt = 0;
const ROLES_CACHE_MS = 5 * 60 * 1000;

/** GET /guilds/{id}/channels — raw channel list (id, name, type, parent_id). Cached ~60s. */
export async function getGuildChannels(guildId) {
    const now = Date.now();
    if (channelsCache && now - channelsCacheAt < CHANNELS_CACHE_MS) return channelsCache;
    const channels = await rest.get(Routes.guildChannels(guildId));
    channelsCache = channels;
    channelsCacheAt = now;
    return channels;
}

/**
 * Returns Map<channelName, channelId> for text channels under the two Match Ups categories,
 * minus the excluded ask-navi channel. REST equivalent of exportHandler.js's
 * getMatchupChannelSlugs/findMatchupCategory, which require a live Gateway-cached guild.
 */
export async function getMatchupChannelMap(guildId) {
    const channels = await getGuildChannels(guildId);
    const categories = channels.filter((ch) => ch.type === CATEGORY_CHANNEL_TYPE);
    const matchupCategoryIds = new Set(
        categories
            .filter((cat) => MATCHUP_CATEGORY_NAMES.some((name) => cat.name.endsWith(name)))
            .map((cat) => cat.id)
    );

    const map = new Map();
    for (const ch of channels) {
        if (!ch.parent_id || !matchupCategoryIds.has(ch.parent_id)) continue;
        if (EXCLUDED_MATCHUP_CHANNEL_NAMES.includes(ch.name)) continue;
        map.set(ch.name, ch.id);
    }
    return map;
}

/** GET /guilds/{id}/roles — Map<roleId, roleName>. Cached ~5min. */
export async function getGuildRoleNameMap(guildId) {
    const now = Date.now();
    if (rolesCache && now - rolesCacheAt < ROLES_CACHE_MS) return rolesCache;
    const roles = await rest.get(Routes.guildRoles(guildId));
    const map = new Map(roles.map((r) => [r.id, r.name]));
    rolesCache = map;
    rolesCacheAt = now;
    return map;
}

/**
 * GET /guilds/{id}/members/{userId} using the BOT token (not the user's OAuth token) — bot tokens
 * have full REST access regardless of what OAuth scopes the user granted, so this works with
 * nothing more than `identify` from the user. Returns null if the user isn't a guild member.
 */
export async function getGuildMemberRoles(guildId, userId) {
    try {
        const member = await rest.get(Routes.guildMember(guildId, userId));
        return member.roles; // array of role IDs
    } catch (err) {
        if (err?.status === 404 || err?.code === 10007) return null; // Unknown Member
        throw err;
    }
}

/** True if any of the given role IDs resolves (via the role name map) to one of the target names. */
export function hasAnyRoleName(roleIds, roleNameMap, targetNames) {
    const targets = new Set(targetNames.map((n) => n.toLowerCase()));
    return (roleIds || []).some((id) => {
        const name = roleNameMap.get(id);
        return name && targets.has(name.toLowerCase());
    });
}

/**
 * Paginated GET /channels/{id}/messages, REST reimplementation of s3Helper.js's fetchAllMessages
 * (which required a live discord.js Channel object). Returns the same shape: {author, authorId,
 * content, timestamp, replyingToAuthor, replyingToAuthorId, replyingToContent, replyingToTimestamp}.
 */
export async function fetchAllChannelMessages(channelId) {
    const messages = [];
    const replyCache = new Map();
    let before;

    while (true) {
        const query = new URLSearchParams({ limit: '100' });
        if (before) query.set('before', before);
        const batch = await rest.get(`${Routes.channelMessages(channelId)}?${query}`);
        if (!batch.length) break;

        for (const msg of batch) {
            const msgData = {
                author: msg.author.username,
                authorId: msg.author.id,
                content: msg.content,
                timestamp: msg.timestamp,
            };
            const repliedId = msg.message_reference?.message_id;
            if (repliedId) {
                try {
                    let replied = replyCache.get(repliedId);
                    if (!replied) {
                        replied = await rest.get(Routes.channelMessage(channelId, repliedId));
                        replyCache.set(repliedId, replied);
                    }
                    if (replied) {
                        msgData.replyingToAuthor = replied.author?.username || null;
                        msgData.replyingToAuthorId = replied.author?.id || null;
                        msgData.replyingToContent = replied.content || null;
                        msgData.replyingToTimestamp = replied.timestamp || null;
                    }
                } catch (_) {
                    if (msg.referenced_message?.author) {
                        msgData.replyingToAuthor = msg.referenced_message.author.username;
                        msgData.replyingToAuthorId = msg.referenced_message.author.id;
                    }
                }
            }
            messages.push(msgData);
        }
        before = batch[batch.length - 1].id;
    }
    return messages.reverse();
}

/**
 * POST /channels/{id}/messages with a plain text body. `mentionUserIds` explicitly allowlists which
 * @mentions in the content actually notify — everything else (parse: []) is suppressed, so free-typed
 * text (e.g. a demo visitor's own name/company) can never trigger an accidental @everyone/@here/role ping.
 */
export async function postChannelMessage(channelId, content, mentionUserIds = []) {
    return rest.post(Routes.channelMessages(channelId), {
        body: { content, allowed_mentions: { parse: [], users: mentionUserIds } },
    });
}

/** Finds the #audit-logs text channel id in the guild's channel list. Cached (piggybacks on getGuildChannels). */
async function getAuditLogsChannelId(guildId) {
    if (auditLogsChannelIdCache) return auditLogsChannelIdCache;
    const channels = await getGuildChannels(guildId);
    const channel = channels.find((ch) => ch.name === AUDIT_LOGS_CHANNEL_NAME);
    if (!channel) return null;
    auditLogsChannelIdCache = channel.id;
    return channel.id;
}

/**
 * Posts a message to #audit-logs. Best-effort: logs a warning and does not throw on failure,
 * so a Discord/permissions hiccup never breaks the actual page load or regenerate action.
 */
export async function logToAuditChannel(guildId, content, mentionUserIds = []) {
    try {
        const channelId = await getAuditLogsChannelId(guildId);
        if (!channelId) {
            console.warn('[audit-log] #audit-logs channel not found');
            return;
        }
        await postChannelMessage(channelId, content, mentionUserIds);
    } catch (err) {
        console.warn('[audit-log] failed to post:', err?.message || err);
    }
}
