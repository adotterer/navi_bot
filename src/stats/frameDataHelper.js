import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { EmbedBuilder } from 'discord.js';
import { createSplitEmbeds } from '../shared/messageSplitter.js';
import { SUMMARY_DISCLAIMER } from '../shared/responseNotices.js';
import { buildCharacterAliasMap, resolveCharacterFromText } from '../matchups/characterAliases.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRAMEDATA_DIR = path.join(__dirname, '../../data/framedata');

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

function loadCharacterFrameData(characterSlug, requestedAlias = null) {
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
    
    if (frameDataCache[frameDataSlug]) {
        return frameDataCache[frameDataSlug];
    }
    
    const characterDir = path.join(FRAMEDATA_DIR, frameDataSlug);
    
    if (!fs.existsSync(characterDir)) {
        return null;
    }
    
    const frameData = {
        character: characterSlug,
        moves: {}
    };
    
    try {
        const files = fs.readdirSync(characterDir);
        
        for (const file of files) {
            if (!file.endsWith('.csv')) continue;
            
            const moveType = file.replace('.csv', '');
            const filePath = path.join(characterDir, file);
            const content = fs.readFileSync(filePath, 'utf8');
            const moves = parseCSV(content);
            
            frameData.moves[moveType] = moves;
        }
        
        frameDataCache[frameDataSlug] = frameData;
        return frameData;
    } catch (error) {
        console.error(`Error loading frame data for ${frameDataSlug}:`, error.message);
        return null;
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
    
    for (let i = 1; i < parts.length; i++) {
        const charPart = parts.slice(0, i).join(' ');
        const movePart = parts.slice(i).join(' ');
        
        const normalizedCharPart = normalizeText(charPart);
        const aliases = Array.from(aliasMap.keys()).sort((a, b) => b.length - a.length);
        
        for (const alias of aliases) {
            const pattern = new RegExp(`(^|\\s)${escapeRegex(alias)}(\\s|$)`);
            if (pattern.test(normalizedCharPart)) {
                const slug = aliasMap.get(alias);
                return {
                    character: { slug, alias },
                    characterSlug: slug,
                    move: movePart
                };
            }
        }
    }
    
    return null;
}

function createMoveEmbed(move, characterName, moveType) {
    const embed = new EmbedBuilder()
        .setColor('#36AAD4')
        .setTitle(`${characterName || 'Character'} - ${move['Move Name'] || 'Move'}`)
        .setDescription(`*${moveType.replace(/_/g, ' ').toUpperCase()}*`)
        .addFields(
            { name: 'Startup', value: move['Startup'] || '--', inline: true },
            { name: 'Total Frames', value: move['Total Frames'] || '--', inline: true },
            { name: 'End Lag', value: move['End Lag'] || '--', inline: true },
            { name: 'Landing Lag', value: move['Landing Lag'] || '--', inline: true },
            { name: 'Base Damage', value: move['Base Damage'] || '--', inline: true },
            { name: 'On Shield', value: move['On Shield'] || '--', inline: true },
            { name: 'Shield Lag', value: move['Shield Lag'] || '--', inline: true },
            { name: 'Shield Stun', value: move['Shield Stun'] || '--', inline: true },
            { name: 'Active Frames', value: move['Active Frames'] || '--', inline: true }
        );
    
    // Add GIF image if available
    if (move['GIF URL'] && move['GIF URL'].trim()) {
        embed.setImage(move['GIF URL']);
    }
    
    if (move['Notes'] && move['Notes'] !== '--') {
        embed.addFields({ name: 'Notes', value: move['Notes'] });
    }
    
    return embed;
}

export async function handleFrameDataLookup(message, args) {
    const input = args.join(' ');
    
    if (!input) {
        await message.reply("❌ Usage: !fd <character> <move> (e.g., `!fd mario fair` or `!fd falco dair`)");
        return;
    }
    
    try {
        const parsed = parseCharacterAndMove(input, message.guild);
        
        if (!parsed) {
            await message.reply("❌ Character not recognized. Try: `!fd mario fair`");
            return;
        }
        
        const frameData = loadCharacterFrameData(parsed.characterSlug, parsed.character.alias);
        
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
            await message.reply(`❌ Move "${parsed.move}" not found for ${displayName}.`);
            return;
        }
        
        const embed = createMoveEmbed(found.move, displayName, found.moveType);
        await message.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error in handleFrameDataLookup:', error);
        await message.reply('❌ Error retrieving frame data: ' + error.message);
    }
}

