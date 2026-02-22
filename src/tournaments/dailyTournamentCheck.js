import fs from 'fs/promises';
import { EmbedBuilder } from 'discord.js';
import { executeQuery } from './startggClient.js';
import { fetchFromS3 } from '../shared/s3Helper.js';
import { buildTournamentEmbed } from './tournamentEmbed.js';
import { INFO_EMBED_COLOR } from '../messages/faqAndAliasHandler.js';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/** Build clickable stream URL from start.gg stream object (streamName + streamSource). */
function streamToUrl(s) {
    if (!s?.streamName) return null;
    const source = (s.streamSource || '').toString().toUpperCase();
    if (source === 'YOUTUBE') return `https://www.youtube.com/@${encodeURIComponent(s.streamName)}`;
    return `https://www.twitch.tv/${encodeURIComponent(s.streamName)}`;
}

async function executeWithRetry(query, variables, authToken, retries = 3, delayMs = 500) {
    try {
        return await executeQuery(query, variables, authToken);
    } catch (error) {
        const message = error?.message || '';
        if (message.includes('429') && retries > 0) {
            await sleep(delayMs);
            return executeWithRetry(query, variables, authToken, retries - 1, delayMs * 2);
        }
        throw error;
    }
}

/**
 * Load Zelda players from JSON file
 */
async function loadZeldaPlayers() {
    const key = process.env.ZELDA_PLAYERS_KEY || 'zelda_players.json';

    try {
        const json = await fetchFromS3(key);
        if (json?.players?.length) {
            return json.players;
        }
    } catch (error) {
        console.warn(`⚠️  S3 load failed (${key}), falling back to local file: ${error.message}`);
    }

    try {
        const data = await fs.readFile('zelda_players.json', 'utf-8');
        const json = JSON.parse(data);
        return json.players;
    } catch (error) {
        console.error('❌ Error loading zelda_players.json:', error.message);
        return [];
    }
}

function getTodayRange() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return {
        start: Math.floor(today.getTime() / 1000),
        end: Math.floor(tomorrow.getTime() / 1000)
    };
}

async function getTodaysTournaments(videogameId, authToken) {
    const { start, end } = getTodayRange();
    const all = [];
    let page = 1;
    const perPage = 50;

    while (true) {
        const query = `
            query GetTournaments($videogameId: ID!, $afterDate: Timestamp!, $page: Int!, $perPage: Int!) {
                tournaments(query: {
                    page: $page
                    perPage: $perPage
                    filter: {
                        upcoming: true
                        videogameIds: [$videogameId]
                        afterDate: $afterDate
                    }
                }) {
                    nodes {
                        id
                        name
                        slug
                        startAt
                    }
                    pageInfo {
                        totalPages
                        page
                    }
                }
            }
        `;

        const data = await executeWithRetry(query, {
            videogameId,
            afterDate: start,
            page,
            perPage
        }, authToken);

        const nodes = data?.tournaments?.nodes || [];
        if (nodes.length === 0) break;
        all.push(...nodes);

        const totalPages = data?.tournaments?.pageInfo?.totalPages || page;
        if (page >= totalPages) break;
        page += 1;
    }

    return all.filter(t => t.startAt >= start && t.startAt < end);
}

async function fetchEntrantsForEvent(eventId, authToken) {
    const all = [];
    let page = 1;
    const perPage = 100;

    while (true) {
        const entrantsQuery = `
            query GetEventEntrants($eventId: ID!, $page: Int!, $perPage: Int!) {
                event(id: $eventId) {
                    id
                    name
                    entrants(query: { page: $page, perPage: $perPage }) {
                        nodes {
                            id
                            name
                            participants {
                                id
                                gamerTag
                                player {
                                    id
                                }
                            }
                        }
                        pageInfo {
                            totalPages
                            page
                        }
                    }
                }
            }
        `;

        const entrantsData = await executeWithRetry(entrantsQuery, { eventId, page, perPage }, authToken);
        const nodes = entrantsData?.event?.entrants?.nodes || [];
        all.push(...nodes);

        const totalPages = entrantsData?.event?.entrants?.pageInfo?.totalPages || page;
        if (page >= totalPages) break;
        page += 1;
    }

    return all;
}

/**
 * Check today's tournaments for Zelda players
 * Returns structured data grouped by tournament (one entry per tournament with all Zelda players found)
 * 
 * @param {import('discord.js').Client} client - Discord client
 * @param {import('discord.js').TextChannel} [targetChannel=null] - Optional specific channel to send to
 * @returns {Promise<Array>} Array of tournament match objects
 */
