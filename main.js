import { Client, GatewayIntentBits, ChannelType, EmbedBuilder } from "discord.js";
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Import handlers
import { handleExportCharacter, handleExportMatchups, handleListThreadCounts } from './src/export/exportHandler.js';
import { handleDMMessage } from './src/messages/dmHandler.js';
import { handleMatchupNotes, handleMuQuestion, handleRefinement } from './src/matchups/matchupHandler.js';
import { handleGeneralTips } from './src/matchups/generalTipsHandler.js';
import { handleQuestion } from './src/messages/questionHandler.js';
import { handleShouldHave, handleArenaIsUp, followupResponses, lanWarningResponses } from './src/messages/messageHandlers.js';
import { initializeScheduler } from './src/shared/scheduler.js';
import { checkTodaysTournaments } from './src/tournaments/dailyTournamentCheck.js';
import { buildTournamentEmbed } from './src/tournaments/tournamentEmbed.js';
import { handleAddZelda, handleListZelda } from './src/tournaments/addZeldaCommand.js';
import { handleStatsLookup, handleStatsQuestion } from './src/stats/statsHandler.js';
import { handleFrameDataLookup, handleFrameDataQuestion } from './src/stats/frameDataHelper.js';
import { handleCleanup } from './src/messages/cleanupHandler.js';
import { handleModHelp } from './src/messages/modHelpHandler.js';
import { handleDocs, handleFaq, handleAliases, INFO_EMBED_COLOR } from './src/messages/faqAndAliasHandler.js';
import { handleAddAlias } from './src/messages/addAliasCommand.js';
import { getCanonicalCharacterThreads } from './src/matchups/characterAliases.js';
import { setClient } from './src/shared/discordClient.js';

dotenv.config();

