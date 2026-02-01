import dotenv from 'dotenv';
import fs from 'fs/promises';
import { getActiveTournaments, executeQuery } from './startggClient.js';

dotenv.config();

const AUTH_TOKEN = process.env.STARTGG_AUTH_TOKEN;

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

async function findZeldaPlayersQuick() {
    console.log('\n🎮 ZELDA PLAYERS IN TODAY\'S TOURNAMENTS\n');
    console.log('='.repeat(70));

    try {
        const zeldaPlayers = await loadZeldaPlayers();
        if (zeldaPlayers.length === 0) {
            console.log('❌ No Zelda players in database');
            return;
        }

        const playerIdMap = new Map(zeldaPlayers.map(p => [p.playerId, p]));
        
        console.log(`\n📋 Monitoring ${zeldaPlayers.length} Zelda player(s):`);
        zeldaPlayers.forEach(p => {
            console.log(`   • ${p.gamerTag} (ID: ${p.playerId})`);
        });
        console.log('\n' + '='.repeat(70) + '\n');

        // Get active SSBU tournaments
        const SSBU_VIDEOGAME_ID = 1386;
        const tournaments = await getActiveTournaments(SSBU_VIDEOGAME_ID, AUTH_TOKEN);

        console.log(`🏆 Found ${tournaments.length} SSBU tournaments`);
        console.log(`⏳ Checking all ${tournaments.length} tournaments...\n`);

        const toCheck = tournaments;
        const foundMatches = [];

        for (let tIdx = 0; tIdx < toCheck.length; tIdx++) {
            const tournament = toCheck[tIdx];
            console.log(`[${tIdx + 1}/${toCheck.length}] ${tournament.name}...`);

            try {
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

                const tourData = await executeQuery(tourQuery, { slug: tournament.slug }, AUTH_TOKEN);
                const events = tourData?.tournament?.events || [];

                for (const event of events) {
                    try {
                        const entrantsQuery = `
                            query GetEventEntrants($eventId: ID!) {
                                event(id: $eventId) {
                                    name
                                    entrants(query: { perPage: 200 }) {
                                        nodes {
                                            name
                                            participants {
                                                gamerTag
                                                player {
                                                    id
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        `;

                        const entrantsData = await executeQuery(entrantsQuery, { eventId: event.id }, AUTH_TOKEN);
                        const entrants = entrantsData?.event?.entrants?.nodes || [];

                        entrants.forEach(entrant => {
                            if (!entrant.participants) return;

                            entrant.participants.forEach(participant => {
                                const playerId = participant.player?.id;
                                
                                if (playerIdMap.has(playerId)) {
                                    const zeldaPlayer = playerIdMap.get(playerId);
                                    foundMatches.push({
                                        tournamentName: tournament.name,
                                        tournamentSlug: tournament.slug,
                                        eventName: event.name,
                                        startAt: tournament.startAt,
                                        streams: tourData.tournament.streams || [],
                                        zeldaPlayer: {
                                            gamerTag: zeldaPlayer.gamerTag,
                                            playerId: zeldaPlayer.playerId,
                                            entrantName: entrant.name
                                        }
                                    });
                                    console.log(`   ✅ FOUND: ${zeldaPlayer.gamerTag}!`);
                                }
                            });
                        });
                    } catch (e) {
                        // Skip this event on error
                    }
                }
            } catch (e) {
                // Skip this tournament on error
            }
        }

        // Display results
        console.log('\n' + '='.repeat(70) + '\n');

        if (foundMatches.length === 0) {
            console.log('❌ No Zelda players found in first 5 tournaments\n');
            process.exit(0);
        }

        console.log(`✅ Found ${foundMatches.length} match(es)!\n`);

        foundMatches.forEach((match, idx) => {
            const startTime = new Date(match.startAt * 1000).toLocaleTimeString();
            const streamInfo = match.streams.length > 0
                ? match.streams.map(s => s.streamName).join(', ')
                : 'No streams listed';

            console.log(`${idx + 1}. 🏆 ${match.tournamentName}`);
            console.log(`   📅 Start: ${startTime}`);
            console.log(`   🎮 Event: ${match.eventName}`);
            console.log(`   👤 Player: ${match.zeldaPlayer.gamerTag}`);
            console.log(`   📺 Streams: ${streamInfo}`);
            console.log(`   🔗 https://www.start.gg/${match.tournamentSlug}`);
            console.log('');
        });

    } catch (error) {
        console.error('❌ Error:', error.message);
    }

    process.exit(0);
}

findZeldaPlayersQuick();
