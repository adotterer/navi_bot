import fs from 'fs/promises';
import { fetchFromS3, uploadToS3 } from '../shared/s3Helper.js';
import { getPlayerBySlug } from './startggClient.js';

function getTodayDate() {
    return new Date().toISOString().slice(0, 10);
}

async function loadZeldaPlayersFromS3OrLocal() {
    const key = process.env.ZELDA_PLAYERS_KEY || 'zelda_players.json';

    try {
        const json = await fetchFromS3(key);
        if (json?.players) {
            return { key, players: json.players };
        }
    } catch (error) {
        console.warn(`⚠️  S3 load failed (${key}), falling back to local file: ${error.message}`);
    }

    try {
        const data = await fs.readFile('zelda_players.json', 'utf-8');
        const json = JSON.parse(data);
        return { key, players: json.players || [] };
    } catch (error) {
        return { key, players: [] };
    }
}

async function saveZeldaPlayersToS3(key, players) {
    const payload = JSON.stringify({ players }, null, 2);
    await uploadToS3(key, payload);
}

export async function handleAddZelda(message) {
    const STARTGG_TOKEN = process.env.STARTGG_AUTH_TOKEN || '';
    if (!STARTGG_TOKEN) {
        await message.reply('❌ Start.gg API token not configured.');
        return;
    }

    const input = message.content.trim().split(' ').slice(1).join(' ').trim();
    if (!input) {
        await message.reply('❌ Usage: !add-zelda <start.gg user URL or slug>');
        return;
    }

    try {
        await message.reply('⏳ Resolving Start.gg profile...');
        const { playerId, gamerTag, slug } = await getPlayerBySlug(input, STARTGG_TOKEN);

        if (!playerId) {
            await message.reply('❌ Could not find a player for that Start.gg profile.');
            return;
        }

        const { key, players } = await loadZeldaPlayersFromS3OrLocal();

        const alreadyExists = players.some(p => p.playerId === playerId ||
            (p.gamerTag && gamerTag && p.gamerTag.toLowerCase() === gamerTag.toLowerCase()));

        if (alreadyExists) {
            await message.reply(`✅ ${gamerTag || slug} is already in the Zelda list (playerId: ${playerId}).`);
            return;
        }

        const newPlayer = {
            playerId,
            gamerTag: gamerTag || slug,
            addedDate: getTodayDate()
        };

        players.push(newPlayer);
        await saveZeldaPlayersToS3(key, players);

        await message.reply(`✅ Added ${newPlayer.gamerTag} (playerId: ${newPlayer.playerId}) to Zelda list.`);
    } catch (error) {
        console.error('❌ Error adding Zelda player:', error.message);
        await message.reply(`❌ Failed to add Zelda player: ${error.message}`);
    }
}

export async function handleListZelda(message) {
    try {
        const { key, players } = await loadZeldaPlayersFromS3OrLocal();

        if (players.length === 0) {
            await message.reply('📭 No Zelda players in list.');
            return;
        }

        const list = players
            .map((p, idx) => `${idx + 1}. ${p.gamerTag} (ID: ${p.playerId}) - Added: ${p.addedDate}`)
            .join('\n');

        const messageContent = `🎮 **Zelda Players Tracked** (${players.length})\n\n${list}`;

        // Split if too long
        const maxLength = 1900;
        if (messageContent.length > maxLength) {
            for (let i = 0; i < messageContent.length; i += maxLength) {
                await message.channel.send(messageContent.slice(i, i + maxLength));
            }
        } else {
            await message.reply(messageContent);
        }
    } catch (error) {
        console.error('❌ Error listing Zelda players:', error.message);
        await message.reply(`❌ Failed to list Zelda players: ${error.message}`);
    }
}
