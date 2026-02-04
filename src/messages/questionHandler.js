import { GoogleGenAI } from '@google/genai';
import { sendSplitMessage } from "../shared/messageSplitter.js";
import { fetchFromS3 } from "../shared/s3Helper.js";

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
        await message.reply(`⏳ Looking up glossary and searching for an answer...`);

        // Fetch glossary and fundies from S3
        let glossaryContext = "";
        let fundiesContext = "";

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

        // Build context string for AI
        const contextString = [glossaryContext, fundiesContext].filter(Boolean).join("\n\n");
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

For reference, here is the format style to follow:

# Question Topic

### ✅ Key Strategy
-# - <:6symbolnavi:1341400385709019138> Explanation of the strategy and why it works effectively.
-# - <:6symbolnavi:1341400385709019138> Additional context or related information if relevant.

### ❌ Common Mistake
-# - <:6symbolnavi:1341400385709019138> What to avoid and why it doesn't work in this situation.

Provide the best possible answer now:`;

        const response = await genAI.models.generateContent({
            model: process.env.GEMINI_MODEL || 'gemini-3-flash-preview',
            contents: fullPrompt
        });

        const answer = response.text;

        await sendSplitMessage(message, answer, true);
        await message.channel.send("-# Note: Responses are summarized based on community messages. Verify with trusted sources.");
        await message.channel.send(`-# <@596207448935628812> Please verify the above answer is accurate! 🔎`);
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
