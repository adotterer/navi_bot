import { Client, GatewayIntentBits, ChannelType, EmbedBuilder, SlashCommandBuilder, REST, Routes } from "discord.js";
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
import { handleAddZelda, handleListZelda } from './src/tournaments/addZeldaCommand.js';
import { handleStatsLookup, handleStatsQuestion } from './src/stats/statsHandler.js';
import { handleFrameDataLookup, handleFrameDataQuestion } from './src/stats/frameDataHelper.js';
import { handleCleanup } from './src/messages/cleanupHandler.js';
import { handleModHelp } from './src/messages/modHelpHandler.js';
import { handleDocs, handleFaq, handleAliases, INFO_EMBED_COLOR } from './src/messages/faqAndAliasHandler.js';
import { handleAddAlias } from './src/messages/addAliasCommand.js';
import { getCanonicalCharacterThreads } from './src/matchups/characterAliases.js';
import { setClient } from './src/shared/discordClient.js';
import { isAllowedInAskNavi } from './src/shared/askNaviAllowlist.js';
import { handleCoinFlip } from './src/bans/coinflipHandler.js';
import { handleResult, handleResultConfirm, handleResultDispute, handleResultReportComponent } from './src/bans/resultHandler.js';
import { handleBan, handleBanComponent } from './src/bans/banHandler.js';
import { handleCancelMatch } from './src/bans/cancelMatchHandler.js';
import { handleAnotherMatch, handleEndSession } from './src/bans/resultHandler.js';
import { handleEnd } from './src/bans/endHandler.js';
import { handleCoinFlipFormat } from './src/bans/coinflipHandler.js';
import { handleFindMatch, handleFindMatchFormat, handleFindMatchAccept, handleCancelFindMatch, handleFindMatchCancel } from './src/bans/findMatchHandler.js';
import { cleanupExpiredSessions } from './src/bans/banSessionStore.js';

dotenv.config();

// Startup check: ensure allowlist recognizes key commands (catches drift from /admin/commands)
const ALLOWLIST_SAMPLES = ['!q foo', '!sq bar', '!fd mario fair', '!mu falco', '!fdq x', '!sl', '!docs'];
const bad = ALLOWLIST_SAMPLES.filter((s) => !isAllowedInAskNavi(s));
if (bad.length) {
    console.error(`[startup] ask-navi allowlist missing: ${bad.join(', ')}`);
}

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

