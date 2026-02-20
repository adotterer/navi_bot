import { Client, GatewayIntentBits } from "discord.js";
import dotenv from 'dotenv';

// Import handlers
import { handleExportCharacter, handleExportMatchups, handleListThreadCounts } from './src/export/exportHandler.js';
import { handleMatchupNotes, handleMuQuestion, handleRefinement } from './src/matchups/matchupHandler.js';
import { handleQuestion } from './src/messages/questionHandler.js';
import { handleShouldHave, handleArenaIsUp, followupResponses, lanWarningResponses } from './src/messages/messageHandlers.js';
import { initializeScheduler } from './src/shared/scheduler.js';
import { checkTodaysTournaments } from './src/tournaments/dailyTournamentCheck.js';
import { handleAddZelda, handleListZelda } from './src/tournaments/addZeldaCommand.js';
import { handleStatsLookup, handleStatsQuestion } from './src/stats/statsHandler.js';
import { handleFrameDataLookup, handleFrameDataQuestion } from './src/stats/frameDataHelper.js';
import { handleCleanup } from './src/messages/cleanupHandler.js';
import { handleDocs, handleFaq, handleAliases } from './src/messages/faqAndAliasHandler.js';
import { setClient } from './src/shared/discordClient.js';

dotenv.config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN || '';

// ========== EXPRESS SERVER SETUP ==========
import { createApp } from './src/app.js';

const app = createApp();
const PORT = process.env.PORT || 8080;

