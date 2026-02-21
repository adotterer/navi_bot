import { handleQuestion } from './questionHandler.js';
import { handleFrameDataQuestion } from '../stats/frameDataHelper.js';
import { handleDocs, handleFaq, handleAliases } from './faqAndAliasHandler.js';

export async function handleDMMessage(message) {
    if (message.author.bot) return;
    // Caller (main.js) already verified this is a DM; don't re-check channel.type (PartialDMChannel may not have type set)

    const content = (message.content || '').trim().toLowerCase();

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
    if (content.startsWith('!fdq ')) {
        const question = (message.content || '').slice(5).trim();
        await handleFrameDataQuestion(message, question);
        return;
    }

    await message.reply(
        "👋 Hi! I'm Navi Bot. Here are the commands you can use in DMs:\n\n" +
        "📚 **!docs** - Get documentation links\n" +
        "❓ **!faq** - View frequently asked questions\n" +
        "🏷️ **!aliases** - See character name aliases\n" +
        "💬 **!q <question>** - Ask a general question\n" +
        "⏱️ **!fdq <frame data question>** - Ask about frame data\n\n" +
        "Matchup (!mq) and stats (!sq) are available in server channels only."
    );
}
