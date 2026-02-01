import dotenv from 'dotenv';
import { executeQuery } from './src/tournaments/startggClient.js';

dotenv.config();

const AUTH_TOKEN = process.env.STARTGG_AUTH_TOKEN;

async function getPlayerCharacterFromStartGG(userSlug) {
    console.log(`\n🔍 Fetching character data for user slug: ${userSlug}`);

    // Query: Get user by slug first to get player ID
    const query = `
        query GetUserBySlug($slug: String!) {
            user(slug: $slug) {
                id
                slug
                player {
                    id
                    gamerTag
                    recentSets {
                        id
                        event {
                            id
                            name
                        }
                        slots {
                            id
                            entrant {
                                id
                                name
                                participants {
                                    id
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

    try {
        const data = await executeQuery(query, { slug: userSlug }, AUTH_TOKEN);
        
        if (!data?.user) {
            console.log('❌ User not found');
            return null;
        }

        const player = data.user.player;
        console.log(`✅ Found player: ${player.gamerTag} (ID: ${player.id})`);

        if (!player.recentSets || player.recentSets.length === 0) {
            console.log('⚠️  No recent tournament sets found');
            return null;
        }

        console.log(`\n📊 Analyzing ${player.recentSets.length} recent sets...\n`);

        // Aggregate character usage
        const characterCount = {};
        let totalGames = 0;

        player.recentSets.forEach(set => {
            if (!set.games) return;

            set.games.forEach(game => {
                if (!game.selections) return;

                // Find this player's entrant ID from the set
                const playerEntrant = set.slots?.find(slot =>
                    slot.entrant?.participants?.some(p => p.player?.id === player.id)
                )?.entrant;

                if (!playerEntrant) return;

                game.selections.forEach(selection => {
                    // Only count selections for our player
                    if (selection.entrant?.id === playerEntrant.id && selection.character?.name) {
                        const charName = selection.character.name;
                        characterCount[charName] = (characterCount[charName] || 0) + 1;
                        totalGames++;
                    }
                });
            });
        });

        if (totalGames === 0) {
            console.log('⚠️  No character selections found in games');
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

// Test with user slug
async function main() {
    console.log('🎮 START.GG CHARACTER DETECTION TEST\n');
    console.log('='.repeat(60));

    const result = await getPlayerCharacterFromStartGG('4b56197c');

    console.log('\n' + '='.repeat(60));
    if (result === 'Zelda') {
        console.log('\n✅ SUCCESS! Correctly identified Zelda as main character');
    } else {
        console.log(`\n⚠️  Result: ${result} (expected: Zelda)`);
    }
    
    process.exit(0);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
