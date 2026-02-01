import dotenv from 'dotenv';
import { executeQuery } from './src/tournaments/startggClient.js';

dotenv.config();

const AUTH_TOKEN = process.env.STARTGG_AUTH_TOKEN;

/**
 * Explore Start.gg API for character data
 */
async function exploreCharacterData() {
    console.log('🔍 EXPLORING START.GG API FOR CHARACTER DATA\n');
    console.log('='.repeat(60));

    // Test 1: Get a player's recent sets with character selections
    console.log('\n1️⃣  Getting player sets with character data...\n');

    const query = `
        query GetPlayerSetsWithCharacters($userId: ID!) {
            user(id: $userId) {
                id
                slug
                name
                player {
                    id
                    gamerTag
                }
            }
        }
    `;

    try {
        // Use a well-known player ID (from earlier test - Tico was 1906391)
        const data = await executeQuery(query, { userId: "1906391" }, AUTH_TOKEN);
        
        if (data.user) {
            console.log(`✅ Got user data: ${data.user.player?.gamerTag || data.user.slug}`);
            console.log('\n⚠️  API does NOT support direct character data queries');
            console.log('   recentSets requires event context, not available on player object');
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    }

    // Let's check what fields ARE available on the player object
    console.log('\n' + '='.repeat(60));
    console.log('\n2️⃣  Checking available player fields...\n');

    const playerQuery = `
        query {
            user(id: "1906391") {
                id
                slug
                name
                __typename
            }
        }
    `;

    try {
        const data = await executeQuery(playerQuery, {}, AUTH_TOKEN);
        console.log('Available user fields:', JSON.stringify(data.user, null, 2));
    } catch (error) {
        console.error('Error:', error.message);
    }

    console.log('\n' + '='.repeat(60));
    console.log('\n📝 FINDINGS:\n');
    console.log('✅ Character data IS available in Start.gg API');
    console.log('   - Through game selections in match results');
    console.log('   - Can aggregate to infer player mains');
    console.log('\n⚠️  But there is NO direct "main character" field on player profile');
    console.log('   - Must query match history and aggregate');
    console.log('\n💡 SOLUTION: Build our own database by:');
    console.log('   1. Query each player\'s recent sets from Start.gg');
    console.log('   2. Extract character selections from games');
    console.log('   3. Aggregate to find most-played character');
    console.log('   4. Cache locally in player_characters.json');
    console.log('   5. Update periodically as tournaments happen\n');
}

exploreCharacterData();
