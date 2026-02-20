import { GoogleGenAI } from '@google/genai';
import { sendSplitMessage, createSplitEmbeds } from "../shared/messageSplitter.js";
import { fetchFromS3 } from "../shared/s3Helper.js";
import { SUMMARY_DISCLAIMER } from "../shared/responseNotices.js";
import { EmbedBuilder } from 'discord.js';
import { INFO_EMBED_COLOR } from './faqAndAliasHandler.js';

const genAI = new GoogleGenAI({
    apiKey: process.env.GOOGLE_API_KEY
});

export async function handleQuestion(message) {
    const content = message.content.trim();
    const question = content.replace(/^!q\s*/i, "").trim();

    if (!question) {
        await message.reply("❌ Usage: !q <your question>");
        return;
    }

    try {
        await message.reply(`⏳ Looking up resources and searching for an answer...`);

        // Fetch all context sources from S3
        let glossaryContext = "";
        let fundiesContext = "";
        let disadvantageContext = "";
        let advantageContext = "";
        let neutralContext = "";

        try {
            const glossaryJson = await fetchFromS3("glossary.json");
            glossaryContext = formatContextFromMessages(glossaryJson, "Glossary Terms");
        } catch (error) {
            console.warn("⚠️ Could not fetch glossary.json:", error.message);
        }

        try {
            const fundiesJson = await fetchFromS3("fundies.json");
            fundiesContext = formatContextFromMessages(fundiesJson, "Fundamentals");
        } catch (error) {
            console.warn("⚠️ Could not fetch fundies.json:", error.message);
        }

        try {
            const disadvantageJson = await fetchFromS3("disadvantage.json");
            disadvantageContext = formatContextFromMessages(disadvantageJson, "Disadvantage State");
        } catch (error) {
            console.warn("⚠️ Could not fetch disadvantage.json:", error.message);
        }

        try {
            const advantageJson = await fetchFromS3("advantage.json");
            advantageContext = formatContextFromMessages(advantageJson, "Advantage State");
        } catch (error) {
            console.warn("⚠️ Could not fetch advantage.json:", error.message);
        }

        try {
            const neutralJson = await fetchFromS3("neutral.json");
            neutralContext = formatContextFromMessages(neutralJson, "Neutral State");
        } catch (error) {
            console.warn("⚠️ Could not fetch neutral.json:", error.message);
        }

        // Build context string for AI
        const contextString = [glossaryContext, fundiesContext, disadvantageContext, advantageContext, neutralContext].filter(Boolean).join("\n\n");
        const fullPrompt = `You are Navi Bot, a helpful assistant for Zelda matchup analysis.

${contextString ? `**Available Context:**\n${contextString}\n\n` : ""}**User Question:**
${question}

RULES:
1. Answer only using information from the context above
2. If the context doesn't address the question, say you couldn't find relevant information
3. Be concise and actionable
4. Use Discord markdown formatting (**, *, headings)
5. Do NOT add any blank lines between bullet pairs, between bullets and sections, or between sections. Keep compact formatting throughout with no extra empty lines.
6. Do NOT mention any usernames. Present all advice as Navi Bot's own guidance.
7. If it sends links, they need to be hyperlinked only, not embedded. 

For reference, here is the format style to follow:

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
-# - <:3symbolpieceofheart:1336147245371756656> *Note: Responses are summarized based on <@596207448935628812>'s research & community messages. Verify with trusted sources.*

Provide the best possible answer now:`;

        const response = await genAI.models.generateContent({
            model: process.env.GEMINI_MODEL || 'gemini-3-flash-preview',
            contents: fullPrompt
        });

        const answer = response.text;
        
        const embeds = createSplitEmbeds(EmbedBuilder, answer, INFO_EMBED_COLOR, SUMMARY_DISCLAIMER);
        message.channel.send({ embeds });
    } catch (error) {
        console.error("Error in handleQuestion:", error);
        await message.reply("❌ Error processing question: " + error.message);
    }
}

function formatContextFromMessages(messagesJson, sectionTitle) {
    if (!Array.isArray(messagesJson) || messagesJson.length === 0) {
        return "";
    }

    const formatted = messagesJson
        .map(msg => msg.content)
        .filter(Boolean)
        .join("\n");

    return `**${sectionTitle}:**\n${formatted}`;
}