(async () => {
    try {
        const { syncAliasesFromS3 } = await import('./src/shared/aliasSync.js');
        const { syncEmojisFromS3 } = await import('./src/shared/emojiSync.js');
        await syncAliasesFromS3();
        await syncEmojisFromS3();
    } catch (_) {
        // S3 optional at startup (e.g. no creds or key not yet created)
    }
})();

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
    setClient(client);

    client.user.setPresence({
        activities: [{ name: "Use !docs, !faq, !aliases", type: 0 }],
        status: "online"
    });
});
// ========== MESSAGE HANDLERS ==========
// Handler 1: "should have" → "could have" + Arena LAN warning
client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    const channelName = message.channel?.name?.toLowerCase() || '';
    const normalizedChannelName = channelName.replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    const isAskNaviChannel = normalizedChannelName.includes('ask') && normalizedChannelName.includes('navi');
    const isMuCommand = message.content.toLowerCase().startsWith("!mu-notes") ||
        message.content.toLowerCase().startsWith("!mu") ||
        message.content.toLowerCase().startsWith("!mu-question") ||
        message.content.toLowerCase().startsWith("!mu-q") ||
        message.content.toLowerCase().startsWith("!muq") ||
        message.content.toLowerCase().startsWith("!mq");
    const isFdqCommand = message.content.toLowerCase().startsWith("!fdq ");

    if (isAskNaviChannel) {
        // Always allow katyparry messages
        if (message.author.id === "596207448935628812") return;

        // Allow replies to the bot
        if (message.reference?.messageId) {
            try {
                const repliedMessage = await message.channel.messages.fetch(message.reference.messageId);
                if (repliedMessage.author.id === client.user.id) return;
            } catch (error) {
                console.error("Error checking reply target:", error);
            }
        }

        // Allow MU commands and FDQ only
        if (!isMuCommand && !isFdqCommand) {
            const hasAuthorizedRole = message.member?.roles?.cache?.some(
            role => role.name === "Moderators" || role.name === "Legend"
            );

            if (!hasAuthorizedRole) {
            try {
                await message.delete();
            } catch (error) {
                console.error("Error deleting message in ask-navi:", error);
            }
            return;
        }
    }
    }
    
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

    const channelName = message.channel?.name?.toLowerCase() || '';
    const normalizedChannelName = channelName.replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    const isAskNaviChannel = normalizedChannelName.includes('ask') && normalizedChannelName.includes('navi');
    const isMuCommand = message.content.toLowerCase().startsWith("!mu-notes") ||
        message.content.toLowerCase().startsWith("!mu") ||
        message.content.toLowerCase().startsWith("!mu-question") ||
        message.content.toLowerCase().startsWith("!mu-q") ||
        message.content.toLowerCase().startsWith("!muq") ||
        message.content.toLowerCase().startsWith("!mq");
    const isFdqCommand = message.content.toLowerCase().startsWith("!fdq ");
    const isExportCommand = message.content.toLowerCase().startsWith("!export");
    const isCleanupCommand = message.content.toLowerCase().startsWith("!cleanupall") ||
        message.content.toLowerCase().startsWith("!cleanup");
    const isQuestionCommand = message.content.toLowerCase().startsWith("!q ");
    const isSqCommand = message.content.toLowerCase().startsWith("!sq ");
    const isDocsCommand = message.content.toLowerCase() === "!docs";
    const isFaqCommand = message.content.toLowerCase() === "!faq";
    const isAliasesCommand = message.content.toLowerCase() === "!aliases";

    const hasAuthorizedRole = message.member?.roles?.cache?.some(
        role => role.name === "Moderators" || role.name === "Legend"
    );

    // ===== PERMISSION GATES =====
    // Export commands: Moderators + Legend only, any channel
    if (isExportCommand && !hasAuthorizedRole) {
        await message.reply("❌ Only Moderators or Legend members can run export commands.");
        return;
    }

    // Cleanup commands: Moderators + Legend only, any channel
    if (isCleanupCommand && !hasAuthorizedRole) {
        await message.reply("❌ Only Moderators or Legend members can run cleanup commands.");
        return;
    }

    // MU notes/questions: anyone in ask-navi; Moderators/Legend anywhere
    if (isMuCommand && !hasAuthorizedRole && !isAskNaviChannel) {
        await message.reply("❌ This command can only be used in the ask-navi channel.");
        return;
    }

    // FDQ: anyone in ask-navi; Moderators/Legend anywhere
    if (isFdqCommand && !hasAuthorizedRole && !isAskNaviChannel) {
        await message.reply("❌ This command can only be used in the ask-navi channel.");
        return;
    }

    // General questions: anyone in ask-navi; Moderators/Legend anywhere
    if (isQuestionCommand && !hasAuthorizedRole && !isAskNaviChannel) {
        await message.reply("❌ This command can only be used in the ask-navi channel.");
        return;
    }

    // Stats questions (!sq): anyone in ask-navi; Moderators/Legend anywhere
    if (isSqCommand && !hasAuthorizedRole && !isAskNaviChannel) {
        await message.reply("❌ This command can only be used in the ask-navi channel.");
        return;
    }

    // Docs/FAQ + alias commands are allowed for everyone in any channel
    if (isDocsCommand) {
        await handleDocs(message);
        return;
    }

    if (isFaqCommand) {
        await handleFaq(message);
        return;
    }

    if (isAliasesCommand) {
        await handleAliases(message);
        return;
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
    if (message.content.toLowerCase().startsWith("!export")) {
        const input = message.content.trim().split(" ").slice(1).join(" ").trim();

        if (!input) {
            await message.reply("❌ Usage: !export <character> or !export matchups");
            return;
        }

        if (input.toLowerCase() === "matchups") {
            await handleExportMatchups(message);
            return;
        }

        await handleExportCharacter(message);
        return;
    }

    // ===== LIST THREAD COUNTS =====
    if (message.content.toLowerCase() === "!list-thread-counts") {
        await handleListThreadCounts(message);
        return;
    }

    // ===== CLEANUP =====
    if (message.content.toLowerCase().startsWith("!cleanupall")) {
        await handleCleanup(message, client, { deleteAll: true });
        return;
    }

    if (message.content.toLowerCase().startsWith("!cleanup")) {
        await handleCleanup(message, client, { deleteAll: false });
        return;
    }

    // ===== MU QUESTION =====
    if (message.content.toLowerCase().startsWith("!mu-question") ||
        message.content.toLowerCase().startsWith("!mu-q") ||
        message.content.toLowerCase().startsWith("!muq") ||
        message.content.toLowerCase().startsWith("!mq ")) {
        await handleMuQuestion(message);
        return;
    }

    // ===== GENERAL QUESTION =====
    if (message.content.toLowerCase().startsWith("!q ")) {
        await handleQuestion(message);
        return;
    }

    // ===== STATS LOOKUP =====
    if (message.content.toLowerCase().startsWith("!stats") ||
        message.content.toLowerCase().startsWith("!s ")) {
        const args = message.content.trim().split(/\s+/).slice(1);
        await handleStatsLookup(message, args);
        return;
    }

    // ===== STATS QUESTION =====
    if (message.content.toLowerCase().startsWith("!sq ")) {
        const question = message.content.slice(4).trim();
        await handleStatsQuestion(message, question);
        return;
    }

    // ===== FRAME DATA LOOKUP =====
    if (message.content.toLowerCase().startsWith("!fd ")) {
        const args = message.content.trim().split(/\s+/).slice(1);
        await handleFrameDataLookup(message, args);
        return;
    }

    // ===== FRAME DATA QUESTION =====
    if (message.content.toLowerCase().startsWith("!fdq ")) {
        const question = message.content.slice(5).trim();
        await handleFrameDataQuestion(message, question);
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
    if (message.content.toLowerCase().startsWith("!mu-notes") ||
        message.content.toLowerCase().startsWith("!mu")) {
        await handleMatchupNotes(message);
        return;
    }

    // ===== ADD ZELDA PLAYER =====
    if (message.content.toLowerCase().startsWith("!add-zelda")) {
        await handleAddZelda(message);
        return;
    }

    // ===== LIST ZELDA PLAYERS =====
    if (message.content.toLowerCase() === "!list-zeldas") {
        await handleListZelda(message);
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
                    `🔗 <https://www.start.gg/${tournament.tournamentSlug}>`;

                await message.channel.send(messageContent);
            }
        } catch (error) {
            console.error("Error checking tournaments:", error);
            await message.reply(`❌ Error checking tournaments: ${error.message}`);
        }
        return;
    }
});
