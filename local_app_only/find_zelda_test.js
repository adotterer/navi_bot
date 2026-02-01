#!/usr/bin/env node

import dotenv from 'dotenv';
import { getActiveTournaments, executeQuery } from './src/tournaments/startggClient.js';

dotenv.config();

const AUTH_TOKEN = process.env.STARTGG_AUTH_TOKEN;

async function findZeldaPlayersInTournament() {
    console.log('\n🔍 Finding Zelda players in tournaments\n');
    
    try {
        // Get some active SSBU tournaments
        const tournaments = await getActiveTournaments(1386, AUTH_TOKEN);
        console.log(`Found ${tournaments.length} tournaments\n`);

        if (tournaments.length === 0) {
            console.log('No tournaments found');
            process.exit(1);
        }

        // Get the first tournament
        const tournamentSlug = tournaments[0].slug;
        console.log(`Testing with tournament: ${tournaments[0].name} (${tournamentSlug})`);

        // Get tournament details with events
        const tourQuery = `
            query GetTournament($slug: String!) {
                tournament(slug: $slug) {
                    id
                    name
                    events {
                        id
                        name
                        type
                        numEntrants
                    }
                }
            }
        `;

        const tourResult = await executeQuery(tourQuery, { slug: tournamentSlug }, AUTH_TOKEN);
        const events = tourResult.tournament.events;
        console.log(`Tournament has ${events.length} events\n`);

        if (events.length === 0) {
            console.log('No events in tournament');
            process.exit(1);
        }

        // Get sets from first event to see character data
        const eventId = events[0].id;
        console.log(`Fetching sets from event: ${events[0].name}\n`);

        const setsQuery = `
            query GetEventSets($eventId: ID!) {
                event(id: $eventId) {
                    id
                    name
                    sets(query: { perPage: 5, sortType: RECENT }) {
                        nodes {
                            id
                            displayScore
                            slots {
                                id
                                entrant {
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
                            }
                            games {
                                id
                                selections {
                                    entrant {
                                        id
                                    }
                                    character {
                                        name
                                    }
                                }
                            }
                        }
                    }
                }
            }
        `;

        const setsResult = await executeQuery(setsQuery, { eventId }, AUTH_TOKEN);
        const sets = setsResult.event.sets?.nodes || [];
        console.log(`Found ${sets.length} recent sets\n`);

        // Find Zelda players
        const zeldaPlayers = new Map();

        sets.forEach((set, setIdx) => {
            console.log(`Set ${setIdx + 1}: ${set.id} ${set.displayScore || '(no score)'}`);
            
            if (!set.games) {
                console.log('  (no games)');
                return;
            }

            set.games.forEach((game, gameIdx) => {
                if (!game.selections) {
                    console.log(`  Game ${gameIdx + 1}: (no selections)`);
                    return;
                }

                game.selections.forEach(sel => {
                    if (sel.character?.name === 'Zelda') {
                        // Find the player for this entrant
                        const entrantSlot = set.slots.find(slot => slot.entrant.id === sel.entrant.id);
                        if (entrantSlot?.entrant?.participants) {
                            entrantSlot.entrant.participants.forEach(participant => {
                                const tag = participant.gamerTag;
                                zeldaPlayers.set(tag, {
                                    gamerTag: tag,
                                    playerId: participant.player?.id,
                                    entrantId: sel.entrant.id
                                });
                                console.log(`  ✅ Game ${gameIdx + 1}: ${tag} played Zelda`);
                            });
                        }
                    }
                });
            });
        });

        console.log(`\n👑 Found ${zeldaPlayers.size} Zelda players:`);
        zeldaPlayers.forEach((player, tag) => {
            console.log(`  • ${tag} (ID: ${player.playerId})`);
        });

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
    
    process.exit(0);
}

findZeldaPlayersInTournament();
