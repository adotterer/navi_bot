import { GoogleGenAI } from '@google/genai';
import { fetchFromS3, isModelOverloaded, fetchAllMessages } from '../shared/s3Helper.js';
import { getPrompt } from '../shared/promptLoader.js';
import { buildCharacterAliasMap, resolveCharacterFromText, relatedCharacters } from './characterAliases.js';
import { sendSplitMessage, createSplitEmbeds } from '../shared/messageSplitter.js';
import { SUMMARY_DISCLAIMER } from '../shared/responseNotices.js';
import { EmbedBuilder } from 'discord.js';
import { buildMatchupReferenceData } from '../shared/promptDataHelper.js';
import { INFO_EMBED_COLOR } from '../messages/faqAndAliasHandler.js';
const genAI = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    defaultModel: process.env.GEMINI_MODEL || 'gemini-3-flash-preview'
});

function formatMessageForPrompt(msg) {
    let output = `${msg.author}: ${msg.content}`;

    if (msg.replyingToContent) {
        const replyMeta = [];
        if (msg.replyingToAuthor) replyMeta.push(msg.replyingToAuthor);
        if (msg.replyingToTimestamp) replyMeta.push(msg.replyingToTimestamp);
        const replyLabel = replyMeta.length > 0 ? replyMeta.join(" | ") : "unknown";
        output += `\nReplying to ${replyLabel}: ${msg.replyingToContent}`;
    }

    return output;
}

/**
 * Fetches matchup data for a character and all related characters.
 * @param {string} characterSlug - The main character slug
 * @returns {Promise<{messages: Array, characterList: string}>} Combined messages and character list
 */
async function fetchMultiCharacterData(characterSlug) {
    const related = relatedCharacters[characterSlug] || [];
    const allCharacters = [characterSlug, ...related];

    // Fetch all character data in parallel
    const dataPromises = allCharacters.map(async (char) => {
        try {
            // Normalize the filename: remove spaces and convert pipe variants to Unicode vertical line
            let normalizedChar = char.replace(/\s+/g, '').toLowerCase();
            // Convert regular pipes and other pipe variants to the Unicode vertical line that S3 uses
            normalizedChar = normalizedChar.replace(/[|︱｜]/g, '︱');
            const filename = `${normalizedChar}.json`;
            console.log(`Fetching: ${filename}`);
            const messages = await fetchFromS3(filename);
            console.log(`Successfully fetched ${filename}: ${messages ? messages.length : 0} messages`);
            return { character: char, messages: messages || [] };
        } catch (error) {
            console.error(`Could not fetch data for ${char}: ${error.message}`);
            return { character: char, messages: [], error: error.message };
        }
    });

    const results = await Promise.all(dataPromises);

    // Log any fetch failures
    results.forEach(r => {
        if (r.error) {
            console.warn(`Fetch failed for ${r.character}: ${r.error}`);
        }
    });

    // Combine all messages
    const allMessages = results.flatMap(r => r.messages);

    // Build character list string for display
    const characterList = allCharacters.join(", ");

    return { messages: allMessages, characterList, allCharacters };
}

export async function handleMatchupNotes(message) {
    const args = message.content.split(" ");
    if (args.length < 2) {
        await message.reply("❌ Please specify a character! Example: `!mu-notes falco`");
        return;
    }

    let characterSlug;
    let displayName;

    try {
        const aliasMap = buildCharacterAliasMap(message.guild);
        const characterQuery = args.slice(1).join(" ");
        const characterMatch = resolveCharacterFromText(characterQuery, aliasMap);

        if (!characterMatch) {
            await message.reply("❌ I couldn't recognize that character. Please use the character name or a known alias. Example: \`!mu falco\`. For full docs, see https://discord.com/channels/1010002260786430052/1468015613711482974/1471297119574032486");
            return;
        }

        characterSlug = characterMatch.slug;
        displayName = characterSlug.replace("|", "/");

        const { messages, characterList } = await fetchMultiCharacterData(characterSlug);

        const related = relatedCharacters[characterSlug];

        if (related && related.length > 0) {
            await message.reply(`Watch out - that's **${displayName}**. Pulling data from: **${characterList}**. Listen…`);
        } else {
            await message.reply(`Watch out - that's **${displayName}**. Listen…`);
        }

        if (!messages || messages.length === 0) {
            await message.reply(`❌ No messages found for ${displayName}. Looking for file: \`${characterSlug}.json\`. Have you exported this character yet?`);
            return;
        }

        const katyparryMessages = messages.filter(msg => msg.author === 'katyparry');
        const otherMessages = messages.filter(msg => msg.author !== 'katyparry');
        const referenceData = buildMatchupReferenceData({
            opponentSlug: characterSlug,
            opponentAlias: characterMatch.alias,
            messages,
            question: null
        });

        const prompt = await getPrompt('mu_notes', {
            displayName,
            priorityMessages: katyparryMessages.map(formatMessageForPrompt).join('\n\n'),
            otherMessages: otherMessages.map(formatMessageForPrompt).join('\n\n'),
            referenceData: referenceData || 'None found'
        });

        const response = await genAI.models.generateContent({
            model: process.env.GEMINI_MODEL || 'gemini-3-flash-preview',
            contents: prompt
        });
        const summary = response.text;
        
        const embeds = createSplitEmbeds(EmbedBuilder, summary, INFO_EMBED_COLOR, SUMMARY_DISCLAIMER);
        message.channel.send({ embeds });

        console.log(`✅ Generated match-up notes for ${displayName}`);
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
            await message.reply(`❌ File ${characterSlug}.json not found in S3. Have you exported this character yet?`);
        } else {
            await message.reply("❌ Error generating match-up notes: " + error.message);
        }
    }
}

