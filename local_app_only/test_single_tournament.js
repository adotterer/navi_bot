import dotenv from 'dotenv';
import fs from 'fs/promises';
import { executeQuery } from './startggClient.js';

dotenv.config();

const AUTH_TOKEN = process.env.STARTGG_AUTH_TOKEN;

async function testSingleTournament() {
    console.log('\n🧪 TESTING SINGLE TOURNAMENT\n');

    try {
        // Load Zelda players
        const data = await fs.readFile('zelda_players.json', 'utf-8');
        const zeldaData = JSON.parse(data);
        const zeldaPlayers = zeldaData.players;

        console.log(`📋 Zelda players: ${zeldaPlayers.map(p => p.gamerTag).join(', ')}\n`);

        // Create lookup maps
        const playerIdMap = new Map(zeldaPlayers.map(p => [p.playerId, p]));

        // Get the tournament SD Sundays #106
        const slug = 'tournament/sd-sundays-106';
        console.log(`Fetching: ${slug}\n`);

        const tourQuery = `
            query GetTournament($slug: String!) {
                tournament(slug: $slug) {
                    id
                    name
                    startAt
                    events {
                        id
                        name
                    }
                }
            }
        `;

        const tourData = await executeQuery(tourQuery, { slug }, AUTH_TOKEN);
        const tournament = tourData.tournament;
        console.log(`✅ Tournament: ${tournament.name}`);
        console.log(`   Events: ${tournament.events.length}\n`);

        // Get entrants from first event
        const event = tournament.events[0];
        console.log(`Fetching entrants from: ${event.name}\n`);

        const entrantsQuery = `
            query GetEventEntrants($eventId: ID!) {
                event(id: $eventId) {
                    name
                    entrants(query: { perPage: 100 }) {
                        nodes {
                            id
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
        const entrants = entrantsData.event.entrants?.nodes || [];
        console.log(`✅ Entrants: ${entrants.length}\n`);

        // Check for Zelda players
        let foundCount = 0;
        entrants.forEach(entrant => {
            if (!entrant.participants) return;
            
            entrant.participants.forEach(participant => {
                const playerId = participant.player?.id;
                
                if (playerIdMap.has(playerId)) {
                    const zeldaPlayer = playerIdMap.get(playerId);
                    console.log(`🎮 FOUND: ${zeldaPlayer.gamerTag} (${entrant.name}) - ID: ${playerId}`);
                    foundCount++;
                }
            });
        });

        if (foundCount === 0) {
            console.log('❌ No Zelda players in this event');
        } else {
            console.log(`\n✅ Found ${foundCount} Zelda player(s)!`);
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    }

    process.exit(0);
}

testSingleTournament();
