import dotenv from 'dotenv';
import { executeQuery } from './src/tournaments/startggClient.js';

dotenv.config();

const AUTH_TOKEN = process.env.STARTGG_AUTH_TOKEN;

/**
 * Get character main from Start.gg tournament history
 */
async function getPlayerMainFromAPI(userId) {
    console.log(`🔍 Analyzing character usage for user ID: ${userId}\n`);

    // Query user's tournament placements with character selections
    const query = `
        query GetPlayerCharacters($userId: ID!) {
            user(id: $userId) {
                id
                slug
                player {
                    id
                    gamerTag
                    recentSets {
                        id
                        displayScore
                        event {
                            id
                            name
                            videogame {
                                id
                                name
                            }
                        }
                        slots {
                            id
                            entrant {
                                id
                                participants {
                                    player {
                                        id
                                    }
                                }
                            }
                        }
                        games {
                            id
                            state
                            winnerId
                            selections {
                                entrant {
                                    id
                                }
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
        const data = await executeQuery(query, { userId }, AUTH_TOKEN);
        
        if (!data.user) {
            console.log('❌ User not found');
            return null;
        }

        const gamerTag = data.user.player?.gamerTag || data.user.slug;
        console.log(`✅ Found user: ${gamerTag}\n`);

        if (!data.user.player.recentSets || data.user.player.recentSets.length === 0) {
            console.log('⚠️  No sets found for this player');
            return null;
        }

        console.log(`📊 Analyzing ${data.user.player.recentSets.length} sets...\n`);

        // Aggregate character usage
        const characterCount = {};
        let totalGames = 0;

        data.user.player.recentSets.forEach(set => {
            if (set.games && set.games.length > 0) {
                set.games.forEach(game => {
                    if (game.selections && game.selections.length > 0) {
                        // Find the entrant ID for this player
                        const playerEntrant = set.slots?.find(slot =>
                            slot.entrant?.participants?.some(p => p.player?.id === data.user.player.id)
                        )?.entrant;

                        if (playerEntrant) {
                            game.selections.forEach(selection => {
                                // Only count selections for our player's entrant
                                if (selection.entrant?.id === playerEntrant.id && selection.character) {
                                    const charName = selection.character.name;
                                    characterCount[charName] = (characterCount[charName] || 0) + 1;
                                    totalGames++;
                                }
                            });
                        }
                    }
                });
            }
        });

        if (totalGames === 0) {
            console.log('⚠️  No character data found in games');
            return null;
        }

        // Sort by usage
        const sorted = Object.entries(characterCount)
            .sort(([, a], [, b]) => b - a);

        console.log(`🎮 Character Usage (${totalGames} games total):\n`);
        sorted.forEach(([character, count], idx) => {
            const percentage = ((count / totalGames) * 100).toFixed(1);
            const label = idx === 0 ? '👑 MAIN' : '   Alt ';
            console.log(`${label}: ${character.padEnd(20)} - ${count} games (${percentage}%)`);
        });

        const mainCharacter = sorted[0][0];
        console.log(`\n✅ Main Character: ${mainCharacter}`);
        
        return mainCharacter;

    } catch (error) {
        console.error('❌ Error:', error.message);
        return null;
    }
}

/**
 * Main test
 */
async function testCharacterDetection() {
    console.log('🎮 START.GG CHARACTER DETECTION TEST\n');
    console.log('='.repeat(60));
    console.log('\n');

    // Test with user ID 4b56197c (should be Zelda)
    const userId = '4b56197c';
    const result = await getPlayerMainFromAPI(userId);

    console.log('\n' + '='.repeat(60));
    if (result === 'Zelda') {
        console.log('\n✅ SUCCESS! Correctly identified Zelda as main character');
    } else {
        console.log(`\n⚠️  Result: ${result} (expected: Zelda)`);
    }
}

testCharacterDetection();
