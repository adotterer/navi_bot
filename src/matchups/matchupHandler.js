import { GoogleGenAI } from '@google/genai';
import { fetchFromS3, isModelOverloaded, fetchAllMessages } from '../shared/s3Helper.js';
import { buildCharacterAliasMap, resolveCharacterFromText } from './characterAliases.js';

const genAI = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    defaultModel: process.env.GEMINI_MODEL || 'gemini-3-flash-preview'
});

export async function handleMatchupNotes(message) {
    const args = message.content.split(" ");
    if (args.length < 2) {
        await message.reply("❌ Please specify a character! Example: `!mu-notes falco`");
        return;
    }
    
    const character = args[1].toLowerCase();
    const filename = `${character}.json`;
    
    try {
        await message.reply(`⏳ Analyzing match-up notes for **${character}**...`);
        
        const messages = await fetchFromS3(filename);
        
        if (!messages || messages.length === 0) {
            await message.reply(`❌ No messages found for ${character}. Have you exported this character yet?`);
            return;
        }
        
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
        
        if (summary.length <= 2000) {
            await message.reply(summary);
        } else {
            const chunks = summary.match(/[\s\S]{1,2000}/g) || [];
            for (const chunk of chunks) {
                await message.channel.send(chunk);
            }
        }
        
        // Tag katyparry for verification
        await message.channel.send(`<@596207448935628812> Please verify the above matchup notes are accurate! 🔎`);
        
        console.log(`✅ Generated match-up notes for ${character}`);
    } catch (error) {
        console.error(error);
        if (isModelOverloaded(error)) {
            await message.reply("⚠️ The model is overloaded right now. I can't generate notes yet.");
            setTimeout(() => {
                message.reply("Would you like to retry? Reply with **retry** to try again.").catch(console.error);
            }, 10000);
            return;
        }
        if (error.name === 'NoSuchKey' || error.Code === 'NoSuchKey') {
            await message.reply(`❌ File ${filename} not found in S3. Have you exported this character yet?`);
        } else {
            await message.reply("❌ Error generating match-up notes: " + error.message);
        }
    }
}

export async function handleMuQuestion(message) {
    const rawQuestion = message.content.replace(/^!mu-question\s*/i, "").trim();

    if (!rawQuestion) {
        await message.reply("❌ Please include a question. Example: `!mu-question How do I deal with Peach's turnips?`");
        return;
    }

    let characterSlug;
    let displayName;

    try {
        const aliasMap = buildCharacterAliasMap(message.guild);
        const characterMatch = resolveCharacterFromText(rawQuestion, aliasMap);

        if (!characterMatch) {
            await message.reply("❌ I couldn't detect a character in your question. Please mention the character name (nicknames like 'palu' or 'pika' are ok). Example: `!mu-question What should Zelda do versus Mario's fireball?`");
            return;
        }

        characterSlug = characterMatch.slug;
        displayName = characterSlug.replace("|", "/");
        const filename = `${characterSlug}.json`;

        await message.reply(`⏳ Searching matchup notes for **${displayName}**...`);

        const messages = await fetchFromS3(filename);

        if (!messages || messages.length === 0) {
            await message.reply(`❌ No messages found for ${displayName}. Have you exported this character yet?`);
            return;
        }

        const katyparryMessages = messages.filter(msg => msg.author === 'katyparry');
        const otherMessages = messages.filter(msg => msg.author !== 'katyparry');

        const prompt = `You are an expert Super Smash Bros. Ultimate analyst. The user has a specific matchup question about Zelda vs ${displayName}.

QUESTION:
"${rawQuestion}"

IMPORTANT: Messages from user 'katyparry' are the most authoritative and should be heavily weighted in your answer.

=== PRIORITY MESSAGES (from katyparry) ===
${katyparryMessages.map(msg => `${msg.author}: ${msg.content}`).join('\n\n')}

=== OTHER COMMUNITY MESSAGES ===
${otherMessages.map(msg => `${msg.author}: ${msg.content}`).join('\n\n')}

RULES:
1. Answer only using information from the messages above
2. If the messages don't address the question, say you couldn't find it
3. Be concise and actionable
4. Do not mention jab combos
5. Don't provide information that doesn't relate to the original question.

Provide the best possible answer now:`;

        const response = await genAI.models.generateContent({
            model: process.env.GEMINI_MODEL || 'gemini-3-flash-preview',
            contents: prompt
        });

        const answer = response.text;

        if (answer.length <= 2000) {
            await message.reply(answer);
        } else {
            const chunks = answer.match(/[\s\S]{1,2000}/g) || [];
            for (const chunk of chunks) {
                await message.channel.send(chunk);
            }
        }

        // Tag katyparry for verification
        await message.channel.send(`<@596207448935628812> Please verify the above answer is accurate! 🔎`);

        console.log(`✅ Answered MU question for ${displayName}`);
    } catch (error) {
        if (isModelOverloaded(error)) {
            await message.reply("⚠️ The model is overloaded right now. I can't answer yet.");
            setTimeout(() => {
                message.reply("Would you like to retry? Reply with **retry** to try again.").catch(console.error);
            }, 10000);
            return;
        }
        console.error(error);
        if (error.name === 'NoSuchKey' || error.Code === 'NoSuchKey') {
            await message.reply(`❌ File ${(characterSlug || "character")}.json not found in S3. Have you exported this character yet?`);
        } else {
            await message.reply("❌ Error answering question: " + error.message);
        }
    }
}

