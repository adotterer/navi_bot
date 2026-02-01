import dotenv from 'dotenv';
import fs from 'fs/promises';
import { executeQuery } from './startggClient.js';

dotenv.config();

const AUTH_TOKEN = process.env.STARTGG_AUTH_TOKEN;

/**
 * Add a Zelda player to the list by gamer tag
 */
async function addZeldaPlayer(gamerTag) {
    console.log(`\n🔍 Looking up player: ${gamerTag}\n`);

    try {
        // Search for the player
        const query = `
            query SearchPlayer($query: String!) {
                playerSearch(query: $query) {
                    id
                    gamerTag
                    player {
                        id
                    }
                }
            }
        `;

        const result = await executeQuery(query, { query: gamerTag }, AUTH_TOKEN);
        
        if (!result.playerSearch || result.playerSearch.length === 0) {
            console.log(`❌ Player not found: ${gamerTag}`);
            process.exit(1);
        }

        const foundPlayer = result.playerSearch[0];
        const playerId = foundPlayer.player?.id;
        const actualTag = foundPlayer.gamerTag;

        console.log(`✅ Found player: ${actualTag} (ID: ${playerId})`);

        // Load current Zelda players
        let zeldaData = { players: [] };
        try {
            const data = await fs.readFile('zelda_players.json', 'utf-8');
            zeldaData = JSON.parse(data);
        } catch (e) {
            // File doesn't exist or is invalid, start fresh
        }

        // Check if player already exists
        const exists = zeldaData.players.some(p => p.playerId === playerId);
        if (exists) {
            console.log('⚠️  Player already in list');
            process.exit(0);
        }

        // Add new player
        zeldaData.players.push({
            playerId: playerId,
            gamerTag: actualTag,
            addedDate: new Date().toISOString().split('T')[0]
        });

        // Save updated list
        await fs.writeFile('zelda_players.json', JSON.stringify(zeldaData, null, 2));
        console.log(`✅ Added ${actualTag} to zelda_players.json\n`);

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }

    process.exit(0);
}

// Get gamer tag from command line
const gamerTag = process.argv[2];
if (!gamerTag) {
    console.log('Usage: node addZeldaPlayer.js "Gamer Tag"');
    console.log('Example: node addZeldaPlayer.js "Free KayFlock"');
    process.exit(1);
}

addZeldaPlayer(gamerTag);
