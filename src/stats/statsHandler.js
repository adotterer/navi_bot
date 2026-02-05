import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { EmbedBuilder } from 'discord.js';
import { buildCharacterAliasMap, resolveCharacterFromText } from '../matchups/characterAliases.js';
import { createSplitEmbeds } from '../shared/messageSplitter.js';
import { SUMMARY_DISCLAIMER } from '../shared/responseNotices.js';
import { loadCharacterFrameData, findMove, parseCharacterAndMove } from './frameDataHelper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATS_DIR = path.join(__dirname, '../../data/stats');

const genAI = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    defaultModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp'
});

// Cache for CSV data
const statsCache = {};

// Map CSV filenames to display names
const statDisplayNames = {
    'air-acceleration': 'Air Acceleration',
    'air-speed': 'Air Speed',
    'backward-rolls': 'Backward Rolls',
    'dash-and-run-speed': 'Dash and Run Speed',
    'dash-turnaround': 'Dash Turnaround',
    'fall-speed': 'Fall Speed',
    'forward-rolls': 'Forward Rolls',
    'grab-range': 'Grab Range',
    'gravity': 'Gravity',
    'jump-durations': 'Jump Durations',
    'jump-height': 'Jump Height',
    'landing': 'Landing',
    'ledge-stats': 'Ledge Stats',
    'neutral-air-dodges': 'Neutral Air Dodges',
    'out-of-shield': 'Out of Shield',
    'reflectors': 'Reflectors',
    'spot-dodges': 'Spot Dodges',
    'walk-speed': 'Walk Speed',
    'weight': 'Weight'
};

// Read a CSV file and parse it (with caching)
function readStatCSV(statName) {
    // Check cache first
    if (statsCache[statName]) {
        return statsCache[statName];
    }
    
    const csvPath = path.join(STATS_DIR, `${statName}.csv`);
    
    if (!fs.existsSync(csvPath)) {
        return null;
    }
    
    const content = fs.readFileSync(csvPath, 'utf8');
    const lines = content.trim().split('\n');
    
    if (lines.length < 2) {
        return null;
    }
    
    const headers = parseCSVLine(lines[0]);
    const data = [];
    
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        const row = {};
        
        headers.forEach((header, index) => {
            row[header] = values[index] || '';
        });
        
        data.push(row);
    }
    
    const result = { headers, data };
    
    // Cache the result
    statsCache[statName] = result;
    
    return result;
}

// Parse CSV line handling quoted values
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            inQuotes = !inQuotes;
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

// Find character data in CSV
function findCharacterInCSV(data, characterName) {
    // Normalize character name for comparison
    const normalized = characterName.toLowerCase().replace(/[^a-z0-9]/g, '');
    
    for (const row of data) {
        const rowChar = row.Character.toLowerCase().replace(/[^a-z0-9]/g, '');
        
        // Check if character name matches (handle variations like "Samus/Dark Samus")
        if (rowChar.includes(normalized) || normalized.includes(rowChar)) {
            return row;
        }
    }
    
    return null;
}

