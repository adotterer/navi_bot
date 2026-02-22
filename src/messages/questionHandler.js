import { GoogleGenAI } from '@google/genai';
import { sendSplitMessage, createSplitEmbeds } from "../shared/messageSplitter.js";
import { fetchFromS3 } from "../shared/s3Helper.js";
import { getPrompt } from '../shared/promptLoader.js';
import { SUMMARY_DISCLAIMER } from "../shared/responseNotices.js";
import { EmbedBuilder } from 'discord.js';
import { INFO_EMBED_COLOR } from './faqAndAliasHandler.js';
import { createRun, updateRun } from '../admin/agent/runStore.js';

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

    const runId = createRun('!q command', 'command');

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
        const fullPrompt = await getPrompt('general_question', { context: contextString || '', question });

        const response = await genAI.models.generateContent({
            model: process.env.GEMINI_MODEL || 'gemini-3-flash-preview',
            contents: fullPrompt
        });

        if (runId && response.usageMetadata) {
            updateRun(runId, {
                usage: {
                    promptTokenCount: response.usageMetadata.promptTokenCount,
                    candidatesTokenCount: response.usageMetadata.candidatesTokenCount,
                    cachedContentTokenCount: response.usageMetadata.cachedContentTokenCount
                }
            });
        }

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