function buildFrameDataContext(question = '', guild = null, limit = 10) {
    const dirs = fs.readdirSync(FRAMEDATA_DIR).filter(f => 
        fs.statSync(path.join(FRAMEDATA_DIR, f)).isDirectory()
    );
    
    let context = '';
    let includedChars = new Set();
    
    // Try to detect if a specific character is mentioned in the question
    if (question && guild) {
        const aliasMap = buildCharacterAliasMap(guild);
        const questionLower = question.toLowerCase();
        
        // Check all aliases to see if they're in the question
        for (const [alias, slug] of aliasMap.entries()) {
            if (questionLower.includes(alias) && dirs.includes(slug)) {
                // Add this character first
                const frameData = loadCharacterFrameData(slug, alias);
                if (frameData) {
                    const charName = slug.replace(/-/g, ' ').split(' ')
                        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                        .join(' ');
                    
                    context += `\n**${charName}:**\n`;
                    
                    for (const [moveType, moves] of Object.entries(frameData.moves)) {
                        context += `*${moveType.replace(/_/g, ' ')}:*\n`;
                        for (const move of moves) {
                            const stats = `Startup: ${move['Startup']}, Damage: ${move['Base Damage']}, On Shield: ${move['On Shield']}`;
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
        
        const frameData = loadCharacterFrameData(dir);
        if (!frameData) continue;
        
        const charName = dir.replace(/-/g, ' ').split(' ')
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
        
        context += `\n**${charName}:**\n`;
        
        for (const [moveType, moves] of Object.entries(frameData.moves)) {
            context += `*${moveType.replace(/_/g, ' ')}:*\n`;
            for (const move of moves.slice(0, 3)) {
                const stats = `Startup: ${move['Startup']}, Damage: ${move['Base Damage']}, On Shield: ${move['On Shield']}`;
                context += `- ${move['Move Name']}: ${stats}\n`;
            }
        }
        
        charCount++;
    }
    
    return context;
}

export async function handleFrameDataQuestion(message, question) {
    if (!question || question.trim().length === 0) {
        await message.reply("❌ Usage: !fdq <your question about frame data>");
        return;
    }

    try {
        await message.reply(`⏳ Analyzing frame data...`);

        const frameDataContext = buildFrameDataContext(question, message.guild, 5);

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

        const answer = response.text;
        
        const embeds = createSplitEmbeds(EmbedBuilder, answer, '#36AAD4', SUMMARY_DISCLAIMER);
        await message.channel.send({ embeds });
        
        // Try to detect if a specific character + move was mentioned and show the GIF
        const parsed = detectCharacterAndMoveInText(question, message.guild);
        if (parsed) {
            const frameData = loadCharacterFrameData(parsed.characterSlug, parsed.character.alias);
            if (frameData) {
                const found = findMove(frameData, parsed.move);
                if (found && found.move['GIF URL'] && found.move['GIF URL'].trim()) {
                    const displayName = parsed.character.alias
                        .split('-')
                        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                        .join(' ');
                    
                    const moveEmbed = createMoveEmbed(found.move, displayName, found.moveType);
                    await message.channel.send({ embeds: [moveEmbed] });
                }
            }
        }
    } catch (error) {
        console.error("Error in handleFrameDataQuestion:", error);
        await message.reply("❌ Error processing frame data question: " + error.message);
    }
}

export { parseCharacterAndMove, findMove, normalizeMoveInput, loadCharacterFrameData };