// Handle !stats <stat-name> <character> OR !stats <character> <move> for frame data
export async function handleStatsLookup(message, args) {
    try {
        console.log(`📊 Stats lookup request from ${message.author.tag}: args =`, args);
        
        if (args.length < 2) {
            const availableStats = Object.keys(statDisplayNames).join(', ');
            return message.reply(`Usage: \`!stats <stat-name> <character>\` or \`!stats <character> <move>\`\nExample: \`!stats air-acceleration incin\` or \`!stats mario fair\`\n\n**Available stats:**\n${availableStats}`);
        }
        
        // Try to detect if this is a frame data query (character + move)
        const fullInput = args.join(' ').toLowerCase();
        const parsed = parseCharacterAndMove(fullInput, message.guild);
        
        if (parsed) {
            // This looks like a frame data query
            const frameData = loadCharacterFrameData(parsed.characterSlug);
            
            if (frameData) {
                const found = findMove(frameData, parsed.move);
                
                if (found) {
                    // Successfully found frame data, use that instead
                    const embed = new EmbedBuilder()
                        .setColor('#FF6B9D')
                        .setTitle(`${parsed.character.name} - ${found.move['Move Name'] || 'Move'}`)
                        .setDescription(`*${found.moveType.replace(/_/g, ' ').toUpperCase()}*`)
                        .addFields(
                            { name: 'Startup', value: found.move['Startup'] || '--', inline: true },
                            { name: 'Total Frames', value: found.move['Total Frames'] || '--', inline: true },
                            { name: 'End Lag', value: found.move['End Lag'] || '--', inline: true },
                            { name: 'Landing Lag', value: found.move['Landing Lag'] || '--', inline: true },
                            { name: 'Base Damage', value: found.move['Base Damage'] || '--', inline: true },
                            { name: 'On Shield', value: found.move['On Shield'] || '--', inline: true },
                            { name: 'Shield Lag', value: found.move['Shield Lag'] || '--', inline: true },
                            { name: 'Shield Stun', value: found.move['Shield Stun'] || '--', inline: true },
                            { name: 'Active Frames', value: found.move['Active Frames'] || '--', inline: true }
                        );
                    
                    if (found.move['Notes'] && found.move['Notes'] !== '--') {
                        embed.addFields({ name: 'Notes', value: found.move['Notes'] });
                    }
                    
                    return message.reply({ embeds: [embed] });
                }
            }
        }
        
        // Otherwise, treat as a regular stat lookup
        const statName = args[0].toLowerCase();
        const characterInput = args.slice(1).join(' ').toLowerCase();
        
        console.log(`📊 Stat: ${statName}, Character input: ${characterInput}`);
        
        // Resolve character alias
        const aliasMap = buildCharacterAliasMap(message.guild);
        
        // For stats, we need to handle zelda like any other character
        // so we can't use resolveCharacterFromText since it filters out zelda
        // Instead, manually resolve from the alias map
        const normalizedInput = characterInput.toLowerCase()
            .replace(/['']s\b/g, "")
            .replace(/['']/g, "")
            .replace(/[|︱｜]/g, "|")
            .replace(/[^a-z0-9|\s\-]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        
        let resolvedSlug = null;
        
        // Try direct lookup in alias map
        if (aliasMap.has(normalizedInput)) {
            resolvedSlug = aliasMap.get(normalizedInput);
            console.log(`📊 Found in alias map: ${normalizedInput} -> ${resolvedSlug}`);
        } else {
            // Try a more lenient search
            for (const [alias, slug] of aliasMap.entries()) {
                if (alias.includes(normalizedInput) || normalizedInput.includes(alias)) {
                    resolvedSlug = slug;
                    console.log(`📊 Found partial match: ${normalizedInput} -> ${resolvedSlug}`);
                    break;
                }
            }
        }
        
        if (!resolvedSlug) {
            console.log(`📊 Character not found. Alias map has:`, Array.from(aliasMap.keys()).slice(0, 10));
            return message.reply(`❌ Character "${characterInput}" not recognized. Try using a character name or nickname.`);
        }
        
        // Read the CSV
        const csvData = readStatCSV(statName);
        
        console.log(`📊 CSV data loaded: ${csvData ? 'yes' : 'no'}, rows: ${csvData?.data?.length || 0}`);
        
        if (!csvData) {
            const availableStats = Object.keys(statDisplayNames).join(', ');
            return message.reply(`❌ Stat "${statName}" not found.\n\n**Available stats:**\n${availableStats}`);
        }
        
        // Find the character in the data
        const characterData = findCharacterInCSV(csvData.data, resolvedSlug);
        
        console.log(`📊 Character data found: ${characterData ? 'yes' : 'no'}`);
        
        if (!characterData) {
            return message.reply(`❌ No data found for ${resolvedSlug} in ${statDisplayNames[statName] || statName}.`);
        }
        
        // Format the response as an embed
        const displayName = statDisplayNames[statName] || statName;
        const charDisplayName = characterData.Character;
        
        let statsText = '';
        
        // Add all values except the character name
        Object.entries(characterData).forEach(([key, value]) => {
            if (key !== 'Character' && value) {
                statsText += `**${key}:** ${value}\n`;
            }
        });
        
        const embed = new EmbedBuilder()
            .setColor("#36AAD4")
            .setTitle(`📊 ${displayName}`)
            .setDescription(`**${charDisplayName}**\n\n${statsText}`)
        
        console.log(`📊 Sending response for ${charDisplayName}`);
        message.reply({ embeds: [embed] });
        
    } catch (error) {
        console.error('❌ Error in handleStatsLookup:', error);
        message.reply('❌ Sorry, I encountered an error looking up that stat. Check the bot logs for details.');
    }
}

// Handle !sq <question> - AI-powered stats questions
export async function handleStatsQuestion(message, question) {
    if (!question || question.trim().length === 0) {
        return message.reply('Usage: `!sq <question>`\nExample: `!sq who has faster air acceleration, zelda or mii gunner?`');
    }
    
    // Send status message to let user know we're working on it
    await message.reply('📊 Searching character data for your answer...');
    
    try {
        // Get all available stats data
        const allStatsData = {};
        const statFiles = fs.readdirSync(STATS_DIR).filter(f => f.endsWith('.csv'));
        
        for (const file of statFiles) {
            const statName = file.replace('.csv', '');
            const data = readStatCSV(statName);
            if (data) {
                allStatsData[statName] = data;
            }
        }
        
        // Build context for AI - only include relevant stats based on question
        const relevantStats = getRelevantStats(question);
        const statsContext = buildStatsContext(allStatsData, relevantStats);
        
        const prompt = `You are a Super Smash Bros. Ultimate stats expert. Answer the following question using ONLY the provided stats data. Be concise and specific.

STATS DATA:
${statsContext}

QUESTION: ${question}

Provide a clear, factual answer based on the data. If comparing characters, show the relevant numbers. If asking about superlatives (fastest, heaviest, etc.), identify the character and their value.

Format your answer using Discord markdown, similar to this:

**Sonic** is faster than **Zelda** in every speed category:

<:6symbolnavi:1341400385709019138> **Run Speed: **Sonic (3.85) vs. Zelda (1.43)
<:6symbolnavi:1341400385709019138>**Dash Speed:** Sonic (2.31) vs. Zelda (1.958)
<:6symbolnavi:1341400385709019138>**Walk Speed: **Sonic (1.444) vs. Zelda (0.914)
<:6symbolnavi:1341400385709019138>**Air Speed: **Sonic (1.208) vs. Zelda (1.092)

Provide your answer here:`;
        
        const response = await genAI.models.generateContent({
            model: process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp',
            contents: prompt
        });
        const aiResponse = response.text;
        
        const embeds = createSplitEmbeds(EmbedBuilder, aiResponse, "#36AAD4");
        message.channel.send({ embeds });
        
    } catch (error) {
        console.error('Error in handleStatsQuestion:', error);
        message.reply('❌ Sorry, I encountered an error processing your stats question.');
    }
}

// Get relevant stats based on question keywords
function getRelevantStats(question) {
    const keywords = question.toLowerCase();
    const relevant = new Set();
    
    // Speed-related keywords
    if (keywords.match(/speed|fast|quick|dash|run|walk/)) {
        relevant.add('air-speed');
        relevant.add('dash-and-run-speed');
        relevant.add('walk-speed');
    }
    
    // Weight/heaviness
    if (keywords.match(/weight|heavy|light/)) {
        relevant.add('weight');
    }
    
    // Fall/gravity
    if (keywords.match(/fall|gravity/)) {
        relevant.add('fall-speed');
        relevant.add('gravity');
    }
    
    // Jump height
    if (keywords.match(/jump|height/)) {
        relevant.add('jump-height');
        relevant.add('jump-durations');
    }
    
    // Recovery/ledge
    if (keywords.match(/recovery|ledge|edge|offstage/)) {
        relevant.add('ledge-stats');
        relevant.add('fall-speed');
        relevant.add('gravity');
    }
    
    // Grab/range
    if (keywords.match(/grab|range|reach/)) {
        relevant.add('grab-range');
    }
    
    // Shield/OOS
    if (keywords.match(/shield|oos|punish|landing/)) {
        relevant.add('out-of-shield');
        relevant.add('landing');
    }
    
    // Dodging
    if (keywords.match(/dodge|roll/)) {
        relevant.add('neutral-air-dodges');
        relevant.add('forward-rolls');
        relevant.add('backward-rolls');
    }
    
    // If no matches, return all stats
    if (relevant.size === 0) {
        return Object.keys(statDisplayNames);
    }
    
    return Array.from(relevant);
}

// Build a text summary of stats for AI context
function buildStatsContext(allStatsData, statNames = null) {
    let context = '';
    
    // If no specific stats provided, use all
    const statsToInclude = statNames || Object.keys(allStatsData);
    
    for (const statName of statsToInclude) {
        if (!allStatsData[statName]) continue;
        
        const csvData = allStatsData[statName];
        const displayName = statDisplayNames[statName] || statName;
        context += `\n## ${displayName}\n`;
        
        csvData.data.forEach(row => {
            context += formatRowForContext(row);
        });
    }
    
    return context;
}

function formatRowForContext(row) {
    const values = Object.entries(row)
        .filter(([key]) => key !== 'Character')
        .map(([_, value]) => value)
        .join(', ');
    
    return `${row.Character}: ${values}\n`;
}