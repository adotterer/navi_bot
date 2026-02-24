import { getNicknameAliases } from '../matchups/characterAliases.js';
import { createSplitEmbeds } from '../shared/messageSplitter.js';
import { EmbedBuilder } from 'discord.js';

// Standard bot branding: Use INFO_EMBED_COLOR (#36AAD4) and the SUMMARY_DISCLAIMER footer with createSplitEmbeds for information embeds.
export const INFO_EMBED_COLOR = '#36AAD4';

const DOCS_LINES = [
    '📌 **Navi Bot Docs**',
    '',
    '• **Frame data documentation:**',
    'https://discord.com/channels/1010002260786430052/1471283116193873983/1471283349824733391',
    '',
    '• **Stats documentation:**',
    'https://discord.com/channels/1010002260786430052/1471283194706788362/1471283541357756590',
    '',
    '• **MU commands documentation** *(Farore\'s or Nayru\'s subscription required)*:',
    'https://discord.com/channels/1010002260786430052/1468015613711482974/1471297119574032486',
    '',
    '• **Character aliases:** Use `!aliases` to view all aliases in alphabetical order.',
    '',
    '• **Stage ban (slash commands)**',
    '`/coinflip` — Start a stage ban match (opponent required).',
    '`/findmatch @opponent` — You choose BO3 or BO5 from a dropdown; opponent clicks Accept Match; then coinflip + stage ban.',
    '`/bo3`, `/bo5`, `/ft5` — Start a match with a set format (BO3 = first to 2, BO5 = first to 3, FT5 = first to 5).',
    '`/ban` — Ban or select a stage (dropdown on the bot message or this command; match ID optional).',
    '`/result` — Report who won a game (loser must confirm). After Game 2+ you can play another match or `/end`.',
    '`/end` — End the session (either player). Sessions expire after 24 hours if not ended.',
    '`/cancel-match` — Cancel your active match (either player).',
    'Stage lists (starters/counterpicks): use `!sl` in Discord.'
];

const FAQ_LINES = [
    '🧠 **Navi Bot FAQ — How answers are generated**',
    '',
    '**Matchup questions** — `!mq`, `!muq`, `!mu-q`, `!mu-question`',
    '• Uses archived matchup notes + trusted community matchup messages',
    '• Adds relevant character stats + move frame data when a move is mentioned',
    '• If the source notes do not answer your question, it will explicitly say so',
    '',
    '**Frame data questions** — `!fdq`',
    '• Uses the frame data database',
    '• Answers are drawn only from that content',
    '',
    '**Stats questions** — `!sq`',
    '• Pulls directly from the stats database',
    '• Returns the requested stats for the character',
    '',
    '**Source policy**',
    '• The bot does not make up info—if it is not in the sources, it will not claim it',
    '• When data is missing or unclear, it should respond with that limitation',
    '',
    '**Quick examples**',
    '• `!mq what beats Wolf blaster?`',
    '• `!fdq is Cloud bair safe on shield?`',
    '• `!sq what is Sheik run speed?`',
    '',
    '**Stage ban (slash commands)**',
    '• `/coinflip @opponent` or `/findmatch @opponent` (you pick BO3/BO5, opponent accepts) or `/bo3`, `/bo5`, `/ft5 @opponent` — Start a match; coin flip decides who bans first. BO3/BO5/FT5 track set score (first to 2/3/5).',
    '• The bot message has a **dropdown** for the player whose turn it is; they can also use `/ban <stage>` (match ID optional).',
    '• Game 1: starters only. Game 2+: counterpicks; previous game winner bans 3, opponent picks 1. After each game, report result (loser confirms), then **Another match** or **/end**.',
    '• `/result` — Report who won Game 1 or Game 2+ (loser must confirm). `/end` — End the session (24h auto-expiry if forgotten). `/cancel-match` — Cancel the match.',
    '',
    'Need command docs/threads? Use `!docs`.',
    'Need all character aliases? Use `!aliases`.'
];

async function sendSplitEmbedMessage(message, text) {
    const embeds = createSplitEmbeds(EmbedBuilder, text, INFO_EMBED_COLOR);

    for (let index = 0; index < embeds.length; index += 10) {
        const batch = embeds.slice(index, index + 10);
        if (index === 0) {
            await message.reply({ embeds: batch });
        } else {
            await message.channel.send({ embeds: batch });
        }
    }
}

export async function handleDocs(message) {
    await sendSplitEmbedMessage(message, DOCS_LINES.join('\n'));
}

export async function handleFaq(message) {
    await sendSplitEmbedMessage(message, FAQ_LINES.join('\n'));
}

export async function handleAliases(message) {
    const nicknameAliases = getNicknameAliases();
    const aliases = Object.keys(nicknameAliases)
        .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));

    if (aliases.length === 0) {
        await message.reply('⚠️ No aliases found.');
        return;
    }

    const lines = [
        `📚 **Character Aliases (${aliases.length})**`,
        '',
        ...aliases.map(alias => `• ${alias} → ${nicknameAliases[alias]}`)
    ];

    await sendSplitEmbedMessage(message, lines.join('\n'));
}