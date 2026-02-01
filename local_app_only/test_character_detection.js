import dotenv from 'dotenv';
import axios from 'axios';
import { executeQuery } from './src/tournaments/startggClient.js';

dotenv.config();

const AUTH_TOKEN = process.env.STARTGG_AUTH_TOKEN;

/**
 * Get a player's recent sets to determine their main character
 */
async function getPlayerCharacterFromMatches(userId) {
    console.log(`\n🔍 Analyzing character usage for User ID: ${userId}\n`);

    const query = `
        query GetPlayerSets($userId: ID!, $page: Int!) {
            user(id: $userId) {
                id
                slug
                player {
                    id
                    gamerTag
                    recentSets(page: $page, perPage: 20) {
                        nodes {
                            id
                            displayScore
                            fullRoundText
                            event {
                                name
                                videogame {
                                    name
                                }
                            }
                            slots {
                                entrant {
                                    participants {
                                        user {
                                            id
                                        }
                                        gamerTag
                                    }
                                }
                                standing {
                                    placement
                                }
                            }
                        }
                    }
                }
            }
        }
    `;

    try {
        const data = await executeQuery(query, { userId, page: 1 }, AUTH_TOKEN);
        return data.user;
    } catch (error) {
        console.error('❌ Error fetching player sets:', error.message);
        return null;
    }
}

/**
 * Test schustats.com API/website access
 */
async function testSchustatsAccess(gamerTag) {
    console.log(`\n🎯 Testing schustats.com access for: ${gamerTag}\n`);

    const urls = [
        `https://www.schustats.com/get_character?tag=${encodeURIComponent(gamerTag)}`,
        `https://www.schustats.com/api/get_character?tag=${encodeURIComponent(gamerTag)}`,
        `http://schustats.com/get_character?tag=${encodeURIComponent(gamerTag)}`
    ];

    for (const url of urls) {
        try {
            console.log(`Trying: ${url}`);
            const response = await axios.get(url, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
                }
            });

            console.log('✅ SUCCESS! Response:');
            console.log(JSON.stringify(response.data, null, 2));
            return response.data;

        } catch (error) {
            if (error.response) {
                console.log(`   ⚠️  HTTP ${error.response.status}: ${error.response.statusText}`);
            } else if (error.code === 'ECONNABORTED') {
                console.log('   ⚠️  Timeout');
            } else {
                console.log(`   ⚠️  ${error.message}`);
            }
        }
    }

    console.log('\n❌ All schustats.com endpoints failed\n');
    return null;
}

/**
 * Get entrant's character selections from tournament sets
 */
async function getEntrantCharacterFromSets(eventId, entrantId) {
    console.log(`\n🎮 Fetching character data from event sets...\n`);

    const query = `
        query GetEventSetsWithCharacters($eventId: ID!, $entrantId: ID!) {
            event(id: $eventId) {
                id
                name
                sets(
                    filters: {
                        entrantIds: [$entrantId]
                    }
                    perPage: 10
                ) {
                    nodes {
                        id
                        fullRoundText
                        displayScore
                        slots {
                            entrant {
                                id
                                name
                            }
                            standing {
                                placement
                                stats {
                                    score {
                                        value
                                    }
                                }
                            }
                        }
                        games {
                            id
                            orderNum
                            winnerId
                            selections {
                                entrant {
                                    id
                                    name
                                }
                                selectionType
                                selectionValue
                                character {
                                    id
                                    name
                                }
                            }
                        }
                    }
                }
            }
        }
    `;

    try {
        const data = await executeQuery(query, { eventId, entrantId }, AUTH_TOKEN);
        return data.event.sets;
    } catch (error) {
        console.error('❌ Error fetching set character data:', error.message);
        return null;
    }
}

/**
 * Analyze character usage from sets data
 */
function analyzeCharacterUsage(sets) {
    const characterCount = {};
    let totalGames = 0;

    if (!sets || !sets.nodes) {
        return null;
    }

    sets.nodes.forEach(set => {
        if (set.games && set.games.length > 0) {
            set.games.forEach(game => {
                if (game.selections && game.selections.length > 0) {
                    game.selections.forEach(selection => {
                        if (selection.character) {
                            const charName = selection.character.name;
                            characterCount[charName] = (characterCount[charName] || 0) + 1;
                            totalGames++;
                        }
                    });
                }
            });
        }
    });

    return { characterCount, totalGames };
}

/**
 * Main test function
 */
async function runCharacterTests() {
    console.log('🎮 CHARACTER MAIN DETECTION TEST\n');
    console.log('='.repeat(60));

    // Test 1: Try schustats.com with a known player
    console.log('\n📊 TEST 1: Accessing schustats.com');
    console.log('Testing with known player "Sparg0" (top player)\n');
    await testSchustatsAccess('Sparg0');
    
    console.log('\n' + '='.repeat(60));
    console.log('\n📊 TEST 2: Get character data from Start.gg sets');
    
    // Get a tournament with actual match data
    const tournamentId = 875563; // Power Play! #12
    const eventId = 1286051; // You'll need to get this from the tournament
    const entrantId = 22497682; // GrizHawk from earlier test
    
    console.log(`Testing with Tournament: ${tournamentId}`);
    console.log(`Event ID: ${eventId}`);
    console.log(`Entrant ID: ${entrantId}\n`);

    const setsData = await getEntrantCharacterFromSets(eventId, entrantId);
    
    if (setsData) {
        console.log('✅ Sets data retrieved!\n');
        console.log(`Found ${setsData.nodes.length} sets for this entrant\n`);
        
        // Analyze character usage
        const analysis = analyzeCharacterUsage(setsData);
        
        if (analysis && analysis.totalGames > 0) {
            console.log('🎯 Character Usage Analysis:');
            console.log(`Total games analyzed: ${analysis.totalGames}\n`);
            
            // Sort by usage
            const sorted = Object.entries(analysis.characterCount)
                .sort(([, a], [, b]) => b - a);
            
            sorted.forEach(([character, count], idx) => {
                const percentage = ((count / analysis.totalGames) * 100).toFixed(1);
                const label = idx === 0 ? '👑 MAIN' : '   Alt';
                console.log(`${label}: ${character} - ${count} games (${percentage}%)`);
            });
        } else {
            console.log('⚠️  No character data found in sets (likely incomplete match reporting)');
        }
    }

    console.log('\n\n' + '='.repeat(60));
    console.log('\n📝 FINDINGS & RECOMMENDATIONS:\n');
    console.log('1. Schustats.com endpoint results (see above)');
    console.log('2. Start.gg character data availability depends on tournament reporting');
    console.log('3. For reliable character mains, we may need to:');
    console.log('   - Scrape schustats.com if accessible');
    console.log('   - Build manual database of known players');
    console.log('   - Aggregate from multiple tournaments over time');
    console.log('   - Use community-sourced data\n');
}

// Run the tests
runCharacterTests();
