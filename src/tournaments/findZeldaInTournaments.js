import dotenv from 'dotenv';
import fs from 'fs/promises';
import { executeQuery } from './startggClient.js';

dotenv.config();

const AUTH_TOKEN = process.env.STARTGG_AUTH_TOKEN;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
 * Get today's tournaments and find Zelda players
 */
async function findZeldaPlayersInTodaysTournaments() {
    console.log('\n🎮 ZELDA PLAYERS IN TODAY\'S TOURNAMENTS\n');
    console.log('='.repeat(70));

    try {
        // Load Zelda players
        const zeldaPlayers = await loadZeldaPlayers();
        if (zeldaPlayers.length === 0) {
            console.log('❌ No Zelda players in database');
            return;
        }

        // Create lookup maps for fast matching
        const playerIdMap = new Map(zeldaPlayers.map(p => [p.playerId, p]));
        const gamerTagMap = new Map(zeldaPlayers.map(p => [p.gamerTag.toLowerCase(), p]));

        console.log(`\n📋 Monitoring ${zeldaPlayers.length} Zelda player(s):`);
        zeldaPlayers.forEach(p => {
            console.log(`   • ${p.gamerTag} (ID: ${p.playerId})`);
        });
        console.log('\n' + '='.repeat(70) + '\n');

        // Get today's SSBU tournaments (paginated)
        const SSBU_VIDEOGAME_ID = 1386;
        const tournaments = await getTodaysTournaments(SSBU_VIDEOGAME_ID, AUTH_TOKEN);

        if (tournaments.length === 0) {
            console.log('⚠️  No tournaments found');
            return;
        }

        console.log(`🏆 Found ${tournaments.length} SSBU tournaments registered today`);
        console.log(`⏳ Filtering to tournaments with Ultimate Singles...\n`);

        // Check each tournament for Zelda players
        const foundMatches = [];
        let tournamentsWithUltimateSingles = 0;

        for (let tIdx = 0; tIdx < tournaments.length; tIdx++) {
            const tournament = tournaments[tIdx];
            process.stdout.write(`\r⏳ Checking tournament ${tIdx + 1}/${tournaments.length}...`);
            // Get tournament events
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
                tourData = await executeWithRetry(tourQuery, { slug: tournament.slug }, AUTH_TOKEN);
            } catch (e) {
                continue;
            }
            const events = tourData?.tournament?.events || [];

            if (events.length === 0) continue;

            // Check each event for participants (Ultimate Singles only)
            for (const event of events) {
                if (!event.name || !event.name.toLowerCase().includes('ultimate singles')) {
                    continue;
                }

                tournamentsWithUltimateSingles++;

                try {
                    const entrants = await fetchEntrantsForEvent(event.id, AUTH_TOKEN);

                    // Check each entrant
                    entrants.forEach(entrant => {
                        if (!entrant.participants) return;

                        entrant.participants.forEach(participant => {
                            const playerId = participant.player?.id;
                            const gamerTag = participant.gamerTag;

                            // Check if this player is in our Zelda list
                            const zeldaPlayer = playerId ? playerIdMap.get(playerId) : gamerTagMap.get(gamerTag?.toLowerCase());

                            if (zeldaPlayer) {
                                foundMatches.push({
                                    tournamentName: tournament.name,
                                    tournamentSlug: tournament.slug,
                                    eventName: event.name,
                                    startAt: tournament.startAt,
                                    streams: tournament.streams || [],
                                    zeldaPlayer: {
                                        gamerTag: zeldaPlayer.gamerTag,
                                        playerId: zeldaPlayer.playerId,
                                        entrantName: entrant.name
                                    }
                                });
                            }
                        });
                    });
                } catch (e) {
                    console.warn(`\n⚠️  Skipping event ${event.name}: ${e.message}`);
                }
            }
            await sleep(150);
        }

        // Display results
        console.log('\n');
        console.log(`📊 Summary: ${tournamentsWithUltimateSingles} tournaments have Ultimate Singles events\n`);

        if (foundMatches.length === 0) {
            console.log('❌ No Zelda players found in today\'s tournaments\n');
            return;
        }

        console.log(`✅ Found ${foundMatches.length} match(es)!\n`);
        console.log('='.repeat(70) + '\n');

        foundMatches.forEach((match, idx) => {
            const startTime = new Date(match.startAt * 1000).toLocaleTimeString();
            const streamInfo = match.streams.length > 0
                ? match.streams.map(s => `${s.streamName} (${s.streamSource})`).join(', ')
                : 'No streams listed';

            console.log(`${idx + 1}. 🏆 ${match.tournamentName}`);
            console.log(`   📅 Start: ${startTime}`);
            console.log(`   🎮 Event: ${match.eventName}`);
            console.log(`   👤 Player: ${match.zeldaPlayer.gamerTag} (${match.zeldaPlayer.entrantName})`);
            console.log(`   📺 Streams: ${streamInfo}`);
            console.log(`   🔗 Link: https://www.start.gg/${match.tournamentSlug}`);
            console.log('');
        });

        console.log('='.repeat(70));

    } catch (error) {
        console.error('❌ Error:', error.message);
    }

    process.exit(0);
}

// Run
findZeldaPlayersInTodaysTournaments();
