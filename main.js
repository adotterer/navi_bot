import { Client, GatewayIntentBits } from "discord.js";
import express from 'express';
import dotenv from 'dotenv';

// Import handlers
import { handleExportFalco, handleExportMatchups } from './src/export/exportHandler.js';
import { handleMatchupNotes, handleMuQuestion, handleRefinement } from './src/matchups/matchupHandler.js';
import { handleShouldHave, handleArenaIsUp, followupResponses, lanWarningResponses } from './src/messages/messageHandlers.js';
import { initializeScheduler } from './src/shared/scheduler.js';
import { checkTodaysTournaments } from './src/tournaments/dailyTournamentCheck.js';

dotenv.config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN || '';

// ========== EXPRESS SERVER SETUP ==========
const app = express();
const PORT = process.env.PORT || 8080;

app.use('/exports', express.static('.'));
app.get('/', (req, res) => {
    res.send('Navi Bot is running! 🧚');
});

app.listen(PORT, () => {
    console.log(`🌐 HTTP server running on port ${PORT}`);
});

// ========== DISCORD BOT SETUP ==========
const client = new Client({ intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
] });

client.login(DISCORD_TOKEN);

client.on("clientReady", () => {
    console.log(`✅ Bot logged in as ${client.user.tag}`);
    
    // Initialize weekly export scheduler
    initializeScheduler(client);
});

// ========== MESSAGE HANDLERS ==========

// Handler 1: "should have" → "could have" + Arena LAN warning
client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (message.channel.name === "real-talk") return;
    
    console.log(`📨 Message received from ${message.author.tag} in #${message.channel.name}: ${message.content}`);

    // Check for "should have" trigger
    if (await handleShouldHave(message, followupResponses)) return;

    // Check for arena is up/ready trigger
    if (await handleArenaIsUp(message, lanWarningResponses)) return;
});

// Handler 2: Commands (!export, !match-up-notes, !mu-question) + Refinement replies
client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    // ===== COMMAND GATE: MODERATORS ONLY =====
    const isCommand = message.content.toLowerCase().startsWith("!export") ||
        message.content.toLowerCase().startsWith("!match-up-notes") ||
        message.content.toLowerCase().startsWith("!mu-question") ||
        message.content.toLowerCase().startsWith("!list-categories") ||
        message.content.toLowerCase().startsWith("!matches-today");

    if (isCommand) {
        const hasModeratorRole = message.member?.roles?.cache?.some(
            role => role.name === "Moderators"
        );

        if (!hasModeratorRole) {
            await message.reply("❌ Only moderators can run this command.");
            return;
        }
    }

    // ===== CONVERSATIONAL REFINEMENT (reply to bot's match-up notes) =====
    if (message.reference) {
        try {
            const repliedMessage = await message.channel.messages.fetch(message.reference.messageId);
            
            if (repliedMessage.author.id === client.user.id && repliedMessage.content.includes("🔎")) {
                await handleRefinement(message, repliedMessage, client);
                return;
            }
        } catch (error) {
            console.error("Error in conversational refinement:", error);
        }
    }

    // ===== EXPORT COMMANDS =====
    if (message.content.toLowerCase() === "!export falco") {
        await handleExportFalco(message);
        return;
    }

    if (message.content.toLowerCase() === "!export matchups") {
        await handleExportMatchups(message);
        return;
    }

    // ===== MU QUESTION =====
    if (message.content.toLowerCase().startsWith("!mu-question")) {
        await handleMuQuestion(message);
        return;
    }

    // ===== LIST CATEGORIES =====
    if (message.content.toLowerCase().startsWith("!list-categories")) {
        const input = message.content.trim();
        const rawArgs = input.split(" ").slice(1).join(" ").trim();

        const guild = message.guild;
        if (!guild) {
            await message.reply("❌ This command must be used in a server.");
            return;
        }

        const sendInChunks = async (text) => {
            const maxLength = 1900;
            for (let i = 0; i < text.length; i += maxLength) {
                await message.channel.send(text.slice(i, i + maxLength));
            }
        };

        if (!rawArgs) {
            const categoryNames = guild.channels.cache
                .filter(ch => ch.children)
                .map(ch => ch.name)
                .sort((a, b) => a.localeCompare(b));

            if (categoryNames.length === 0) {
                await message.reply("⚠️ No categories found.");
                return;
            }

            const output = `📂 **Categories (${categoryNames.length})**\n` +
                categoryNames.map(name => `• ${name}`).join("\n");
            await sendInChunks(output);
            return;
        }

        const categoryName = rawArgs;
        const category = guild.channels.cache.find(
            ch => ch.children && ch.name === categoryName
        );

        if (!category) {
            await message.reply(`⚠️ Category not found: ${categoryName}`);
            return;
        }

        const channelNames = category.children.cache
            .filter(ch => ch.isTextBased())
            .map(ch => `#${ch.name}`)
            .sort((a, b) => a.localeCompare(b));

        if (channelNames.length === 0) {
            await message.reply(`⚠️ No text channels found under **${categoryName}**.`);
            return;
        }

        const output = `📁 **${categoryName}** (${channelNames.length})\n` +
            channelNames.map(name => `• ${name}`).join("\n");
        await sendInChunks(output);
        return;
    }

    // ===== MATCH-UP NOTES =====
    if (message.content.toLowerCase().startsWith("!match-up-notes")) {
        await handleMatchupNotes(message);
        return;
    }

    // ===== MATCHES TODAY =====
    if (message.content.toLowerCase() === "!matches-today") {
        const STARTGG_TOKEN = process.env.STARTGG_AUTH_TOKEN || '';
        if (!STARTGG_TOKEN) {
            await message.reply("❌ Start.gg API token not configured.");
            return;
        }

        try {
            await message.reply("⏳ Checking today's tournaments for Zelda players...");
            const tournaments = await checkTodaysTournaments(STARTGG_TOKEN);

            if (tournaments.length === 0) {
                await message.reply("❌ No Zelda players found in today's tournaments with Ultimate Singles.");
                return;
            }

            // Post one message per tournament
            for (const tournament of tournaments) {
                const startTime = new Date(tournament.startAt * 1000).toLocaleTimeString('en-US', { 
                    hour: '2-digit', 
                    minute: '2-digit', 
                    timeZone: 'America/New_York'
                });
                const streamInfo = tournament.streams.length > 0
                    ? tournament.streams.map(s => `${s.streamName} (${s.streamSource})`).join(', ')
                    : 'No streams listed';

                const playersList = tournament.zeldaPlayers
                    .map(p => `• ${p.gamerTag}`)
                    .join('\n');

                const messageContent = `🏆 **${tournament.tournamentName}**\n` +
                    `📅 Start: ${startTime} EST\n` +
                    `🎮 Event: ${tournament.eventName}\n` +
                    `👤 Zelda Player(s):\n${playersList}\n` +
                    `📺 Streams: ${streamInfo}\n` +
                    `🔗 https://www.start.gg/${tournament.tournamentSlug}`;

                await message.channel.send(messageContent);
            }
        } catch (error) {
            console.error("Error checking tournaments:", error);
            await message.reply(`❌ Error checking tournaments: ${error.message}`);
        }
        return;
    }
});