export async function handleRefinement(message, repliedMessage, client) {
    try {
        const hasModeratorsRole = message.member.roles.cache.some(role => role.name === "Moderators");
        if (!hasModeratorsRole) {
            await message.reply("❌ Only users with the Moderators role can refine match-up notes.");
            return;
        }
        
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
            await message.reply("❌ Could not determine which character's notes to refine. Please use !mu-notes <character> to generate fresh notes.");
            return;
        }
        
        await message.reply(`⏳ Refining match-up notes for **${characterName}** based on your feedback...`);
        
        let previousSummary = repliedMessage.content;
        
        if (previousSummary.includes("**Part ")) {
            const allMessages = await message.channel.messages.fetch({ limit: 50 });
            const botMessages = Array.from(allMessages.values())
                .filter(m => m.author.id === client.user.id && m.content.includes("**Part "))
                .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
            
            const repliedIndex = botMessages.findIndex(m => m.id === repliedMessage.id);
            if (repliedIndex !== -1) {
                let startIndex = repliedIndex;
                let endIndex = repliedIndex;
                
                while (startIndex > 0 && botMessages[startIndex - 1].content.includes("**Part ")) {
                    startIndex--;
                }
                
                while (endIndex < botMessages.length - 1 && botMessages[endIndex + 1].content.includes("**Part ")) {
                    endIndex++;
                }
                
                previousSummary = botMessages
                    .slice(startIndex, endIndex + 1)
                    .map(m => m.content.replace(/\*\*Part \d+:\*\*\n/, ''))
                    .join('');
            }
        }
        
        const guild = message.guild;
        const channel = guild.channels.cache.find(ch => ch.name === characterName.toLowerCase());
        
        if (!channel) {
            await message.reply(`❌ Channel for ${characterName} not found!`);
            return;
        }
        
        const channelMessages = await fetchAllMessages(channel);
        
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

        const response = await genAI.models.generateContent({
            model: process.env.GEMINI_MODEL || 'gemini-3-flash-preview',
            contents: refinementPrompt
        });
        const refinedSummary = response.text;
        
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
    } catch (error) {
        if (isModelOverloaded(error)) {
            await message.reply("⚠️ The model is overloaded right now. I can't generate a refined summary yet.");
            setTimeout(() => {
                message.reply("Would you like to retry? Reply with **retry** to try again.").catch(console.error);
            }, 10000);
            return;
        }
        console.error("Error in conversational refinement:", error);
    }
}