client.on("clientReady", async () => {
    console.log(`✅ Bot logged in as ${client.user.tag}`);

    // Register slash commands (guild-specific for instant updates)
    const guildId = process.env.GUILD_ID;
    if (guildId) {
        try {
            const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
            const commands = [
                new SlashCommandBuilder()
                    .setName('coinflip')
                    .setDescription('Start a stage ban match with a coin flip to determine who bans first')
                    .addUserOption(opt => opt.setName('opponent').setDescription('Your opponent').setRequired(true)),
                new SlashCommandBuilder()
                    .setName('ban')
                    .setDescription('Ban or select a stage during a match')
                    .addStringOption(opt => opt.setName('stage').setDescription('Stage name or alias (e.g. sv, Smashville)').setRequired(true))
                    .addStringOption(opt => opt.setName('match_id').setDescription('Match ID from /coinflip (see embed footer or DM)').setRequired(false)),
                new SlashCommandBuilder()
                    .setName('result')
                    .setDescription('Report who won a game (loser must confirm; use after Game 1 or Game 2+)')
                    .addUserOption(opt => opt.setName('winner').setDescription('The player who won the game').setRequired(true))
                    .addStringOption(opt => opt.setName('match_id').setDescription('Match ID (optional if you have one active match)').setRequired(false)),
                new SlashCommandBuilder()
                    .setName('cancel-match')
                    .setDescription('Cancel your active stage ban match (either player can cancel)')
                    .addStringOption(opt => opt.setName('match_id').setDescription('Match ID (optional; cancels your current match if omitted)').setRequired(false)),
                new SlashCommandBuilder()
                    .setName('end')
                    .setDescription('End the stage ban session (either player can end; use after a set or when done)')
                    .addStringOption(opt => opt.setName('match_id').setDescription('Match ID (optional if you have one active match)').setRequired(false)),
                new SlashCommandBuilder()
                    .setName('bo3')
                    .setDescription('Start a Best of 3 (first to 2 wins) stage ban match')
                    .addUserOption(opt => opt.setName('opponent').setDescription('Your opponent').setRequired(true)),
                new SlashCommandBuilder()
                    .setName('bo5')
                    .setDescription('Start a Best of 5 (first to 3 wins) stage ban match')
                    .addUserOption(opt => opt.setName('opponent').setDescription('Your opponent').setRequired(true)),
                new SlashCommandBuilder()
                    .setName('ft5')
                    .setDescription('Start a First to 5 stage ban match')
                    .addUserOption(opt => opt.setName('opponent').setDescription('Your opponent').setRequired(true)),
                new SlashCommandBuilder()
                    .setName('findmatch')
                    .setDescription('Post find-match: pings tier role; you pick BO3/BO5; anyone can Accept'),
                new SlashCommandBuilder()
                    .setName('acolyte')
                    .setDescription('Ping @acolyte and start find-match: you pick BO3/BO5; anyone can Accept Match'),
                new SlashCommandBuilder()
                    .setName('evoker')
                    .setDescription('Ping @evoker and start find-match: you pick BO3/BO5; anyone can Accept Match'),
                new SlashCommandBuilder()
                    .setName('conjurer')
                    .setDescription('Ping @conjurer and start find-match: you pick BO3/BO5; anyone can Accept Match'),
                new SlashCommandBuilder()
                    .setName('sorcerer')
                    .setDescription('Ping @sorcerer and start find-match: you pick BO3/BO5; anyone can Accept Match'),
                new SlashCommandBuilder()
                    .setName('arch-mage')
                    .setDescription('Ping @arch-mage and start find-match: you pick BO3/BO5; anyone can Accept Match'),
                new SlashCommandBuilder()
                    .setName('3fr')
                    .setDescription('Ping @3-Frame Mod and start find-match: you pick BO3/BO5; anyone can Accept Match'),
                new SlashCommandBuilder()
                    .setName('cancel-findmatch')
                    .setDescription('Cancel your pending find-match request (e.g. if you found a match in another tier or server)'),
            ].map(c => c.toJSON());
            await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: commands });
            console.log('✅ Slash commands registered (/coinflip, /ban, /result, /cancel-match, /end, /bo3, /bo5, /ft5, /findmatch, /acolyte, /evoker, /conjurer, /sorcerer, /arch-mage, /3fr, /cancel-findmatch)');
        } catch (err) {
            console.error('❌ Failed to register slash commands:', err);
        }
    } else {
        console.warn('⚠️ GUILD_ID not set; slash commands not registered.');
    }

    await cleanupExpiredSessions();

    // Initialize weekly export scheduler
    initializeScheduler(client);
    setClient(client);

    client.user.setPresence({
        activities: [{ name: "Use !docs, !faq, !aliases", type: 0 }],
        status: "online"
    });
});

