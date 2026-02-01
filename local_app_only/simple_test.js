#!/usr/bin/env node

import dotenv from 'dotenv';
import { executeQuery } from './src/tournaments/startggClient.js';

dotenv.config();

const AUTH_TOKEN = process.env.STARTGG_AUTH_TOKEN;

async function getPlayerMainCharacter(userSlug) {
    console.log(`\n🔍 Fetching character data for: ${userSlug}\n`);

    // First get user and player info
    const userQuery = `
        query GetUser($slug: String!) {
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
        const result = await executeQuery(userQuery, { slug: userSlug }, AUTH_TOKEN);
        
        if (!result?.user?.player) {
            console.log('❌ Player not found');
            process.exit(1);
        }
        
        const player = result.user.player;
        console.log(`✅ Found: ${player.gamerTag} (ID: ${player.id})`);
        
        if (!player.recentSets || player.recentSets.length === 0) {
            console.log('⚠️  No recent sets found for this player');
            process.exit(1);
        }
        
        console.log(`📊 Recent Sets: ${player.recentSets.length}\n`);

        // Aggregate characters
        const characterCount = {};
        let totalGames = 0;

        player.recentSets.forEach(set => {
            if (!set.games) return;

            set.games.forEach(game => {
                if (!game.selections) return;

                // Find player's entrant in this set
                const playerEntrant = set.slots?.find(slot =>
                    slot.entrant?.id && set.games // just need to find a valid entrant
                )?.entrant;

                if (!playerEntrant) {
                    console.log('⚠️  Could not find entrant for set');
                    return;
                }

                // Log for debugging
                console.log(`Set: ${set.id}, Entrants: ${set.slots.map(s => s.entrant.id).join(', ')}`);

                game.selections.forEach(selection => {
                    if (selection.character?.name) {
                        const charName = selection.character.name;
                        characterCount[charName] = (characterCount[charName] || 0) + 1;
                        totalGames++;
                        console.log(`  Game ${game.id}: Entrant ${selection.entrant.id} - ${charName}`);
                    }
                });
            });
        });

        console.log(`\n📈 Character Statistics (${totalGames} games):`);
        const sorted = Object.entries(characterCount)
            .sort(([, a], [, b]) => b - a);

        sorted.forEach(([char, count]) => {
            const pct = ((count / totalGames) * 100).toFixed(1);
            console.log(`  ${char.padEnd(20)} ${count} games (${pct}%)`);
        });

        if (sorted.length > 0) {
            console.log(`\n✅ Main Character: ${sorted[0][0]}`);
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
    
    process.exit(0);
}

getPlayerMainCharacter('4b56197c');
