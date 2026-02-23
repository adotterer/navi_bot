/**
 * Discord command !add-a <alias> <canonical-character-from-s3>
 * Mod-only: add a character alias that maps to a canonical name (from S3 canonical list).
 * Updates admin/character-aliases.json in S3 and refreshes the local alias cache so
 * the new alias works immediately for !mu, !mu-notes, etc.
 */
import { getCanonicalCharacterThreads, getNicknameAliases } from '../matchups/characterAliases.js';
import { putAliasesToS3 } from '../shared/aliasSync.js';
import { syncAliasesFromS3 } from '../shared/aliasSync.js';

const PREFIX = '!add-a ';
const USAGE = 'Usage: `!add-a <alias> <canonical-name>` — alias can be any label; canonical must be a character from the list (see `!canonical`). Example: `!add-a gaw mr-game-and-watch`';

/**
 * Parse "!add-a ..." content into { alias, canonical } by matching the longest
 * canonical name from the list at the end of the string (so "game and watch mr-game-and-watch" works).
 */
function parseAddAliasArgs(content, canonicalList) {
    const raw = content.trim().slice(PREFIX.length).trim();
    if (!raw) return { alias: null, canonical: null };

    const rawLower = raw.toLowerCase();
    // Sort by length descending so we match longest canonical first (e.g. "peach | daisy" before "peach")
    const sorted = [...canonicalList].filter(Boolean).sort((a, b) => b.length - a.length);

    for (const canonical of sorted) {
        const canLower = canonical.toLowerCase();
        if (!canLower) continue;
        if (rawLower === canLower) {
            return { alias: raw.trim(), canonical };
        }
        if (rawLower.endsWith(canLower)) {
            const aliasPart = raw.slice(0, raw.length - canonical.length).trim();
            if (aliasPart) return { alias: aliasPart, canonical };
        }
    }
    return { alias: null, canonical: null };
}

/**
 * Handle !add-a command: validate canonical, merge new alias into S3 JSON, upload, sync local cache.
 */
export async function handleAddAlias(message) {
    const hasAuthorizedRole = message.member?.roles?.cache?.some(
        role => role.name === 'Moderators' || role.name === 'Legend'
    );
    if (!hasAuthorizedRole) {
        await message.reply('❌ Only Moderators or Legend members can add aliases.');
        return;
    }

    const content = message.content.trim();
    if (!content.toLowerCase().startsWith(PREFIX)) return;

    let canonicalList;
    try {
        canonicalList = await getCanonicalCharacterThreads();
    } catch (err) {
        console.error('[!add-a] getCanonicalCharacterThreads:', err);
        await message.reply('❌ Could not load canonical character list. Check S3 / `!canonical`.');
        return;
    }

    if (!canonicalList || canonicalList.length === 0) {
        await message.reply('❌ No canonical characters loaded. Run `!export matchups` or ensure S3 has canonical list.');
        return;
    }

    const { alias, canonical } = parseAddAliasArgs(content, canonicalList);

    if (!alias || !canonical) {
        await message.reply(`❌ ${USAGE}`);
        return;
    }

    const current = getNicknameAliases();
    const updated = { ...current, [alias]: canonical };
    const jsonString = JSON.stringify(updated, null, 2);

    try {
        await putAliasesToS3(jsonString);
        await syncAliasesFromS3();
    } catch (err) {
        console.error('[!add-a] S3 update:', err);
        await message.reply('❌ Failed to save alias to S3. Check AWS credentials and S3 bucket.');
        return;
    }

    await message.reply(`✅ Alias added: \`${alias}\` → \`${canonical}\`. It will work for !mu and other character commands now.`);
}