// App-owned log file for !logs: create and mirror stdout/stderr when LOG_PATH is unset
if (!process.env.LOG_PATH) {
    process.env.LOG_PATH = path.join(process.cwd(), 'logs', 'web.stdout.log');
    try {
        fs.mkdirSync(path.dirname(process.env.LOG_PATH), { recursive: true });
        const logStream = fs.createWriteStream(process.env.LOG_PATH, { flags: 'a' });
        logStream.write(`\n[${new Date().toISOString()}] process started\n`);
        const tee = (original, stream) => function (chunk, encoding, cb) {
            if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
            stream.write(chunk, encoding, () => {});
            return original(chunk, encoding, cb);
        };
        process.stdout.write = tee(process.stdout.write.bind(process.stdout), logStream);
        process.stderr.write = tee(process.stderr.write.bind(process.stderr), logStream);
    } catch (err) {
        console.warn('[startup] Could not create app log file:', err?.message || err);
    }
}

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
    } catch (err) {
        console.warn('[startup] S3 sync skipped or failed:', err?.message || err);
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

    // Diagnostic: log when message has no guild (DM) so we can see if Discord sends the event at all
    if (!message.guild) {
        const ch = message.channel;
        console.log(`[messageCreate] no guild | channelId=${ch?.id} type=${ch?.type} isDMBased=${typeof ch?.isDMBased === 'function' ? ch.isDMBased() : 'N/A'} content=${(message.content || '').slice(0, 40)}`);
    }
    // DMs: isDMBased() for full/partial DM channels, or no guild (fallback) 
    // (doesn't work)
    // const isDM = message.channel?.isDMBased?.() || !message.guild;
    // if (isDM) {
    //     console.log(`📩 DM from ${message.author.tag}: ${(message.content || '').slice(0, 80)}`);
    //     try {
    //         await handleDMMessage(message);
    //     } catch (err) {
    //         console.error('[DM] handleDMMessage error:', err);
    //         try {
    //             await message.reply('Something went wrong. Try again or use !docs for help.').catch(() => {});
    //         } catch (_) {}
    //     }
    //     return;
    // }

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
    const isGtCommand = message.content.toLowerCase().startsWith("!gt ");
    const isSlCommand = message.content.toLowerCase() === "!sl";

    if (isAskNaviChannel) {
        const adminId = process.env.ADMIN_DISCORD_ID || '596207448935628812';
        if (message.author.id === adminId) return;

        // Allow replies to the bot
        if (message.reference?.messageId) {
            try {
                const repliedMessage = await message.channel.messages.fetch(message.reference.messageId);
                if (repliedMessage.author.id === client.user.id) return;
            } catch (error) {
                console.error("Error checking reply target:", error);
            }
        }

        // Allow MU commands, FDQ, GT, and SL only
        if (!isMuCommand && !isFdqCommand && !isGtCommand && !isSlCommand) {
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
    if (message.channel?.type === ChannelType.DM) return;

    // ===== TEST SCHEDULER =====
    if (message.content.toLowerCase() === '!ts') {
        const hasAuthorizedRole = message.member?.roles?.cache?.some(
            r => r.name === 'Moderators' || r.name === 'Legend'
        );
        const isAdmin = message.author.id === (process.env.ADMIN_DISCORD_ID || '596207448935628812');

        if (!hasAuthorizedRole && !isAdmin) {
            return message.reply("❌ Only Moderators or Legend members can run this command.");
        }

        try {
            await message.reply("Testing notifications...");
            await checkTodaysTournaments(client);
            await message.channel.send("✅ Test notification sent to audit-logs.");
        } catch (err) {
            console.error('[!ts] Error:', err);
            await message.reply("❌ Failed to run test: " + err.message);
        }
        return;
    }

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
    const isCanonicalCommand = message.content.toLowerCase() === "!canonical";
    const isAddAliasCommand = message.content.toLowerCase().startsWith("!add-a ");
    const isModHelpCommand = message.content.toLowerCase() === "!modhelp";
    const isSlCommand = message.content.toLowerCase() === "!sl";
    const isLogsCommand = message.content.toLowerCase() === "!logs";

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

    // Add alias: Moderators + Legend only (updates S3, refreshes cache)
    if (isAddAliasCommand) {
        await handleAddAlias(message);
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

    // Mod help: Moderators + Legend only
    if (isModHelpCommand) {
        if (!hasAuthorizedRole) {
            await message.reply("❌ Only Moderators or Legend members can run this command.");
            return;
        }
        await handleModHelp(message);
        return;
    }

    // Logs: Moderators + Legend only
    if (isLogsCommand) {
        if (!hasAuthorizedRole) {
            await message.reply("❌ Only Moderators or Legend members can run this command.");
            return;
        }
        const { handleGetLogs } = await import('./src/messages/logHandler.js');
        return handleGetLogs(message);
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

    if (isSlCommand) {
        const baseUrl = (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 8080}`).replace(/\/$/, '');
        const embeds = [
            new EmbedBuilder()
                .setColor(INFO_EMBED_COLOR)
                .setTitle("Stage List (NA)")
                .setImage(`${baseUrl}/assets/na.png`),
            new EmbedBuilder()
                .setColor(INFO_EMBED_COLOR)
                .setTitle("Stage List (EU)")
                .setImage(`${baseUrl}/assets/eu.png`),
        ];
        await message.reply({ embeds });
        return;
    }

    // ===== CANONICAL CHARACTER THREADS (anyone — reference for character names) =====
    if (isCanonicalCommand) {
        try {
            const list = await getCanonicalCharacterThreads();
            const title = "Canonical character threads";
            const body = list.length
                ? list.map(s => `• ${s}`).join("\n")
                : "_No list yet.._";
            const description = body.length > 4096
                ? body.slice(0, 4080) + "\n\n_…truncated_"
                : body;
            const embed = new EmbedBuilder()
                .setColor(INFO_EMBED_COLOR)
                .setTitle(title)
                .setDescription(description)
                .setFooter({ text: `Source: S3 (${list.length} threads).` });
            await message.reply({ embeds: [embed] });
        } catch (err) {
            console.error("[!canonical]", err);
            await message.reply("❌ Failed to load canonical list: " + (err.message || String(err)));
        }
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
        if (!hasAuthorizedRole) {
            await message.reply("❌ Only Moderators or Legend members can run this command.");
            return;
        }
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

    // ===== GENERAL TIPS =====
    if (message.content.toLowerCase().startsWith("!gt ")) {
        await handleGeneralTips(message);
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

            // Post one embed per tournament
            for (const tournament of tournaments) {
                const embed = buildTournamentEmbed(tournament);
                await message.channel.send({ embeds: [embed] });
            }
        } catch (error) {
            console.error("Error checking tournaments:", error);
            await message.reply(`❌ Error checking tournaments: ${error.message}`);
        }
        return;
    }
});
