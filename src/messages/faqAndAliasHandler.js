import { nicknameAliases } from '../matchups/characterAliases.js';
import { sendSplitMessage } from '../shared/messageSplitter.js';

const FAQ_LINES = [
    '📌 **Navi Bot FAQ**',
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