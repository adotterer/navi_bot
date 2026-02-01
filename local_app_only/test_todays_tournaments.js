import dotenv from 'dotenv';
import axios from 'axios';
import { getActiveTournaments, getTournament, executeQuery } from './src/tournaments/startggClient.js';

dotenv.config();

const AUTH_TOKEN = process.env.STARTGG_AUTH_TOKEN;
const SSBU_VIDEOGAME_ID = 1386; // Super Smash Bros Ultimate

/**
 * Get tournaments happening today
 */
async function getTodaysTournaments() {
    console.log('📅 Fetching tournaments happening TODAY (February 1, 2026)\n');

    try {
        // Get active tournaments
        const tournaments = await getActiveTournaments(SSBU_VIDEOGAME_ID, AUTH_TOKEN);
        
        // Filter for tournaments happening today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        const todayTimestamp = Math.floor(today.getTime() / 1000);
        const tomorrowTimestamp = Math.floor(tomorrow.getTime() / 1000);
        
        const todaysTournaments = tournaments.filter(t => {
            return t.startAt >= todayTimestamp && t.startAt < tomorrowTimestamp;
        });

        console.log(`✅ Found ${todaysTournaments.length} tournaments happening today:\n`);

        todaysTournaments.forEach((t, idx) => {
            const startTime = new Date(t.startAt * 1000).toLocaleTimeString();
            const streamInfo = t.streams && t.streams.length > 0 
                ? `📺 Streams: ${t.streams.map(s => s.streamName).join(', ')}` 
                : '⚠️  No streams';
            
            console.log(`${idx + 1}. ${t.name}`);
            console.log(`   🆔 Tournament ID: ${t.id}`);
            console.log(`   🔗 Slug: ${t.slug}`);
            console.log(`   ⏰ Start Time: ${startTime}`);
            console.log(`   ${streamInfo}`);
            console.log(`   👥 Attendees: ${t.numAttendees || 'Unknown'}`);
            console.log('');
        });

        return todaysTournaments;

    } catch (error) {
        console.error('❌ Error fetching tournaments:', error.message);
        return [];
    }
}

/**
 * Get competitors/entrants for a specific tournament
 */
async function getTournamentCompetitors(tournamentSlug) {
    console.log(`\n🏆 Fetching competitors for: ${tournamentSlug}\n`);

    const query = `
        query GetTournamentEntrants($slug: String!, $page: Int!) {
            tournament(slug: $slug) {
                id
                name
                events {
                    id
                    name
                    numEntrants
                    entrants(query: {
                        page: $page
                        perPage: 50
                    }) {
                        pageInfo {
                            total
                            totalPages
                        }
                        nodes {
                            id
                            name
                            participants {
                                id
                                gamerTag
                                user {
                                    id
                                    slug
                                }
                            }
                        }
                    }
                }
            }
        }
    `;

    try {
        const data = await executeQuery(query, { slug: tournamentSlug, page: 1 }, AUTH_TOKEN);
        const tournament = data.tournament;

        console.log(`Tournament: ${tournament.name}`);
        console.log(`🆔 Tournament ID: ${tournament.id}\n`);

        tournament.events.forEach(event => {
            console.log(`\n📋 Event: ${event.name}`);
            console.log(`   Total Entrants: ${event.numEntrants}`);
            
            if (event.entrants.nodes.length > 0) {
                console.log(`   Showing first ${Math.min(20, event.entrants.nodes.length)} entrants:\n`);
                
                event.entrants.nodes.slice(0, 20).forEach((entrant, idx) => {
                    const gamerTags = entrant.participants.map(p => p.gamerTag).join(' / ');
                    console.log(`   ${idx + 1}. ${gamerTags} (Entrant ID: ${entrant.id})`);
                });

                if (event.entrants.nodes.length > 20) {
                    console.log(`   ... and ${event.entrants.nodes.length - 20} more`);
                }
            }
        });

        return tournament;

    } catch (error) {
        console.error('❌ Error fetching competitors:', error.message);
        return null;
    }
}

/**
 * Test smashdb.me API with a tournament ID
 */
async function testSmashDBAPI(tournamentId) {
    console.log(`\n\n🔍 Testing SmashDB API with Tournament ID: ${tournamentId}\n`);

    const smashDBUrl = `http://smashdb.me/api/tournament/${tournamentId}`;
    
    try {
        console.log(`Making request to: ${smashDBUrl}`);
        const response = await axios.get(smashDBUrl, {
            timeout: 10000 // 10 second timeout
        });

        console.log('✅ SmashDB API Response:\n');
        console.log(JSON.stringify(response.data, null, 2));

        return response.data;

    } catch (error) {
        if (error.response) {
            console.error(`❌ SmashDB API Error (${error.response.status}):`, error.response.data);
        } else if (error.code === 'ECONNABORTED') {
            console.error('❌ Request timed out - SmashDB API may be slow or unavailable');
        } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            console.error('❌ Could not connect to SmashDB API - server may be down');
        } else {
            console.error('❌ Error:', error.message);
        }
        return null;
    }
}

/**
 * Main test function
 */
async function runTests() {
    console.log('🎮 SMASH TOURNAMENT TRACKER - TODAY\'S TOURNAMENTS TEST\n');
    console.log('='.repeat(60));
    console.log('');

    // Step 1: Get today's tournaments
    const todaysTournaments = await getTodaysTournaments();

    if (todaysTournaments.length === 0) {
        console.log('⚠️  No tournaments found for today. Exiting.');
        return;
    }

    // Step 2: Get competitors for the first tournament
    const firstTournament = todaysTournaments[0];
    console.log('\n' + '='.repeat(60));
    const tournamentDetails = await getTournamentCompetitors(firstTournament.slug);

    // Step 3: Test SmashDB API
    if (tournamentDetails) {
        console.log('\n' + '='.repeat(60));
        await testSmashDBAPI(tournamentDetails.id);
    }

    console.log('\n\n✅ All tests completed!');
}

// Run the tests
runTests();
