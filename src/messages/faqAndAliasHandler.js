import { getNicknameAliases, getCanonicalCharacterThreads, saveNicknameAliases } from '../matchups/characterAliases.js';
import { syncAliasesFromS3 } from '../shared/aliasSync.js';
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
    '• **Character aliases:** Use `!aliases` to view all aliases in alphabetical order.'
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
    const nicknameAliases = await getNicknameAliases();
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

export async function handleAddAlias(message) {
    const args = message.content.trim().split(/\s+/).slice(1);
    if (args.length < 2) {
        await message.reply('❌ Usage: `!add-a <alias> <canonical>`');
        return;
    }

    const alias = args[0].toLowerCase();
    const canonicalInput = args.slice(1).join(' ');

    const canonicals = await getCanonicalCharacterThreads();
    const canonicalMatch = canonicals.find(c => c.toLowerCase() === canonicalInput.toLowerCase());

    if (!canonicalMatch) {
        await message.reply(`❌ "${canonicalInput}" is not a recognized canonical name.`);
        return;
    }

    const nicknameAliases = getNicknameAliases();
    nicknameAliases[alias] = canonicalMatch;

    try {
        await saveNicknameAliases(nicknameAliases);
        await syncAliasesFromS3();
        await message.reply(`✅ Alias added: **${alias}** → **${canonicalMatch}**`);
    } catch (err) {
        console.error('[handleAddAlias] Error:', err);
        await message.reply(`❌ Failed to update aliases: ${err.message}`);
    }
}