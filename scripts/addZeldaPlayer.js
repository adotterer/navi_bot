import dotenv from 'dotenv';
import fs from 'fs/promises';
import { executeQuery } from '../src/tournaments/startggClient.js';

dotenv.config();

const AUTH_TOKEN = process.env.STARTGG_AUTH_TOKEN;

/**
 * Add a Zelda player to the list by gamer tag (CLI; writes to local zelda_players.json).
 * For Discord: !add-zelda uses addZeldaCommand.js and S3.
 */
async function addZeldaPlayer(gamerTag) {
    console.log('\n🔍 Looking up player: ' + gamerTag + '\n');

    try {
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
            console.log('❌ Player not found: ' + gamerTag);
            process.exit(1);
        }

        const foundPlayer = result.playerSearch[0];
        const playerId = foundPlayer.player?.id;
        const actualTag = foundPlayer.gamerTag;

        console.log('✅ Found player: ' + actualTag + ' (ID: ' + playerId + ')');

        let zeldaData = { players: [] };
        try {
            const data = await fs.readFile('zelda_players.json', 'utf-8');
            zeldaData = JSON.parse(data);
        } catch (e) {}

        const exists = zeldaData.players.some(p => p.playerId === playerId);
        if (exists) {
            console.log('⚠️  Player already in list');
            process.exit(0);
        }

        zeldaData.players.push({
            playerId: playerId,
            gamerTag: actualTag,
            addedDate: new Date().toISOString().split('T')[0]
        });

        await fs.writeFile('zelda_players.json', JSON.stringify(zeldaData, null, 2));
        console.log('✅ Added ' + actualTag + ' to zelda_players.json\n');

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }

    process.exit(0);
}

const gamerTag = process.argv[2];
if (!gamerTag) {
    console.log('Usage: node scripts/addZeldaPlayer.js "Gamer Tag"');
    console.log('Example: node scripts/addZeldaPlayer.js "Free KayFlock"');
    process.exit(1);
}

addZeldaPlayer(gamerTag);
