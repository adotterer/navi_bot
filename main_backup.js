import {Client, GatewayIntentBits, AttachmentBuilder } from "discord.js";
import express from 'express';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();
const DISCORD_TOKEN = process.env.DISCORD_TOKEN || '';

// Express server setup
const app = express();
const PORT = process.env.PORT || 8080;

app.use('/exports', express.static('.'));
app.get('/', (req, res) => {
    res.send('Navi Bot is running! 🧚');
});

app.listen(PORT, () => {
    console.log(`🌐 HTTP server running on port ${PORT}`);
});

// S3 client setup
const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'us-west-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

// Helper function to upload file to S3
async function uploadToS3(filename, fileContent) {
    const command = new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: filename,
        Body: fileContent,
        ContentType: 'application/json'
    });
    
    await s3Client.send(command);
    const url = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${filename}`;
    return url;
}

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

// Helper function to fetch all messages from a channel
async function fetchAllMessages(channel) {
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
    
    return messages.reverse();
}

// Creative followup responses
const followupResponses = [
    "Coulds make us feel empowered and remind us we're all still learning. 🎮",
    "The word 'could' reminds us we had options—let's focus on the next play! 💫",
    "'Could' is about growth, not regret. You've got this next time! 🚀",
    "Remember, 'could' means you understand what should happen next time. That's progress! ✨",
    "Swap 'should' for 'could' and you'll feel way better about any situation. 🎯",
    "Using 'could' takes the pressure off and keeps the fun going! 🎪",
    "Princess Zelda herself will be notified of this transgression immediately. 👑",
    "Even Link wouldn't say 'should'—have 🤐",
    "The Great Deku Tree is disappointed in your use of 'should'. Plant a 'could' instead! 🌳",
];

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (message.channel.name === "real-talk") return;
    console.log(message, "message");
    console.log(`📨 Message received from ${message.author.tag} in #${message.channel.name}: ${message.content}`);

    // Match variations: "I/you/he/she/they should have" or "should have" in general
    const match = message.content.match(/\b(i|you|he|she|they|we)\s+should\s+have\b/i) || 
                  message.content.match(/\bshould\s+have\b/i);
    if (!match) return;

    const after = message.content.slice(match.index + match[0].length).trim();
    const tail = after ? ` ${after}` : "";
    
    // Pick a random followup response
    const followup = followupResponses[Math.floor(Math.random() * followupResponses.length)];

    await message.reply(
        `<:6symbolnavi:1341400385709019138> Hey Listen ${message.author}! Remember to say, you *could* have${tail}! ${followup} <:6symbolnavi:1341400385709019138>`
    );
    await message.channel.send(`-# <@596207448935628812> has been summoned - prepare yourself!`);

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
            
            const messages = await fetchAllMessages(channel);
            
            const jsonData = JSON.stringify(messages, null, 2);
            fs.writeFileSync('falco_messages.json', jsonData);
            
            await message.reply(`✅ Exported ${messages.length} messages to falco_messages.json`);
            console.log(`✅ Exported ${messages.length} messages from #falco`);
        } catch (error) {
            console.error(error);
            await message.reply("❌ Error exporting messages: " + error.message);
        }
    }
    
    if (message.content.toLowerCase() === "!export matchups") {
        const guild = message.guild;
        const categoryNames = ["Match Ups (B-L)", "Match Ups (M-Z)"];
        
        try {
            await message.reply("⏳ Exporting all Match Ups channels...");
            
            let totalChannels = 0;
            let totalMessages = 0;
            const exportedFiles = [];
            
            for (const categoryName of categoryNames) {
                const category = guild.channels.cache.find(ch => ch.children && ch.name === categoryName);
                
                if (!category) {
                    console.log(`⚠️  Category '${categoryName}' not found`);
                    continue;
                }
                
                // Get all text channels in this category
                const channels = category.children.cache.filter(ch => ch.isTextBased());
                
                for (const [, channel] of channels) {
                    try {
                        console.log(`📥 Exporting #${channel.name}...`);
                        const messages = await fetchAllMessages(channel);
                        
                        const jsonData = JSON.stringify(messages, null, 2);
                        const filename = `${channel.name}.json`;
                        fs.writeFileSync(filename, jsonData);
                        
                        // Upload to S3
                        const s3Url = await uploadToS3(filename, jsonData);
                        console.log(`☁️  Uploaded to S3: ${s3Url}`);
                        
                        exportedFiles.push(`[${channel.name}](${s3Url}) - ${messages.length} messages`);
                        totalMessages += messages.length;
                        totalChannels++;
                        
                        console.log(`✅ Exported #${channel.name}: ${messages.length} messages`);
                    } catch (error) {
                        console.error(`❌ Error exporting #${channel.name}:`, error.message);
                    }
                }
            }
            
            await message.reply(
                `✅ Exported ${totalChannels} channels with ${totalMessages} total messages!\n\n` +
                exportedFiles.slice(0, 10).join('\n') +
                (exportedFiles.length > 10 ? `\n... and ${exportedFiles.length - 10} more` : '')
            );
            console.log(`✅ Completed: ${totalChannels} channels, ${totalMessages} total messages`);
        } catch (error) {
            console.error(error);
            await message.reply("❌ Error exporting Match Ups channels: " + error.message);
        }
    }
});