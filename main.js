import {Client, GatewayIntentBits } from "discord.js";
import dotenv from 'dotenv';
dotenv.config();
const DISCORD_TOKEN = process.env.DISCORD_TOKEN || '';

const client = new Client({ intents: [
GatewayIntentBits.Guilds,
GatewayIntentBits.GuildMessages,
GatewayIntentBits.MessageContent,
GatewayIntentBits.DirectMessages
] });

client.login(DISCORD_TOKEN);

client.on("clientReady", () => {
    console.log(`✅ Bot logged in as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    console.log(message, "message");
    console.log(`📨 Message received from ${message.author.tag} in #${message.channel.name}: ${message.content}`);

    const match = message.content.match(/\bi should have\b/i) ||  message.content.match(/\byou should have\b/i);
    if (!match) return;

    const after = message.content.slice(match.index + match[0].length).trim();
    const tail = after ? ` ${after}` : "";

    await message.reply(
        `<:6symbolnavi:1341400385709019138> Hey Listen ${message.author}! Remember to say, you *could* have${tail}! Coulds make us feel empowered and remind us we're all still learning. <:6symbolnavi:1341400385709019138>`
    );
});