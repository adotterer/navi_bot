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
    'fair': 'Forward Air',
    'bair': 'Back Air',
    'uair': 'Up Air',
    'dair': 'Down Air',
    'nair': 'Neutral Air',
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
    'dthrow': 'Down Throw',
    'fsmash': 'Forward Smash',
    'usmash': 'Up Smash',
    'dsmash': 'Down Smash',
    'ftilt': 'Forward Tilt',
    'utilt': 'Up Tilt',
    'dtilt': 'Down Tilt',
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

function loadCharacterFrameData(characterSlug) {
    if (frameDataCache[characterSlug]) {
        return frameDataCache[characterSlug];
    }
    
    const characterDir = path.join(FRAMEDATA_DIR, characterSlug);
    
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
        
        frameDataCache[characterSlug] = frameData;
        return frameData;
    } catch (error) {
        console.error(`Error loading frame data for ${characterSlug}:`, error.message);
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

function parseCharacterAndMove(input, guild) {
    const aliasMap = buildCharacterAliasMap(guild);
    const parts = input.trim().split(/\s+/);
    
    if (parts.length < 2) {
        return null;
    }
    
    for (let i = 1; i < parts.length; i++) {
        const charPart = parts.slice(0, i).join(' ');
        const movePart = parts.slice(i).join(' ');
        
        const match = resolveCharacterFromText(charPart, aliasMap);
        if (match) {
            return {
                character: match,
                characterSlug: match.slug,
                move: movePart
            };
        }
    }
    
    return null;
}

function createMoveEmbed(move, characterName, moveType) {
    const embed = new EmbedBuilder()
        .setColor('#36AAD4')
        .setTitle(`${characterName} - ${move['Move Name'] || 'Move'}`)
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
        
        const frameData = loadCharacterFrameData(parsed.characterSlug);
        
        if (!frameData) {
            await message.reply(`❌ No frame data found for ${parsed.character.name}.`);
            return;
        }
        
        const found = findMove(frameData, parsed.move);
        
        if (!found) {
            await message.reply(`❌ Move "${parsed.move}" not found for ${parsed.character.name}.`);
            return;
        }
        
        const embed = createMoveEmbed(found.move, parsed.character.name, found.moveType);
        await message.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error in handleFrameDataLookup:', error);
        await message.reply('❌ Error retrieving frame data: ' + error.message);
    }
}

function buildFrameDataContext(limit = 5) {
    const dirs = fs.readdirSync(FRAMEDATA_DIR).filter(f => 
        fs.statSync(path.join(FRAMEDATA_DIR, f)).isDirectory()
    );
    
    let context = '';
    let charCount = 0;
    
    for (const dir of dirs) {
        if (charCount >= limit) break;
        
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

        const frameDataContext = buildFrameDataContext(10);

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
        
        const embeds = createSplitEmbeds(EmbedBuilder, answer, "#FF6B9D", SUMMARY_DISCLAIMER);
        await message.channel.send({ embeds });
    } catch (error) {
        console.error("Error in handleFrameDataQuestion:", error);
        await message.reply("❌ Error processing frame data question: " + error.message);
    }
}

export { parseCharacterAndMove, findMove, normalizeMoveInput, loadCharacterFrameData };