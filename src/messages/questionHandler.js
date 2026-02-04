import { GoogleGenerativeAI } from "@google/generative-ai";
import { sendSplitMessage } from "../shared/messageSplitter.js";
import { fetchFromS3, uploadToS3 } from "../shared/s3Helper.js";

const genai = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

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

Provide a concise, helpful answer using the context above when relevant. Keep your response focused and practical.`;

        const model = genai.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(fullPrompt);
        const answer = result.response.text();

        await sendSplitMessage(message, answer, true);
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
