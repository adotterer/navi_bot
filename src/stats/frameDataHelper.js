import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { EmbedBuilder } from 'discord.js';
import { createSplitEmbeds } from '../shared/messageSplitter.js';
import { SUMMARY_DISCLAIMER } from '../shared/responseNotices.js';
import { buildCharacterAliasMap, resolveCharacterFromText, normalizeCharacterText } from '../matchups/characterAliases.js';
import { listFramedataSections, getFramedataCSVRaw } from '../shared/dataReader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRAMEDATA_DIR = path.join(__dirname, '../../data/framedata');

/** Map alias-map slugs to framedata directory names where they differ (e.g. stats CSV "R.O.B." → r-o-b but dir is rob). */
const FRAMEDATA_SLUG_TO_DIR = {
    'r-o-b': 'rob',
    'min-min': 'minmin'
};

const genAI = new GoogleGenAI({
    apiKey: process.env.GOOGLE_API_KEY
});

// Move name abbreviations mapping
const MOVE_ABBREVIATIONS = {
    'rapid jab finisher': 'Rapid Jab Finisher',
    'rapid jab': 'Rapid Jab',
    'jab': 'Jab',
    'fair': 'Forward Air',
    'bair': 'Back Air',
    'uair': 'Up Air',
    'dair': 'Down Air',
    'nair': 'Neutral Air',
    'zair': 'Z Air',
    'neutral b': 'Neutral B',
    'neutralb': 'Neutral B',
    'side b': 'Side B',
    'sideb': 'Side B',
    'up b': 'Up B',
    'upb': 'Up B',
    'down b': 'Down B',
    'downb': 'Down B',
    'fthrow': 'Forward Throw',
    'bthrow': 'Backward Throw',
    'uthrow': 'Up Throw',
    "upthrow": 'Up Throw',
    'downthrow': 'Down Throw',
    "down throw": 'Down Throw',
    'dthrow': 'Down Throw',
    'fsmash': 'Forward Smash',
    'usmash': 'Up Smash',
    'upsmash': 'Up Smash',
    "up smash"  : 'Up Smash',
    "down smash": 'Down Smash',
    'dsmash': 'Down Smash',
    'ftilt': 'Forward Tilt',
    "uptilt": 'Up Tilt',
    'downtilt': 'Down Tilt',
    'forwardtilt': 'Forward Tilt',
    'utilt': 'Up Tilt',
    'dtilt': 'Down Tilt',
    'pivotgrab': 'Pivot Grab',
    'pivot grab': 'Pivot Grab',
    'pivot': 'Pivot Grab',
    'dashgrab': 'Dash Grab',
    'dash grab': 'Dash Grab',
    "dashattack": 'Dash Attack',
    "dash attack": 'Dash Attack',
    "DA": 'Dash Attack',
    "da": 'Dash Attack',
};

const frameDataCache = {};

function parseCSV(content) {
    const lines = content.trim().split('\n');
    if (lines.length === 0) return [];
    
    const headers = parseCSVLine(lines[0]);
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length === 0) continue;
        
        const row = {};
        headers.forEach((header, index) => {
            row[header] = values[index] || '';
        });
        rows.push(row);
    }
    
    return rows;
}

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    
    result.push(current.trim());
    return result;
}

