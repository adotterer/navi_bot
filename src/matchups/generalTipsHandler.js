import { GoogleGenAI } from '@google/genai';
import { getPrompt } from '../shared/promptLoader.js';
import { buildCharacterAliasMap, resolveCharacterFromText } from './characterAliases.js';
import { fetchMultiCharacterData } from './matchupHandler.js';
import { createSplitEmbeds } from '../shared/messageSplitter.js';
import { SUMMARY_DISCLAIMER } from '../shared/responseNotices.js';
import { EmbedBuilder } from 'discord.js';
import { buildStatsBlock } from '../shared/promptDataHelper.js';
import { loadCharacterFrameData } from '../stats/frameDataHelper.js';
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
 * Build a short frame data summary for a character (key moves with Startup, On Shield).
 * @param {string} characterSlug
 * @param {string} alias
 * @returns {string|null}
 */
function buildFrameDataSummary(characterSlug, alias) {
    const frameData = loadCharacterFrameData(characterSlug, alias);
    if (!frameData || !frameData.moves) return null;

    const lines = [];
    const maxPerType = 3;

    for (const [moveType, moves] of Object.entries(frameData.moves)) {
        if (!Array.isArray(moves) || moves.length === 0) continue;

        const typeLabel = (moveType || '').replace(/_/g, ' ');
        lines.push(`*${typeLabel}:*`);
        for (const move of moves.slice(0, maxPerType)) {
            const name = move['Move Name'] || 'Move';
            const startup = move['Startup'] || '--';
            const onShield = move['On Shield'] || '--';
            lines.push(`- ${name}: Startup ${startup}, On Shield ${onShield}`);
        }
    }

    if (lines.length === 0) return null;
    const displayName = (alias || characterSlug).split(/[-|︱｜]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    return `FRAME DATA: ${displayName}\n${lines.join('\n')}`;
}

export async function handleGeneralTips(message) {
    const args = message.content.trim().split(/\s+/).slice(1);
    if (args.length < 2) {
        await message.reply("❌ Usage: `!gt <opponent> <your character>`. Example: `!gt falco mario`. For general tips vs an opponent using your character's frame data and OoS.");
        return;
    }

    const opponentQuery = args[0];
    const myCharQuery = args.slice(1).join(" ");

    try {
        const aliasMap = buildCharacterAliasMap(message.guild);

        const opponentMatch = resolveCharacterFromText(opponentQuery, aliasMap, { allowZelda: true });
        if (!opponentMatch) {
            await message.reply("❌ I couldn't recognize that opponent. Use the character name or a known alias. Example: `!gt falco mario`.");
            return;
        }

        const myCharMatch = resolveCharacterFromText(myCharQuery, aliasMap, { allowZelda: true });
        if (!myCharMatch) {
            await message.reply("❌ I couldn't recognize your character. Use the character name or a known alias. Example: `!gt falco mario`.");
            return;
        }

        const opponentSlug = opponentMatch.slug;
        const opponentDisplayName = opponentSlug.replace("|", "/");
        const myCharSlug = myCharMatch.slug;
        const myCharDisplayName = myCharSlug.replace("|", "/");

        const { messages } = await fetchMultiCharacterData(opponentSlug);
        if (!messages || messages.length === 0) {
            await message.reply(`❌ No messages found for ${opponentDisplayName}. That matchup thread may not be exported yet.`);
            return;
        }

        const katyparryMessages = messages.filter(msg => msg.author === 'katyparry');
        const otherMessages = messages.filter(msg => msg.author !== 'katyparry');
        const priorityMessages = katyparryMessages.map(formatMessageForPrompt).join('\n\n');
        const otherMessagesText = otherMessages.map(formatMessageForPrompt).join('\n\n');

        const myCharStats = buildStatsBlock(myCharSlug, myCharMatch.alias);
        const myCharFrameData = buildFrameDataSummary(myCharSlug, myCharMatch.alias);
        const myCharacterReferenceData = [myCharFrameData, myCharStats].filter(Boolean).join('\n\n') || 'None found';

        await message.reply(`General tips for **${myCharDisplayName}** vs **${opponentDisplayName}**…`);

        const prompt = await getPrompt('general_tips', {
            opponentDisplayName,
            myCharacterDisplayName: myCharDisplayName,
            priorityMessages,
            otherMessages: otherMessagesText,
            myCharacterReferenceData
        });

        const response = await genAI.models.generateContent({
            model: process.env.GEMINI_MODEL || 'gemini-3-flash-preview',
            contents: prompt
        });

        const summary = response.text;
        const embeds = createSplitEmbeds(EmbedBuilder, summary, INFO_EMBED_COLOR, SUMMARY_DISCLAIMER);
        await message.channel.send({ embeds });

        console.log(`✅ Generated general tips for ${myCharDisplayName} vs ${opponentDisplayName}`);
    } catch (error) {
        console.error('General tips error:', error);
        await message.reply("❌ Error generating general tips: " + error.message);
    }
}