export async function checkTodaysTournaments(client, targetChannel = null) {
    const authToken = process.env.STARTGG_AUTH_TOKEN;
    if (!authToken) {
        console.error('❌ STARTGG_AUTH_TOKEN not configured in environment');
        return [];
    }
    console.log('🎮 Checking today\'s SSBU tournaments for Zelda players...');
    
    try {
        // Load Zelda players
        const zeldaPlayers = await loadZeldaPlayers();
        if (zeldaPlayers.length === 0) {
            console.log('❌ No Zelda players in database');
            return [];
        }

        // Create lookup maps for fast matching
        const playerIdMap = new Map(zeldaPlayers.map(p => [p.playerId, p]));
        const gamerTagMap = new Map(zeldaPlayers.map(p => [p.gamerTag.toLowerCase(), p]));

        console.log(`📋 Monitoring ${zeldaPlayers.length} Zelda player(s)`);

        // Get today's SSBU tournaments (paginated)
        const SSBU_VIDEOGAME_ID = 1386;
        const tournaments = await getTodaysTournaments(SSBU_VIDEOGAME_ID, authToken);

        if (tournaments.length === 0) {
            console.log('⚠️ No tournaments found');
            return [];
        }

        console.log(`🏆 Found ${tournaments.length} SSBU tournaments registered`);

        // Check each tournament for Zelda players
        // Group by tournament instead of by match
        const tournamentMatches = new Map(); // Key: tournament slug, Value: tournament data with players list

        for (let tIdx = 0; tIdx < tournaments.length; tIdx++) {
            const tournament = tournaments[tIdx];
            process.stdout.write(`\r⏳ Checking tournament ${tIdx + 1}/${tournaments.length}...`);
            
            const tourQuery = `
                query GetTournament($slug: String!) {
                    tournament(slug: $slug) {
                        id
                        name
                        startAt
                        streams {
                            streamName
                            streamSource
                        }
                        events {
                            id
                            name
                        }
                    }
                }
            `;

            let tourData;
            try {
                tourData = await executeWithRetry(tourQuery, { slug: tournament.slug }, authToken);
            } catch (e) {
                console.error(`[TournamentCheck] Error fetching data for ${tournament.slug}:`, e.message);
                await sleep(400);
                continue;
            }
            const events = tourData?.tournament?.events || [];

            if (events.length === 0) {
                await sleep(400);
                continue;
            }

            // Check each event for participants (Ultimate Singles only)
            for (const event of events) {
                if (!event.name || !event.name.toLowerCase().includes('ultimate singles')) {
                    continue;
                }

                try {
                    const entrants = await fetchEntrantsForEvent(event.id, authToken);
                    const foundPlayersInTournament = [];

                    // Check each entrant
                    entrants.forEach(entrant => {
                        if (!entrant.participants) return;

                        entrant.participants.forEach(participant => {
                            const playerId = participant.player?.id;
                            const gamerTag = participant.gamerTag;

                            // Check if this player is in our Zelda list
                            const zeldaPlayer = playerId ? playerIdMap.get(playerId) : gamerTagMap.get(gamerTag?.toLowerCase());

                            if (zeldaPlayer) {
                                foundPlayersInTournament.push({
                                    gamerTag: zeldaPlayer.gamerTag,
                                    playerId: zeldaPlayer.playerId,
                                    entrantName: entrant.name
                                });
                            }
                        });
                    });

                    // If we found Zelda players in this tournament, add it to the map (once per tournament)
                    if (foundPlayersInTournament.length > 0 && !tournamentMatches.has(tournament.slug)) {
                        const tourStreams = tourData?.tournament?.streams || [];
                        const firstStream = tourStreams[0];
                        const streamUrl = (firstStream && streamToUrl(firstStream)) || 'Stream not available in start.gg data';

                        tournamentMatches.set(tournament.slug, {
                            tournamentName: tournament.name,
                            tournamentSlug: tournament.slug,
                            eventName: event.name,
                            startAt: tournament.startAt,
                            stream: streamUrl,
                            streams: tourStreams,
                            zeldaPlayers: foundPlayersInTournament
                        });
                    }
                } catch (e) {
                    console.warn(`\n⚠️ Skipping event ${event.name}: ${e.message}`);
                }
            }
            await sleep(400);
        }

        // Convert map to array and return
        const results = Array.from(tournamentMatches.values());
        console.log('\n');
        console.log(`✅ Found Zelda players in ${results.length} tournament(s)`);

        if (results.length > 0 && client) {
            let channel = targetChannel;
            if (!channel) {
                for (const guild of client.guilds.cache.values()) {
                    channel = guild.channels.cache.find(c => c.name === 'audit-logs');
                    if (channel) break;
                }
            }

            if (channel) {
                for (const tournament of results) {
                    const embed = buildTournamentEmbed(tournament);
                    await channel.send({ embeds: [embed] });
                }
            }
        }

        return results;

    } catch (error) {
        console.error('❌ Error during tournament check:', error.message);
        throw error;
    }
}
