import {Client, GatewayIntentBits } from "discord.js";
import dotenv from 'dotenv';
import fs from 'fs';
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

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    
    if (message.content.toLowerCase() === "!export falco") {
        const guild = message.guild;
        const channel = guild.channels.cache.find(ch => ch.name === "falco");
        
        if (!channel) {
            await message.reply("❌ Channel 'falco' not found!");
            return;
        }
        
        try {
            await message.reply("⏳ Exporting messages from #falco...");
            
            const messages = [];
            let lastMessageId;
            
            while (true) {
                const options = { limit: 100 };
                if (lastMessageId) options.before = lastMessageId;
                
                const fetched = await channel.messages.fetch(options);
                if (fetched.size === 0) break;
                
                fetched.forEach(msg => {
                    messages.push({
                        author: msg.author.username,
                        authorId: msg.author.id,
                        content: msg.content,
                        timestamp: msg.createdAt.toISOString(),
                        messageId: msg.id
                    });
                });
                
                lastMessageId = fetched.last().id;
            }
            
            const jsonData = JSON.stringify(messages.reverse(), null, 2);
            fs.writeFileSync('falco_messages.json', jsonData);
            
            await message.reply(`✅ Exported ${messages.length} messages to falco_messages.json`);
            console.log(`✅ Exported ${messages.length} messages from #falco`);
        } catch (error) {
            console.error(error);
            await message.reply("❌ Error exporting messages: " + error.message);
        }
    }
});