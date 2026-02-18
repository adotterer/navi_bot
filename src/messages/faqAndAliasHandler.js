import { nicknameAliases } from '../matchups/characterAliases.js';
import { sendSplitMessage } from '../shared/messageSplitter.js';

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
    '• **Character aliases:** Use `!aliases` to view all aliases in alphabetical order.'
];

const FAQ_LINES = [
    '🧠 **How answers are generated** *(for `!mq`, `!fdq`, `!sq`)*',
    '',
    '**`!mq` (matchup questions)**',
    '• Uses archived matchup notes + trusted community messages',
    '• Adds relevant character stats + move frame data when a move is mentioned',
    '• If nothing in the notes answers the question, it will say so',
    '',
    '**`!fdq` (frame data questions)**',
    '• Uses the frame data database',
    '• Answers are drawn only from that content',
    '',
    '**`!sq` (stats questions)**',
    '• Pulls directly from the stats database',
    '• Returns the requested stats for the character',
    '',
    'Note: The bot does not make up info—if it is not in the sources, it will not claim it.'
];

export async function handleDocs(message) {
    await sendSplitMessage(message, DOCS_LINES.join('\n'), true);
}

export async function handleFaq(message) {
    await sendSplitMessage(message, FAQ_LINES.join('\n'), true);
}

export async function handleAliases(message) {
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

    await sendSplitMessage(message, lines.join('\n'), true);
}