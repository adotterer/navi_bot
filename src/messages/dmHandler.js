import { handleQuestion } from './questionHandler.js';
import { handleMuQuestion } from '../matchups/matchupHandler.js';
import { handleStatsQuestion } from '../stats/statsHandler.js';
import { handleFrameDataQuestion } from '../stats/frameDataHelper.js';
import { handleDocs, handleFaq, handleAliases } from './faqAndAliasHandler.js';

export async function handleDMMessage(message) {
    // Only process DMs
    if (message.channel.type !== 1) return; // DM channel type is 1
    if (message.author.bot) return;

    const content = message.content.toLowerCase();

    // Handle various commands
    if (content === '!docs') {
        await handleDocs(message);
        return;
    }

    if (content === '!faq') {
        await handleFaq(message);
        return;
    }

    if (content === '!aliases') {
        await handleAliases(message);
        return;
    }

    if (content.startsWith('!q ')) {
        await handleQuestion(message);
        return;
    }

    if (content.startsWith('!mu-question ') || content.startsWith('!mu-q ') || 
        content.startsWith('!muq ') || content.startsWith('!mq ')) {
        await handleMuQuestion(message);
        return;
    }

    if (content.startsWith('!sq ')) {
        const question = message.content.slice(4).trim();
        await handleStatsQuestion(message, question);
        return;
    }

    if (content.startsWith('!fdq ')) {
        const question = message.content.slice(5).trim();
        await handleFrameDataQuestion(message, question);
        return;
    }

    // Help message for unrecognized commands
    await message.reply(
        "👋 Hi! I'm Navi Bot. Here are the commands you can use in DMs:\n\n" +
        "📚 **!docs** - Get documentation links\n" +
        "❓ **!faq** - View frequently asked questions\n" +
        "🏷️ **!aliases** - See character name aliases\n" +
        "💬 **!q <question>** - Ask a general question\n" +
        "🎮 **!mq <matchup question>** - Ask about character matchups\n" +
        "📊 **!sq <stats question>** - Ask about player stats\n" +
        "⏱️ **!fdq <frame data question>** - Ask about frame data"
    );
}
