import {Client, GatewayIntentBits, AttachmentBuilder } from "discord.js";
import express from 'express';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { GoogleGenAI} from '@google/genai';
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

// Gemini AI client setup
const genAI = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    defaultModel: process.env.GEMINI_MODEL || 'gemini-3-flash-preview'
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

// Helper function to fetch file from S3
async function fetchFromS3(filename) {
    const command = new GetObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: filename
    });
    
    const response = await s3Client.send(command);
    const str = await response.Body.transformToString();
    return JSON.parse(str);
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
    "The Triforce of wisdom demands you use the word 'could' instead! ✨",
    "The Great Deku Tree is disappointed in your use of 'should'. Plant a 'could' instead! 🌳",
];

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    const isCommand = message.content.toLowerCase().startsWith("!export") ||
        message.content.toLowerCase().startsWith("!match-up-notes");

    if (isCommand) {
        const hasModeratorRole = message.member?.roles?.cache?.some(
            role => role.name === "Moderators"
        );

        if (!hasModeratorRole) {
            await message.reply("❌ Only moderators can run this command.");
            return;
        }
    }
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
});

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    
    // Check if this is a reply to bot's match-up notes for conversational refinement
    if (message.reference) {
        try {
            const repliedMessage = await message.channel.messages.fetch(message.reference.messageId);
            
            // Check if reply is to bot's match-up notes (contains search emoji)
            if (repliedMessage.author.id === client.user.id && repliedMessage.content.includes("🔎")) {
                // Check if user has Moderators role
                const hasModeratorsRole = message.member.roles.cache.some(role => role.name === "Moderators");
                if (!hasModeratorsRole) {
                    await message.reply("❌ Only users with the Moderators role can refine match-up notes.");
                    return;
                }
                
                // Extract character name from recent messages
                const recentMessages = await message.channel.messages.fetch({ limit: 20 });
                let characterName = null;
                
                for (const msg of recentMessages.values()) {
                    if (msg.author.id === client.user.id && msg.content.includes("Analyzing match-up notes for **")) {
                        const match = msg.content.match(/Analyzing match-up notes for \*\*(.+?)\*\*/);
                        if (match) {
                            characterName = match[1];
                            break;
                        }
                    }
                }
                
                if (!characterName) {
                    await message.reply("❌ Could not determine which character's notes to refine. Please use !match-up-notes <character> to generate fresh notes.");
                    return;
                }
                
                await message.reply(`⏳ Refining match-up notes for **${characterName}** based on your feedback...`);
                
                // Fetch previous summary from replied message (handle multi-part messages)
                let previousSummary = repliedMessage.content;
                
                // Check if this is a multi-part message
                if (previousSummary.includes("**Part ")) {
                    // Fetch recent messages to find all parts
                    const allMessages = await message.channel.messages.fetch({ limit: 50 });
                    const botMessages = Array.from(allMessages.values())
                        .filter(m => m.author.id === client.user.id && m.content.includes("**Part "))
                        .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
                    
                    // Find the group of parts that includes the replied message
                    const repliedIndex = botMessages.findIndex(m => m.id === repliedMessage.id);
                    if (repliedIndex !== -1) {
                        // Collect all consecutive parts around the replied message
                        let startIndex = repliedIndex;
                        let endIndex = repliedIndex;
                        
                        // Go backwards to find Part 1
                        while (startIndex > 0 && botMessages[startIndex - 1].content.includes("**Part ")) {
                            startIndex--;
                        }
                        
                        // Go forwards to find the last part
                        while (endIndex < botMessages.length - 1 && botMessages[endIndex + 1].content.includes("**Part ")) {
                            endIndex++;
                        }
                        
                        // Combine all parts, removing the "**Part X:**" headers
                        previousSummary = botMessages
                            .slice(startIndex, endIndex + 1)
                            .map(m => m.content.replace(/\*\*Part \d+:\*\*\n/, ''))
                            .join('');
                    }
                }
                
                // Fetch messages from character's channel
                const guild = message.guild;
                const channel = guild.channels.cache.find(ch => ch.name === characterName.toLowerCase());
                
                if (!channel) {
                    await message.reply(`❌ Channel for ${characterName} not found!`);
                    return;
                }
                
                const channelMessages = await fetchAllMessages(channel);
                
                // Build refinement prompt
                const userFeedback = message.content;
                const refinementPrompt = `You previously generated this match-up summary:

${previousSummary}

The user has provided this feedback for refinement:
"${userFeedback}"

Please refine the match-up notes based on the user's feedback while maintaining the same format and structure. Use the original Discord messages below as additional context if needed.

IMPORTANT RULES:
1. Prioritize information from users named "katyparry" (case insensitive) - their insights are the most valuable
2. Focus on neutral game interactions, advantage state, disadvantage state, and edgeguarding
3. IGNORE jab combo discussions unless specifically relevant to a unique interaction
4. When percentages are mentioned with specific interactions, include them (e.g., "up-tilt kills at 130%")
5. Condense overly verbose or repetitive points into clear, actionable insights
6. Skip generic advice that applies to all characters
7. Highlight character-specific tools, counterplay, and matchup dynamics
8. Include stage considerations if mentioned
9. Mention DI, SDI, or tech options when relevant to interactions
10. If users discuss specific moves or setups, summarize the key takeaways
11. Keep the summary concise but comprehensive - aim for clarity over length
12. Maintain the emoji structure and formatting from the original summary
13. Address the user's specific feedback while preserving other valuable information

Original Discord Messages:
${channelMessages.map(m => `[${m.author}]: ${m.content}`).join('\n\n')}`;

                // Generate refined content
                const response = await genAI.models.generateContent({
                    model: process.env.GEMINI_MODEL || 'gemini-3-flash-preview',
                    contents: refinementPrompt
                });
                const refinedSummary = response.text;
                
                // Post refined summary (chunk if needed)
                const maxLength = 2000;
                if (refinedSummary.length <= maxLength) {
                    await message.reply(refinedSummary);
                } else {
                    const lines = refinedSummary.split('\n');
                    let currentChunk = '';
                    let chunkNumber = 1;
                    
                    for (const line of lines) {
                        if ((currentChunk + line + '\n').length > maxLength) {
                            await message.channel.send(`**Part ${chunkNumber}:**\n${currentChunk}`);
                            currentChunk = line + '\n';
                            chunkNumber++;
                        } else {
                            currentChunk += line + '\n';
                        }
                    }
                    
                    if (currentChunk.trim()) {
                        await message.channel.send(`**Part ${chunkNumber}:**\n${currentChunk}`);
                    }
                }
                
                console.log(`✅ Refined match-up notes for ${characterName} based on user feedback`);
                return;
            }
        } catch (error) {
            console.error("Error in conversational refinement:", error);
            // Continue to other command handlers if this fails
        }
    }
    
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
    
    if (message.content.toLowerCase().startsWith("!match-up-notes")) {
        const args = message.content.split(" ");
        if (args.length < 2) {
            await message.reply("❌ Please specify a character! Example: `!match-up-notes falco`");
            return;
        }
        
        const character = args[1].toLowerCase();
        const filename = `${character}.json`;
        
        try {
            await message.reply(`⏳ Analyzing match-up notes for **${character}**...`);
            
            // Fetch messages from S3
            const messages = await fetchFromS3(filename);
            
            if (!messages || messages.length === 0) {
                await message.reply(`❌ No messages found for ${character}. Have you exported this character yet?`);
                return;
            }
            
            // Prepare messages for AI, prioritizing katyparry's messages
            const katyparryMessages = messages.filter(msg => msg.author === 'katyparry');
            const otherMessages = messages.filter(msg => msg.author !== 'katyparry');
            
            const prompt = `You are an expert Super Smash Bros. Ultimate analyst. Below are Discord messages discussing the Zelda vs ${character} matchup.

IMPORTANT: Messages from user 'katyparry' are the most authoritative and should be heavily weighted in your summary.

=== PRIORITY MESSAGES (from katyparry) ===
${katyparryMessages.map(msg => `${msg.author}: ${msg.content}`).join('\n\n')}

=== OTHER COMMUNITY MESSAGES ===
${otherMessages.map(msg => `${msg.author}: ${msg.content}`).join('\n\n')}

=== YOUR TASK ===
Create a comprehensive matchup summary following this format:

**🔎 | GENERAL GAMEPLAN**
- Overview of the matchup dynamics
- Key strengths and weaknesses for Zelda
- Important neutral strategies

**🔎 | MATCH UP BASICS**
- List key strategies, frame data, punish options, and general gameplan
- Use bold text for important moves/concepts
- Be specific with frame data when mentioned
- Include any critical tips or warnings

**🚨 | STAGE BANS** (ONLY include this section if stages are specifically discussed in the messages)
- List recommended stage bans
- Include reasoning in italics like *[reason]*

**Phantom in Neutral?**
- Phantom In Neutral? NO <:7blizzetta:1337261523269058731> or YES <:7blizzetta:1337261523269058731> 

**D-Tilt Safe on Shield**
- Spaced: safe
- Not spaced: Bair and grab


Rules:
1. Base everything on the actual messages provided
2. Do NOT make up information not mentioned in the messages
3. Prioritize information from katyparry
4. Only include Stage Bans section if stages are specifically mentioned
5. Use Discord markdown formatting (**, *, \\n for line breaks)
6. Be concise but thorough
7. Match the tone and style of the example provided
8. When there are more messages, or longer messages with verbose detail, please condense the information to keep the summary focused and readable. 
9. The goal is to have a summary could briefly read 5 minutes before a match and get all critical info without being overwhelmed.
10. Ignore overly granular, single-move, percentage-based interactions (e.g., specific % windows for one move). Summarize those as general principles instead.
11. Look specifically for anything about if Zelda can use the Phantom in neutral against this character, and include that in the summary. If it is not mentioned, do not include it.
12. Do not mention jab combos.
13. Include if D-Tilt is Safe on Shield or not.


Generate the matchup summary now:`;
            
            const response = await genAI.models.generateContent({
                model: process.env.GEMINI_MODEL || 'gemini-3-flash-preview',
                contents: prompt
            });
            const summary = response.text;
            
            // Send the summary (Discord has a 2000 character limit, so split if needed)
            if (summary.length <= 2000) {
                await message.reply(summary);
            } else {
                // Split into chunks
                const chunks = summary.match(/[\s\S]{1,2000}/g) || [];
                for (const chunk of chunks) {
                    await message.channel.send(chunk);
                }
            }
            
            console.log(`✅ Generated match-up notes for ${character}`);
        } catch (error) {
            console.error(error);
            if (error.name === 'NoSuchKey' || error.Code === 'NoSuchKey') {
                await message.reply(`❌ File ${filename} not found in S3. Have you exported this character yet?`);
            } else {
                await message.reply("❌ Error generating match-up notes: " + error.message);
            }
        }
    }
});
