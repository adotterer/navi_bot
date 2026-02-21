import dotenv from 'dotenv';
import { getActiveTournaments, executeQuery } from './startggClient.js';

dotenv.config();

const AUTH_TOKEN = process.env.STARTGG_AUTH_TOKEN;

async function showTodaysParticipants() {
    console.log('\n📋 PARTICIPANTS IN TODAY\'S TOURNAMENTS\n');
    console.log('='.repeat(70) + '\n');

    try {
        const SSBU_VIDEOGAME_ID = 1386;
        const tournaments = await getActiveTournaments(SSBU_VIDEOGAME_ID, AUTH_TOKEN);

        if (tournaments.length === 0) {
            console.log('No tournaments found');
            return;
        }

        let totalParticipants = 0;

        for (let tIdx = 0; tIdx < Math.min(3, tournaments.length); tIdx++) {
            const tournament = tournaments[tIdx];
            console.log(`🏆 ${tournament.name}`);
            console.log(`   🔗 Slug: ${tournament.slug}\n`);

            const tourQuery = `
                query GetTournament($slug: String!) {
                    tournament(slug: $slug) {
                        id
                        events {
                            id
                            name
                        }
                    }
                }
            `;

            const tourData = await executeQuery(tourQuery, { slug: tournament.slug }, AUTH_TOKEN);
            const events = tourData.tournament.events;

            for (const event of events) {
                const entrantsQuery = `
                    query GetEventEntrants($eventId: ID!) {
                        event(id: $eventId) {
                            name
                            entrants(query: { perPage: 20 }) {
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
                const entrants = entrantsData.event.entrants?.nodes || [];

                console.log(`   📌 Event: ${event.name} (${entrants.length} entrants)`);
                
                entrants.slice(0, 10).forEach(entrant => {
                    if (entrant.participants) {
                        entrant.participants.forEach(p => {
                            console.log(`      • ${p.gamerTag} (ID: ${p.player?.id})`);
                            totalParticipants++;
                        });
                    }
                });
                
                if (entrants.length > 10) {
                    console.log(`      ... and ${entrants.length - 10} more`);
                }
                console.log('');
            }
        }

        console.log('='.repeat(70));
        console.log(`\nTotal shown: ${totalParticipants} participants\n`);
        console.log('💡 Tip: Add any player with: node scripts/addZeldaPlayer.js "Gamer Tag"\n');

    } catch (error) {
        console.error('❌ Error:', error.message);
    }

    process.exit(0);
}

showTodaysParticipants();
