import { EmbedBuilder } from 'discord.js';
import { INFO_EMBED_COLOR } from '../messages/faqAndAliasHandler.js';

/**
 * Build stream URL for a start.gg stream object.
 * @private
 */
function streamUrl(s) {
    if (!s?.streamName) return null;
    const source = (s.streamSource || '').toString().toUpperCase();
    if (source === 'YOUTUBE') return `https://www.youtube.com/@${encodeURIComponent(s.streamName)}`;
    return `https://www.twitch.tv/${encodeURIComponent(s.streamName)}`;
}

/**
 * Format streams for embed: bold label + angle-bracketed URL so Discord does not unfurl/embed the link.
 * Keeps markdown formatting (bold) while preventing link previews..
 */
function formatStreams(streams) {
    if (!streams?.length) return 'No streams listed';
    return streams
        .map(s => {
            const source = (s.streamSource || '').toString().toUpperCase() || 'Stream';
            const label = `${s.streamName} (${source})`;
            const url = streamUrl(s);
            return url ? `**${label}:** <${url}>` : `**${label}**`;
        })
        .join('\n');
}

/**
 * Build a Discord embed for a single tournament (Zelda players found).
 * Uses project standard INFO_EMBED_COLOR. Stream and start.gg links use <> to prevent unfurl.
 *
 * @param {object} tournament - From checkTodaysTournaments: tournamentName, tournamentSlug, eventName, startAt, streams, zeldaPlayers
 * @returns {EmbedBuilder}
 */
export function buildTournamentEmbed(tournament) {
    const startTime = new Date(tournament.startAt * 1000).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/New_York'
    });
    const startggUrl = `https://www.start.gg/${tournament.tournamentSlug}`;
    const playersList = tournament.zeldaPlayers.map(p => `• ${p.gamerTag}`).join('\n');
    const streamText = formatStreams(tournament.streams);

    const embed = new EmbedBuilder()
        .setColor(INFO_EMBED_COLOR)
        .setTitle(tournament.tournamentName)
        .setURL(startggUrl)
        .addFields(
            { name: '📅 Start', value: `${startTime} EST`, inline: true },
            { name: '🎮 Event', value: tournament.eventName, inline: true },
            { name: '👤 Zelda Player(s)', value: playersList || '—', inline: false },
            { name: '📺 Streams', value: streamText, inline: false },
            { name: '🔗 Tournament page', value: `<${startggUrl}>`, inline: false }
        );

    return embed;
}