// Slash command and component interactions
client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'coinflip') {
                await handleCoinFlip(interaction);
            } else if (interaction.commandName === 'ban') {
                await handleBan(interaction);
            } else if (interaction.commandName === 'result') {
                await handleResult(interaction);
            } else if (interaction.commandName === 'cancel-match') {
                await handleCancelMatch(interaction);
            } else if (interaction.commandName === 'end') {
                await handleEnd(interaction);
            } else if (interaction.commandName === 'bo3') {
                await handleCoinFlipFormat(interaction, 'bo3');
            } else if (interaction.commandName === 'bo5') {
                await handleCoinFlipFormat(interaction, 'bo5');
            } else if (interaction.commandName === 'ft5') {
                await handleCoinFlipFormat(interaction, 'ft5');
            } else if (interaction.commandName === 'findmatch') {
                await handleFindMatch(interaction);
            } else if (interaction.commandName === 'acolyte') {
                await handleFindMatch(interaction, { roleName: 'acolyte' });
            } else if (interaction.commandName === 'evoker') {
                await handleFindMatch(interaction, { roleName: 'evoker' });
            } else if (interaction.commandName === 'conjurer') {
                await handleFindMatch(interaction, { roleName: 'conjurer' });
            } else if (interaction.commandName === 'sorcerer') {
                await handleFindMatch(interaction, { roleName: 'sorcerer' });
            } else if (interaction.commandName === 'arch-mage') {
                await handleFindMatch(interaction, { roleName: 'arch-mage' });
            } else if (interaction.commandName === '3fr') {
                await handleFindMatch(interaction, { roleName: '3-Frame Mod' });
            } else if (interaction.commandName === 'cancel-findmatch') {
                await handleCancelFindMatch(interaction);
            }
            return;
        }
        if (interaction.isStringSelectMenu() || interaction.isButton()) {
            const customId = interaction.customId || '';
            if (customId.startsWith('ban:')) {
                await handleBanComponent(interaction);
                return;
            }
            if (customId.startsWith('result_report:')) {
                const handled = await handleResultReportComponent(interaction);
                if (handled) return;
            }
            if (customId.startsWith('result_confirm:')) {
                const handled = await handleResultConfirm(interaction);
                if (handled) return;
            }
            if (customId.startsWith('result_dispute:')) {
                const handled = await handleResultDispute(interaction);
                if (handled) return;
            }
            if (customId.startsWith('another_match:')) {
                const handled = await handleAnotherMatch(interaction);
                if (handled) return;
            }
            if (customId.startsWith('end_session:')) {
                const handled = await handleEndSession(interaction);
                if (handled) return;
            }
            if (customId.startsWith('findmatch_format:')) {
                const handled = await handleFindMatchFormat(interaction);
                if (handled) return;
            }
            if (customId.startsWith('findmatch_accept:')) {
                const handled = await handleFindMatchAccept(interaction);
                if (handled) return;
            }
            if (customId.startsWith('findmatch_cancel:')) {
                const handled = await handleFindMatchCancel(interaction);
                if (handled) return;
            }
        }
    } catch (err) {
        console.error('[interactionCreate]', interaction.commandName || interaction.customId, err);
        try {
            if (interaction.deferred) {
                await interaction.editReply({ content: '❌ An error occurred.' }).catch(() => {});
            } else {
                await interaction.reply({ content: '❌ An error occurred.', ephemeral: true }).catch(() => {});
            }
        } catch (_) {}
    }
});
// ========== MESSAGE HANDLERS ==========
//
client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    // Diagnostic: log when message has no guild (DM) so we can see if Discord sends the event at all
    if (!message.guild) {
        const ch = message.channel;
        console.log(`[messageCreate] no guild | channelId=${ch?.id} type=${ch?.type} isDMBased=${typeof ch?.isDMBased === 'function' ? ch.isDMBased() : 'N/A'} content=${(message.content || '').slice(0, 40)}`);
    }


    // Check channel name (and parent for threads, e.g. forum posts in ⭐・ask・navi™)
    const channelName = message.channel?.name?.toLowerCase() || '';
    const parentName = message.channel?.parent?.name?.toLowerCase() || '';
    const nameToCheck = channelName + ' ' + parentName;
    const normalizedChannelName = nameToCheck.replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    const isAskNaviChannel = normalizedChannelName.includes('ask') && normalizedChannelName.includes('navi');

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

        // Allow only commands from the shared allowlist (sync with /admin/commands)
        if (!isAllowedInAskNavi(message.content)) {
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

    // PASSIVE TRIGGER: "SHOULD HAVE" mentality guidance 
    if (await handleShouldHave(message, followupResponses)) return;

    // PASSIVE TRIGGER: Check for Arena is up/ready trigger
    if (await handleArenaIsUp(message, lanWarningResponses)) return;
});


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
            await checkTodaysTournaments(client, null, { useCache: false });
            await message.channel.send("✅ Test notification sent to audit-logs.");
        } catch (err) {
            console.error('[!ts] Error:', err);
            await message.reply("❌ Failed to run test: " + err.message);
        }
        return;
    }

    // Check channel name (and parent for threads, e.g. forum posts in ⭐・ask・navi™)
    const channelName = message.channel?.name?.toLowerCase() || '';
    const parentName = message.channel?.parent?.name?.toLowerCase() || '';
    const nameToCheck = channelName + ' ' + parentName;
    const normalizedChannelName = nameToCheck.replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
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
                .setImage(`${baseUrl}/assets/stage-lists/na.png`),
            new EmbedBuilder()
                .setColor(INFO_EMBED_COLOR)
                .setTitle("Stage List (EU)")
                .setImage(`${baseUrl}/assets/stage-lists/eu.png`),
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
        if (!process.env.STARTGG_AUTH_TOKEN) {
            await message.reply("❌ Start.gg API token not configured.");
            return;
        }

        try {
            await message.reply("⏳ Checking today's tournaments for Zelda players...");
            const tournaments = await checkTodaysTournaments(client, message.channel, { useCache: false });
            if (tournaments.length === 0) {
                await message.reply("❌ No Zelda players found in today's tournaments with Ultimate Singles.");
            }
            // Embeds are sent by checkTodaysTournaments when targetChannel is set
        } catch (error) {
            console.error("Error checking tournaments:", error);
            await message.reply(`❌ Error checking tournaments: ${error.message}`);
        }
        return;
    }
});
