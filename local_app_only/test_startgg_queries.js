import dotenv from 'dotenv';
import { getTournament, getActiveTournaments } from './src/tournaments/startggClient.js';

dotenv.config();

const AUTH_TOKEN = process.env.STARTGG_AUTH_TOKEN;
const SSBU_VIDEOGAME_ID = 1386; // Super Smash Bros Ultimate

/**
 * Test various Start.gg queries
 */
async function testQueries() {
    console.log('🎮 Testing Start.gg API Queries\n');

    try {
        // Test 1: Get a specific tournament (Genesis X as example)
        console.log('1️⃣  Testing getTournament()...');
        const tournament = await getTournament('genesis-x', AUTH_TOKEN);
        console.log(`✅ Found tournament: "${tournament.name}"`);
        console.log(`   Location: ${tournament.city}, ${tournament.countryCode}`);
        console.log(`   Attendees: ${tournament.numAttendees}`);
        console.log(`   Events: ${tournament.events.length}`);
        if (tournament.streams && tournament.streams.length > 0) {
            console.log(`   Streams: ${tournament.streams.map(s => s.streamName).join(', ')}`);
        }
        console.log('');

        // Test 2: Get active/upcoming SSBU tournaments
        console.log('2️⃣  Testing getActiveTournaments()...');
        const tournaments = await getActiveTournaments(SSBU_VIDEOGAME_ID, AUTH_TOKEN);
        console.log(`✅ Found ${tournaments.length} upcoming SSBU tournaments`);
        
        if (tournaments.length > 0) {
            console.log('\n   First 5 tournaments:');
            tournaments.slice(0, 5).forEach((t, idx) => {
                const date = new Date(t.startAt * 1000).toLocaleDateString();
                const streamInfo = t.streams && t.streams.length > 0 
                    ? `📺 ${t.streams.length} stream(s)` 
                    : '⚠️  No streams';
                console.log(`   ${idx + 1}. ${t.name} - ${date} - ${streamInfo}`);
            });
        }
        console.log('');

        console.log('✅ All tests passed!');

    } catch (error) {
        console.error('❌ Error during testing:', error.message);
    }
}

// Run tests
testQueries();
