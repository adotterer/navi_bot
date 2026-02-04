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
7. If it sends links, they need to be hyperlinked only, not embedded. 

For reference, here is the format style to follow:

# Question Topic

# > Fundamental Laws: Don'ts

###  ❌ Do Not Buffer Defensive Options In Disadvantage
-# - <:6symbolnavi:1341400385709019138> Good players know to **wait** in their advantage state so they can **react** to you acting preemptively, 
### ❌ Do Not Skip the Ledge
-# - <:6symbolnavi:1341400385709019138> Skipping the ledge usually involves burning a resource that is easy to react to (directional airdodge), or easy to punish by taking center stage (double jumping onto stage.) If you do not go to the ledge, you are making things VERY easy for your opponent, because now they don't have to work harder to frame trap you from the ledge. In addition, all of your options from the ledge will have intangibility, giving you a chance to navigate back to neutral. 
-# - <:6symbolnavi:1341400385709019138> Remember, when you're offstage you gain intangibility based on how long you've been offstage (see <#1466584974818803985> for more information. 
### ❌ Do Not Rush the Kill
-# - <:6symbolnavi:1341400385709019138> When your opponent is at high percent - or at a percentage where you can kill them - only going for the kill is going to show them how you like to kill, and you will teach them how to avoid your attempts to kill. A good question to ask yourself is "Does my opponent even pay attention to **their own** percent? 
# > Fundamental Laws: Dos
### ✅ Do Keep Yourself Available
-# - <:6symbolnavi:1341400385709019138> Using non-committal options is generally best in **all** situations. If you act without **reason** or **purpose** - you will might opportunities that you could have taken advantage of.
### ✅  Do Default to Center/Return to Center
-# - <:6symbolnavi:1341400385709019138> Stage control is the most important aspect to this game because it keeps your options free, and allows you to bait approaches and throw retreating aerials to occupy the space you were previously in, know as covering your **after-image**. In everything you do, you want to **default** to returning to center stage. If you throw out an attack and you miss, for example - you want to immediately dash back to **return** to center.

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