export async function handleMuQuestion(message) {
    const rawQuestion = message.content
        .replace(/^!mu-question\s*/i, "")
        .replace(/^!mu-q\s*/i, "")
        .replace(/^!muq\s*/i, "")
        .replace(/^!mq\s*/i, "")
        .trim();

    if (!rawQuestion) {
        await message.reply("❌ Please include a question. Example: `!mu-question How do I deal with Peach's turnips?`");
        return;
    }

    let characterSlug;
    let displayName;

    try {
        const aliasMap = buildCharacterAliasMap(message.guild);
        const characterMatch = resolveCharacterFromText(rawQuestion, aliasMap, { allowZelda: true });

        if (!characterMatch) {
            await message.reply("❌ I couldn't detect a character in your question. Please mention the character name (nicknames like 'palu' or 'pika' are ok). Example: \`!mq What should Zelda do versus Mario's fireball?\` For full docs, see https://discord.com/channels/1010002260786430052/1468015613711482974/1471297119574032486");
            return;
        }

        characterSlug = characterMatch.slug;
        displayName = characterSlug.replace("|", "/");

        const { messages, characterList } = await fetchMultiCharacterData(characterSlug);

        const related = relatedCharacters[characterSlug];
        if (related && related.length > 0) {
            await message.reply(`✨ Watch out! That's **${displayName}**. Pulling data from: **${characterList}**. Let me search for the answer...`);
        } else {
            await message.reply(`✨ Watch out! That's **${displayName}**. Let me search for the answer...`);
        }

        if (!messages || messages.length === 0) {
            await message.reply(`❌ No messages found for ${displayName}. Looking for file: \`${characterSlug}.json\`. Have you exported this character yet?`);
            return;
        }

        const katyparryMessages = messages.filter(msg => msg.author === 'katyparry');
        const otherMessages = messages.filter(msg => msg.author !== 'katyparry');
        const referenceData = buildMatchupReferenceData({
            opponentSlug: characterSlug,
            opponentAlias: characterMatch.alias,
            messages,
            question: rawQuestion
        });

        const prompt = await getPrompt('mu_question', {
            displayName,
            question: rawQuestion,
            priorityMessages: katyparryMessages.map(formatMessageForPrompt).join('\n\n'),
            otherMessages: otherMessages.map(formatMessageForPrompt).join('\n\n'),
            referenceData: referenceData || 'None found'
        });


        const response = await genAI.models.generateContent({
            model: process.env.GEMINI_MODEL || 'gemini-3-flash-preview',
            contents: prompt
        });

        const answer = response.text;
        
        const embeds = createSplitEmbeds(EmbedBuilder, answer, INFO_EMBED_COLOR, SUMMARY_DISCLAIMER);
        message.channel.send({ embeds });

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
        const hasAuthorizedRole = message.member.roles.cache.some(role =>
            role.name === "Moderators" || role.name === "Legend"
        );
        if (!hasAuthorizedRole) {
            await message.reply("❌ Only Moderators or Legend members can refine match-up notes.");
            return;
        }

        const recentMessages = await message.channel.messages.fetch({ limit: 20 });
        let characterName = null;

        for (const msg of recentMessages.values()) {
            if (msg.author.id === client.user.id && msg.content.includes("Watch out! That's **")) {
                const match = msg.content.match(/Watch out! That's \*\*(.+?)\*\*/);
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
        const originalMessages = channelMessages.map(m => `[${m.author}]: ${m.content}`).join('\n\n');
        const refinementPrompt = await getPrompt('refinement', { previousSummary, userFeedback, originalMessages });

        const response = await genAI.models.generateContent({
            model: process.env.GEMINI_MODEL || 'gemini-3-flash-preview',
            contents: refinementPrompt
        });
        const refinedSummary = response.text;
        
        const refinedWithTitle = `**Refined Summary:**\n${refinedSummary}`;
        const embeds = createSplitEmbeds(EmbedBuilder, refinedWithTitle, INFO_EMBED_COLOR, SUMMARY_DISCLAIMER);
        message.channel.send({ embeds });

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
