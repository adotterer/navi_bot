import { GoogleGenAI } from '@google/genai';
import { fetchFromS3, isModelOverloaded, fetchAllMessages } from '../shared/s3Helper.js';
import { buildCharacterAliasMap, resolveCharacterFromText, relatedCharacters } from './characterAliases.js';
import { sendSplitMessage } from '../shared/messageSplitter.js';
import { SUMMARY_DISCLAIMER } from '../shared/responseNotices.js';
import { EmbedBuilder } from 'discord.js';
const genAI = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    defaultModel: process.env.GEMINI_MODEL || 'gemini-3-flash-preview'
});

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

    const character = args[1].toLowerCase();

    try {
        const { messages, characterList } = await fetchMultiCharacterData(character);

        const capitalizedCharacter = character.charAt(0).toUpperCase() + character.slice(1);
        const related = relatedCharacters[character];

        if (related && related.length > 0) {
            const relatedCapitalized = related.map(c => c.charAt(0).toUpperCase() + c.slice(1)).join(", ");
            await message.reply(`Watch out - that's a **${capitalizedCharacter}**. Pulling data from: **${characterList}**. Listen…`);
        } else {
            await message.reply(`Watch out - that's a **${capitalizedCharacter}**. Listen…`);
        }

        if (!messages || messages.length === 0) {
            await message.reply(`❌ No messages found for ${character}. Looking for file: \`${character}.json\`. Have you exported this character yet?`);
            return;
        }

        const katyparryMessages = messages.filter(msg => msg.author === 'katyparry');
        const otherMessages = messages.filter(msg => msg.author !== 'katyparry');

        const prompt = `You are an expert Super Smash Bros. Ultimate analyst. Below are Discord messages discussing the Zelda vs ${character} matchup.

    IMPORTANT: Messages from user 'katyparry' are the most authoritative and should be heavily weighted in your summary. These reflect research & community messages.

=== PRIORITY MESSAGES (from katyparry) ===
${katyparryMessages.map(msg => `${msg.author}: ${msg.content}`).join('\n\n')}

=== OTHER COMMUNITY MESSAGES ===
${otherMessages.map(msg => `${msg.author}: ${msg.content}`).join('\n\n')}

=== YOUR TASK ===
Create a comprehensive matchup summary following this format. This example is just a template - adapt the content for ${character}.

# Punishing Cloud's Forward Air
## >  Strategy & Execution
### ✅ Use Level 3 Phantom Trap
-# - <:6symbolnavi:1341400385709019138> A reliable 50/50 mix-up involves jumping back while charging Phantom. If Cloud approaches with Fair, release the level 3 Phantom so he hits it and gets stuck in hitlag (Fair hitlag is extended for 21 frames). Wait for the Phantom pieces to break and the purple smoke to appear, then punish with a dash attack.
### ✅ Parrying Landing Aerials
-# - <:6symbolnavi:1341400385709019138> Parrying is the primary way to punish Cloud’s landing aerials like Fair, which are often safe on shield. A successful parry usually allows for a dash attack. Depending on the spacing, you may also be able to punish with a Lightning Kick or Up B.
### ✅ Spacing with Aerials
-# - <:6symbolnavi:1341400385709019138> Use empty hops to manage your positioning and bait the attack. Do not move towards Cloud while using your own Fair, as this is horrendously unsafe. Instead, properly space for a Bair, Fair, or a Short Hop Up Air to catch him after he commits to his Fair.
### ❌ Avoid Immediate Shield Follow-ups
-# - <:6symbolnavi:1341400385709019138> Do not always try to punish Cloud immediately after he hits your shield, as he tends to win close-quarters boxing situations. It is often better to hold shield, roll, or retreat. Staying grounded gives you better access to tilts and rolls to reposition safely.

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
14. Do NOT add any blank lines between bullet pairs, between bullets and sections, or between sections. Keep compact formatting throughout with no extra empty lines.
15. Do NOT mention any usernames or quote users. Present all advice as Navi Bot's own guidance (even if informed by those messages).
16. Any hyperlinks should be surrounded by <> so that they do not embed in Discord. example <https://www.start.gg/...>

Generate the matchup summary now:`;

        const response = await genAI.models.generateContent({
            model: process.env.GEMINI_MODEL || 'gemini-3-flash-preview',
            contents: prompt
        });
        const summary = response.text;
        const exampleEmbed = new EmbedBuilder()
            .setColor("DarkPurple")
            .setTitle(`Matchup Summary`)
            .setAuthor({ name: 'Navi Bot' })
            .setDescription(summary)
            .addFields(
                { name: 'Regular field title', value: 'Some value here' },
                { name: '\u200B', value: '\u200B' },
                { name: 'Inline field title', value: 'Some value here', inline: true },
                { name: 'Inline field title', value: 'Some value here', inline: true },
            )
            .setFooter({ text: SUMMARY_DISCLAIMER });
        message.channel.send({ embeds: [exampleEmbed] });
        // await sendSplitMessage(message, summary, true);

        // await message.channel.send(SUMMARY_DISCLAIMER);

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
    const rawQuestion = message.content
        .replace(/^!mu-question\s*/i, "")
        .replace(/^!mu-q\s*/i, "")
        .trim();

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

        const { messages, characterList } = await fetchMultiCharacterData(characterSlug);

        const related = relatedCharacters[characterSlug];
        if (related && related.length > 0) {
            await message.reply(`✨ Watch out! That's a **${displayName}**. Pulling data from: **${characterList}**. Let me search for the answer...`);
        } else {
            await message.reply(`✨ Watch out! That's a **${displayName}**. Let me search for the answer...`);
        }

        if (!messages || messages.length === 0) {
            await message.reply(`❌ No messages found for ${displayName}. Looking for file: \`${characterSlug}.json\`. Have you exported this character yet?`);
            return;
        }

        const katyparryMessages = messages.filter(msg => msg.author === 'katyparry');
        const otherMessages = messages.filter(msg => msg.author !== 'katyparry');

        const prompt = `You are an expert Super Smash Bros. Ultimate analyst. The user has a specific matchup question about Zelda vs ${displayName}.

QUESTION:
"${rawQuestion}"

IMPORTANT: Messages from user 'katyparry' are the most authoritative and should be heavily weighted in your answer. These reflect research & community messages.

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
6. Do NOT add any blank lines between bullet pairs, between bullets and sections, or between sections. Keep compact formatting throughout with no extra empty lines.
7. Do NOT mention any usernames or quote users. Present all advice as Navi Bot's own guidance (even if informed by those messages).
8. Any hyperlinks should be surrounded by <> so that they do not embed in Discord. example <https://www.start.gg/...>

For a reference, here is example to draw from for markdown format, how to organize bullet points and headings, etc. The actual content is just copy paste from our styleguide:

# Punishing Cloud's Forward Air
## >  Strategy & Execution
### ✅ Use Level 3 Phantom Trap
-# - <:6symbolnavi:1341400385709019138> A reliable 50/50 mix-up involves jumping back while charging Phantom. If Cloud approaches with Fair, release the level 3 Phantom so he hits it and gets stuck in hitlag (Fair hitlag is extended for 21 frames). Wait for the Phantom pieces to break and the purple smoke to appear, then punish with a dash attack.
### ✅ Parrying Landing Aerials
-# - <:6symbolnavi:1341400385709019138> Parrying is the primary way to punish Cloud’s landing aerials like Fair, which are often safe on shield. A successful parry usually allows for a dash attack. Depending on the spacing, you may also be able to punish with a Lightning Kick or Up B.
### ✅ Spacing with Aerials
-# - <:6symbolnavi:1341400385709019138> Use empty hops to manage your positioning and bait the attack. Do not move towards Cloud while using your own Fair, as this is horrendously unsafe. Instead, properly space for a Bair, Fair, or a Short Hop Up Air to catch him after he commits to his Fair.
### ❌ Avoid Immediate Shield Follow-ups
-# - <:6symbolnavi:1341400385709019138> Do not always try to punish Cloud immediately after he hits your shield, as he tends to win close-quarters boxing situations. It is often better to hold shield, roll, or retreat. Staying grounded gives you better access to tilts and rolls to reposition safely.

Provide the best possible answer now:`;

        const response = await genAI.models.generateContent({
            model: process.env.GEMINI_MODEL || 'gemini-3-flash-preview',
            contents: prompt
        });

        const answer = response.text;
        await sendSplitMessage(message, answer, true);

        await message.channel.send(SUMMARY_DISCLAIMER);

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
            if (msg.author.id === client.user.id && msg.content.includes("Watch out! That's a **")) {
                const match = msg.content.match(/Watch out! That's a \*\*(.+?)\*\*/);
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
14. Use markdown format
15. Do NOT add any blank lines between bullet pairs, between bullets and sections, or between sections. Keep compact formatting throughout with no extra empty lines.
16. Do NOT mention any usernames or quote users. Present all advice as Navi Bot's own guidance (even if informed by those messages).
17. Any hyperlinks should be surrounded by <> so that they do not embed in Discord. example <https://www.start.gg/...>

For a reference, here is example to draw from for markdown format, how to organize bullet points and headings, etc.

# Punishing Cloud's Forward Air
## >  Strategy & Execution
### ✅ Use Level 3 Phantom Trap
-# - <:6symbolnavi:1341400385709019138> A reliable 50/50 mix-up involves jumping back while charging Phantom. If Cloud approaches with Fair, release the level 3 Phantom so he hits it and gets stuck in hitlag (Fair hitlag is extended for 21 frames). Wait for the Phantom pieces to break and the purple smoke to appear, then punish with a dash attack.
### ✅ Parrying Landing Aerials
-# - <:6symbolnavi:1341400385709019138> Parrying is the primary way to punish Cloud’s landing aerials like Fair, which are often safe on shield. A successful parry usually allows for a dash attack. Depending on the spacing, you may also be able to punish with a Lightning Kick or Up B.
### ✅ Spacing with Aerials
-# - <:6symbolnavi:1341400385709019138> Use empty hops to manage your positioning and bait the attack. Do not move towards Cloud while using your own Fair, as this is horrendously unsafe. Instead, properly space for a Bair, Fair, or a Short Hop Up Air to catch him after he commits to his Fair.
### ❌ Avoid Immediate Shield Follow-ups
-# - <:6symbolnavi:1341400385709019138> Do not always try to punish Cloud immediately after he hits your shield, as he tends to win close-quarters boxing situations. It is often better to hold shield, roll, or retreat. Staying grounded gives you better access to tilts and rolls to reposition safely.

Original Discord Messages:
${channelMessages.map(m => `[${m.author}]: ${m.content}`).join('\n\n')}`;

        const response = await genAI.models.generateContent({
            model: process.env.GEMINI_MODEL || 'gemini-3-flash-preview',
            contents: refinementPrompt
        });
        const refinedSummary = response.text;

        await sendSplitMessage(message, `**Refined Summary:**\n${refinedSummary}`, false);

        await message.channel.send(SUMMARY_DISCLAIMER);

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
