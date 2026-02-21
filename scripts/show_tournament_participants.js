import dotenv from 'dotenv';
import { executeQuery } from '../src/tournaments/startggClient.js';

dotenv.config();

const AUTH_TOKEN = process.env.STARTGG_AUTH_TOKEN;

async function fetchEntrantsForEvent(eventId) {
    const all = [];
    let page = 1;
    const perPage = 100;

    while (true) {
        const query = `
            query GetEventEntrants($eventId: ID!, $page: Int!, $perPage: Int!) {
                event(id: $eventId) {
                    name
                    entrants(query: { page: $page, perPage: $perPage }) {
                        nodes {
                            name
                            participants {
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

        const data = await executeQuery(query, { eventId, page, perPage }, AUTH_TOKEN);
        const nodes = data?.event?.entrants?.nodes || [];
        all.push(...nodes);

        const totalPages = data?.event?.entrants?.pageInfo?.totalPages || page;
        if (page >= totalPages) break;
        page += 1;
    }

    return all;
}

async function showTournamentParticipants(slug) {
    console.log(`\n🔎 Fetching participants for: ${slug}\n`);

    try {
        const tournamentQuery = `
            query GetTournament($slug: String!) {
                tournament(slug: $slug) {
                    id
                    name
                    startAt
                    events {
                        id
                        name
                        type
                    }
                }
            }
        `;

        const tourData = await executeQuery(tournamentQuery, { slug }, AUTH_TOKEN);
        const tournament = tourData?.tournament;

        if (!tournament) {
            console.log('❌ Tournament not found');
            process.exit(1);
        }

        const startDate = new Date(tournament.startAt * 1000).toLocaleString();
        console.log(`✅ ${tournament.name}`);
        console.log(`📅 ${startDate}`);
        console.log(`🎯 Events: ${tournament.events.length}\n`);

        let total = 0;

        for (const event of tournament.events) {
            console.log(`=== ${event.name} ===`);
            const entrants = await fetchEntrantsForEvent(event.id);
            console.log(`Entrants: ${entrants.length}`);

            entrants.forEach((entrant, idx) => {
                if (!entrant.participants || entrant.participants.length === 0) {
                    console.log(`${idx + 1}. ${entrant.name}`);
                    total += 1;
                    return;
                }

                entrant.participants.forEach(p => {
                    console.log(`${idx + 1}. ${p.gamerTag} (ID: ${p.player?.id})`);
                    total += 1;
                });
            });

            console.log('');
        }

        console.log(`Total participants shown: ${total}`);

    } catch (error) {
        console.error('❌ Error:', error.message);
    }

    process.exit(0);
}

const slug = process.argv[2] || 'tournament/showtime-nepa-smash-regional-2026';
showTournamentParticipants(slug);
