import { Client, GatewayIntentBits } from "discord.js";
import express from 'express';
import dotenv from 'dotenv';

// Import handlers
import { handleExportFalco, handleExportMatchups } from './src/export/exportHandler.js';
import { handleMatchupNotes, handleMuQuestion, handleRefinement } from './src/matchups/matchupHandler.js';
import { handleShouldHave, handleArenaIsUp, followupResponses, lanWarningResponses } from './src/messages/messageHandlers.js';
import { initializeScheduler } from './src/shared/scheduler.js';

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
        message.content.toLowerCase().startsWith("!mu-question");

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

    // ===== MATCH-UP NOTES =====
    if (message.content.toLowerCase().startsWith("!match-up-notes")) {
        await handleMatchupNotes(message);
        return;
    }
});