async function loadCharacterFrameData(characterSlug, requestedAlias = null) {
    // Handle pipe-separated character names (e.g., "peach | daisy", "samus︱dark samus")
    // For frame data, we use the specific character directory that was requested
    let frameDataSlug = characterSlug;
    
    if (characterSlug.includes('|') || characterSlug.includes('︱') || characterSlug.includes('｜')) {
        // Split on any pipe character variant
        const characters = characterSlug.split(/[|︱｜]/).map(c => c.trim());
        
        // If we know which alias was requested, use that to pick the right character
        if (requestedAlias) {
            // Find which character in the pipe-separated list matches the requested alias
            for (const char of characters) {
                if (char.toLowerCase() === requestedAlias.toLowerCase()) {
                    frameDataSlug = char;
                    break;
                }
            }
            // If no exact match, use the first one
            if (frameDataSlug === characterSlug) {
                frameDataSlug = characters[0];
            }
        } else {
            // Default to first character if no alias provided
            frameDataSlug = characters[0];
        }
    }
    
    // Simon and Richter have separate directories - handle them specifically
    // Simon maps to "simon-richter" in aliases but has separate "simon" and "richter" directories
    if (frameDataSlug === 'simon-richter') {
        if (requestedAlias && (requestedAlias.toLowerCase() === 'richter' || requestedAlias.toLowerCase() === 'richter belmont')) {
            frameDataSlug = 'richter';
        } else {
            frameDataSlug = 'simon';
        }
    }
    
    // Pokemon Trainer characters have pt- prefix in directory names
    const ptCharacters = ['squirtle', 'ivysaur', 'charizard'];
    if (ptCharacters.includes(frameDataSlug)) {
        frameDataSlug = `pt-${frameDataSlug}`;
    }

    // Stats CSV slugs that don't match framedata dir names (e.g. R.O.B. → r-o-b vs dir rob)
    if (FRAMEDATA_SLUG_TO_DIR[frameDataSlug]) {
        frameDataSlug = FRAMEDATA_SLUG_TO_DIR[frameDataSlug];
    }
    
    if (frameDataCache[frameDataSlug]) {
        return frameDataCache[frameDataSlug];
    }

    const characterDir = path.join(FRAMEDATA_DIR, frameDataSlug);
    if (!fs.existsSync(characterDir)) {
        return null;
    }

    const sections = listFramedataSections(frameDataSlug);
    if (!sections || sections.length === 0) {
        return null;
    }

    const frameData = {
        character: characterSlug,
        moves: {}
    };

    for (const section of sections) {
        const raw = await getFramedataCSVRaw(frameDataSlug, section);
        if (raw) {
            try {
                frameData.moves[section] = parseCSV(raw);
            } catch (e) {
                console.error(`Error parsing frame data ${frameDataSlug}/${section}:`, e.message);
            }
        }
    }

    if (Object.keys(frameData.moves).length === 0) {
        return null;
    }

    frameDataCache[frameDataSlug] = frameData;
    return frameData;
}

/** Clear in-memory frame data cache for a character (e.g. after admin saves to S3). */
export function clearFrameDataCache(characterSlug) {
    if (characterSlug) {
        delete frameDataCache[characterSlug];
    } else {
        for (const key of Object.keys(frameDataCache)) {
            delete frameDataCache[key];
        }
    }
}

function normalizeMoveInput(input) {
    const normalized = input.toLowerCase().trim();
    
    if (MOVE_ABBREVIATIONS[normalized]) {
        return MOVE_ABBREVIATIONS[normalized];
    }
    
    return normalized.split(' ').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
}

function findMove(frameData, moveName) {
    if (!frameData) return null;
    
    const normalizedInput = normalizeMoveInput(moveName);
    
    for (const [moveType, moves] of Object.entries(frameData.moves)) {
        for (const move of moves) {
            const moveNameField = move['Move Name'] || '';
            if (moveNameField.toLowerCase() === normalizedInput.toLowerCase()) {
                return { moveType, move };
            }
        }
    }
    
    const searchTerm = normalizedInput.toLowerCase();
    for (const [moveType, moves] of Object.entries(frameData.moves)) {
        for (const move of moves) {
            const moveNameField = move['Move Name'] || '';
            if (moveNameField.toLowerCase().includes(searchTerm)) {
                return { moveType, move };
            }
        }
    }
    
    return null;
}

function detectCharacterAndMoveInText(text, guild) {
    // Enhanced detection that finds character and move pairs with proximity awareness
    const aliasMap = buildCharacterAliasMap(guild);
    const normalizeText = (txt) => txt.toLowerCase()
        .replace(/['']s\b/g, "")
        .replace(/['']/g, "")
        .replace(/[|︱｜]/g, "|")
        .replace(/[^a-z0-9|\s\-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    
    const normalizedText = normalizeText(text);
    const words = normalizedText.split(/\s+/);
    
    // Build a list of all character aliases with their positions and slugs
    const characterMatches = [];
    const aliases = Array.from(aliasMap.keys()).sort((a, b) => b.length - a.length);
    
    for (const alias of aliases) {
        const regex = new RegExp(`\\b${alias.replace(/\s+/g, '\\s+')}\\b`);
        const match = normalizedText.match(regex);
        if (match) {
            characterMatches.push({
                alias: alias,
                slug: aliasMap.get(alias),
                index: match.index,
                length: match[0].length
            });
        }
    }
    
    if (characterMatches.length === 0) return null;
    
    // Sort by position in text to process in order of appearance
    characterMatches.sort((a, b) => a.index - b.index);
    
    // For each character found, look for moves that appear near it
    for (const charMatch of characterMatches) {
        const charEndIndex = charMatch.index + charMatch.length;
        const afterCharText = normalizedText.substring(charEndIndex);
        const beforeCharText = normalizedText.substring(0, charMatch.index);
        
        // Check words after the character mention (within reasonable proximity)
        const wordsAfter = afterCharText.split(/\s+/).slice(0, 5); // Check next 5 words
        const wordsBefore = beforeCharText.split(/\s+/); // Check words before
        
        // Prefer moves found after the character mention
        for (let i = 0; i < wordsAfter.length; i++) {
            const word = wordsAfter[i];
            
            if (MOVE_ABBREVIATIONS[word]) {
                return {
                    character: { slug: charMatch.slug, alias: charMatch.alias },
                    characterSlug: charMatch.slug,
                    move: word
                };
            }
            
            // Check two-word combinations FIRST (before single-word checks)
            // This ensures "dash attack" is caught before just "dash"
            if (i < wordsAfter.length - 1) {
                const twoWord = `${word} ${wordsAfter[i + 1]}`;
                if (MOVE_ABBREVIATIONS[twoWord]) {
                    return {
                        character: { slug: charMatch.slug, alias: charMatch.alias },
                        characterSlug: charMatch.slug,
                        move: twoWord
                    };
                }
                
                // Check for "dash attack", "dash grab", "neutral b", etc.
                if ((word === 'dash' || word === 'neutral' || word === 'side' || word === 'up' || word === 'down') &&
                    (wordsAfter[i + 1].includes('attack') || wordsAfter[i + 1].includes('grab') || 
                     wordsAfter[i + 1].includes('smash') || wordsAfter[i + 1] === 'b')) {
                    return {
                        character: { slug: charMatch.slug, alias: charMatch.alias },
                        characterSlug: charMatch.slug,
                        move: twoWord
                    };
                }
            }
            
            // Now check single-word move patterns (after two-word checks)
            if (word.includes('air') || word.includes('tilt') || word.includes('smash') || 
                word.includes('throw') || word.includes('special') || word === 'jab' || 
                word === 'grab') {
                return {
                    character: { slug: charMatch.slug, alias: charMatch.alias },
                    characterSlug: charMatch.slug,
                    move: word
                };
            }
        }
    }
    
    return null;
}

function parseCharacterAndMove(input, guild) {
    const aliasMap = buildCharacterAliasMap(guild);
    const parts = input.trim().split(/\s+/);
    
    if (parts.length < 2) {
        return null;
    }
    
    // Check for Arsene mode flag
    let arseneMode = false;
    let filteredParts = parts;
    if (parts[0].toLowerCase() === 'arsene') {
        arseneMode = true;
        filteredParts = parts.slice(1);
        
        // If only "arsene" was provided, we can't proceed
        if (filteredParts.length < 1) {
            return null;
        }
        
        // If arsene mode and only a move is provided, auto-resolve to joker
        if (filteredParts.length === 1) {
            const slug = aliasMap.get('joker');
            if (slug) {
                return {
                    character: { slug, alias: 'joker' },
                    characterSlug: slug,
                    move: filteredParts[0],
                    arseneMode: true
                };
            }
            return null;
        }
    }
    
    // For frame data lookups, we want to allow Zelda (unlike matchup queries)
    // So we do our own resolution without the Zelda filtering
    const normalizeText = (text) => text.toLowerCase()
        .replace(/['']s\b/g, "")
        .replace(/['']/g, "")
        .replace(/[|︱｜]/g, "|")
        .replace(/[^a-z0-9|\s\-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    
    const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    for (let i = 1; i < filteredParts.length; i++) {
        const charPart = filteredParts.slice(0, i).join(' ');
        const movePart = filteredParts.slice(i).join(' ');
        
        const normalizedCharPart = normalizeText(charPart);
        const aliases = Array.from(aliasMap.keys()).sort((a, b) => b.length - a.length);
        
        for (const alias of aliases) {
            const pattern = new RegExp(`(^|\\s)${escapeRegex(alias)}(\\s|$)`);
            if (pattern.test(normalizedCharPart)) {
                const slug = aliasMap.get(alias);
                return {
                    character: { slug, alias },
                    characterSlug: slug,
                    move: movePart,
                    arseneMode: arseneMode
                };
            }
        }
    }
    
    return null;
}

function parseGifUrls(move, arseneMode) {
    if (arseneMode && move['ARSENE GIF'] && move['ARSENE GIF'].trim()) {
        return [move['ARSENE GIF'].trim()];
    }
    const raw = (move['GIF URL'] || '').trim();
    if (!raw) return [];
    return raw.split('|').map(u => u.trim()).filter(Boolean);
}

export function createMoveEmbeds(move, characterName, moveType, arseneMode = false) {
    const displayName = arseneMode ? `${characterName} - Arsene` : characterName;
    const title = `${displayName || 'Character'} - ${move['Move Name'] || 'Move'}`;
    const desc = `*${moveType.replace(/_/g, ' ').toUpperCase()}*`;
    const gifUrls = parseGifUrls(move, arseneMode);
    const maxEmbeds = 10;

    const baseEmbed = new EmbedBuilder()
        .setColor('#36AAD4')
        .setTitle(title)
        .setDescription(desc)
        .addFields(
            { name: 'Startup', value: `-# > ${move['Startup'] || '--'}`, inline: true },
            { name: 'Total Frames', value: `-# > ${move['Total Frames'] || '--'}`, inline: true },
            { name: 'End Lag', value: `-# > ${move['End Lag'] || '--'}`, inline: true },
            { name: 'Landing Lag', value: `-# > ${move['Landing Lag'] || '--'}`, inline: true },
            { name: 'Base Damage', value: `-# > ${move['Base Damage'] || '--'}`, inline: true },
            { name: 'On Shield', value: `-# > ${move['On Shield'] || '--'}`, inline: true },
            { name: 'Shield Lag', value: `-# > ${move['Shield Lag'] || '--'}`, inline: true },
            { name: 'Shield Stun', value: `-# > ${move['Shield Stun'] || '--'}`, inline: true },
            { name: 'Active Frames', value: `-# > ${move['Active Frames'] || '--'}`, inline: true }
        );

    if (move['Notes'] && move['Notes'] !== '--') {
        baseEmbed.addFields({ name: 'Notes', value: move['Notes'] });
    }

    const embeds = [];
    if (gifUrls.length === 0) {
        embeds.push(baseEmbed);
    } else {
        const urlsToShow = gifUrls.slice(0, maxEmbeds);
        baseEmbed.setImage(urlsToShow[0]);
        embeds.push(baseEmbed);
        for (let i = 1; i < urlsToShow.length; i++) {
            embeds.push(new EmbedBuilder()
                .setColor('#36AAD4')
                .setTitle(urlsToShow.length > 2 ? `${title} — Hitbox ${i + 1}` : title)
                .setImage(urlsToShow[i]));
        }
    }
    return embeds;
}

/** @deprecated Use createMoveEmbeds for multiple GIF support */
export function createMoveEmbed(move, characterName, moveType, arseneMode = false) {
    return createMoveEmbeds(move, characterName, moveType, arseneMode)[0];
}

export async function handleFrameDataLookup(message, args) {
    const input = args.join(' ');
    
    if (!input) {
        await message.reply(`❌ Usage: \`!fd <character> <move>\` (e.g., \`!fd mario fair\` or \`!fd arsene fsmash\`). For full docs, see https://discord.com/channels/1010002260786430052/1471283116193873983/1471283349824733391`);
        return;
    }
    
    try {
        const parsed = parseCharacterAndMove(input, message.guild);
        
        if (!parsed) {
            await message.reply(`❌ Character not recognized. Try: \`!fd mario fair\`. For full docs, see https://discord.com/channels/1010002260786430052/1471283116193873983/1471283349824733391`);
            return;
        }
        
        const frameData = await loadCharacterFrameData(parsed.characterSlug, parsed.character.alias);

        // Use the actual alias the user provided for display name, not the slug
        const displayName = parsed.character.alias
            .split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
        
        if (!frameData) {
            await message.reply(`❌ No frame data found for ${displayName}.`);
            return;
        }
        
        const found = findMove(frameData, parsed.move);
        
        if (!found) {
            await message.reply(`❌ Move "${parsed.move}" not found for ${displayName}. For full docs, see https://discord.com/channels/1010002260786430052/1471283116193873983/1471283349824733391`);
            return;
        }
        
        const embeds = createMoveEmbeds(found.move, displayName, found.moveType, parsed.arseneMode);
        await message.reply({ embeds });
    } catch (error) {
        console.error('Error in handleFrameDataLookup:', error);
        await message.reply('❌ Error retrieving frame data: ' + error.message);
    }
}

async function buildFrameDataContext(question = '', guild = null, limit = 10) {
    const dirs = fs.readdirSync(FRAMEDATA_DIR).filter(f =>
        fs.statSync(path.join(FRAMEDATA_DIR, f)).isDirectory()
    );

    let context = '';
    let includedChars = new Set();

    // Try to detect if a specific character is mentioned in the question (use normalized text so "King K. Rool" etc. match)
    if (question && guild) {
        const aliasMap = buildCharacterAliasMap(guild);
        const normalizedQuestion = normalizeCharacterText(question);

        // Check all aliases to see if they're in the question (slug may map to different dir name, e.g. r-o-b → rob)
        for (const [alias, slug] of aliasMap.entries()) {
            const frameDataDir = FRAMEDATA_SLUG_TO_DIR[slug] || slug;
            if (normalizedQuestion.includes(alias) && dirs.includes(frameDataDir)) {
                // Add this character first
                const frameData = await loadCharacterFrameData(slug, alias);
                if (frameData) {
                    const charName = slug.replace(/-/g, ' ').split(' ')
                        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                        .join(' ');
                    
                    context += `\n**${charName}:**\n`;
                    
                    for (const [moveType, moves] of Object.entries(frameData.moves)) {
                        context += `*${moveType.replace(/_/g, ' ')}:*\n`;
                        for (const move of moves) {
                            let stats = `Startup: ${move['Startup']}, Damage: ${move['Base Damage']}, On Shield: ${move['On Shield']}`;
                            if (move['Notes'] && move['Notes'].trim() && move['Notes'] !== '--') {
                                stats += `. Note: ${move['Notes'].trim()}`;
                            }
                            context += `- ${move['Move Name']}: ${stats}\n`;
                        }
                    }
                    
                    includedChars.add(slug);
                }
            }
        }
    }
    
    // Fill in remaining slots with other characters (if we have room)
    let charCount = includedChars.size;
    for (const dir of dirs) {
        if (charCount >= limit) break;
        if (includedChars.has(dir)) continue;

        const frameData = await loadCharacterFrameData(dir);
        if (!frameData) continue;
        
        const charName = dir.replace(/-/g, ' ').split(' ')
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
        
        context += `\n**${charName}:**\n`;
        
        for (const [moveType, moves] of Object.entries(frameData.moves)) {
            context += `*${moveType.replace(/_/g, ' ')}:*\n`;
            for (const move of moves.slice(0, 3)) {
                let stats = `Startup: ${move['Startup']}, Damage: ${move['Base Damage']}, On Shield: ${move['On Shield']}`;
                if (move['Notes'] && move['Notes'].trim() && move['Notes'] !== '--') {
                    stats += `. Note: ${move['Notes'].trim()}`;
                }
                context += `- ${move['Move Name']}: ${stats}\n`;
            }
        }

        charCount++;
    }
    
    return context;
}

export async function handleFrameDataQuestion(message, question) {
    if (!question || question.trim().length === 0) {
        await message.reply(`❌ Usage: \`!fdq <your question about frame data>\`. For full docs, see https://discord.com/channels/1010002260786430052/1471283116193873983/1471283349824733391`);
        return;
    }

    try {
        await message.reply(`⏳ Analyzing frame data...`);

        const frameDataContext = await buildFrameDataContext(question, message.guild, 5);

        const fullPrompt = `You are Navi Bot, a helpful assistant for Super Smash Bros Ultimate frame data analysis.

**Frame Data Context:**
${frameDataContext}

**User Question:**
${question}

RULES:
1. Answer only using information from the context above
2. If context doesn't address the question, say you couldn't find relevant data
3. Be concise and provide specific frame values
4. Use Discord markdown formatting (**, *, headings)
5. Keep compact formatting with no extra blank lines
6. Do NOT mention usernames
7. Focus on practical gameplay implications

Provide your answer:`;

        const response = await genAI.models.generateContent({
            model: process.env.GEMINI_MODEL || 'gemini-3-flash-preview',
            contents: fullPrompt
        });

        const answer = (response && (response.text ?? response.candidates?.[0]?.content?.parts?.[0]?.text)) || '';
        if (!answer.trim()) {
            await message.channel.send('❌ No response from the model. Try rephrasing your question.');
            return;
        }

        const embeds = createSplitEmbeds(EmbedBuilder, answer, '#36AAD4', SUMMARY_DISCLAIMER);
        await message.channel.send({ embeds });
        
        // Try to detect if a specific character + move was mentioned and show the GIF
        const parsed = detectCharacterAndMoveInText(question, message.guild);
        if (parsed) {
            const frameData = await loadCharacterFrameData(parsed.characterSlug, parsed.character.alias);
            if (frameData) {
                const found = findMove(frameData, parsed.move);
                if (found && found.move['GIF URL'] && found.move['GIF URL'].trim()) {
                    const displayName = parsed.character.alias
                        .split('-')
                        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                        .join(' ');
                    
                    const moveEmbeds = createMoveEmbeds(found.move, displayName, found.moveType);
                    await message.channel.send({ embeds: moveEmbeds });
                }
            }
        }
    } catch (error) {
        console.error("Error in handleFrameDataQuestion:", error);
        await message.reply("❌ Error processing frame data question: " + error.message);
    }
}

export { parseCharacterAndMove, findMove, normalizeMoveInput, loadCharacterFrameData };