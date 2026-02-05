import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { buildCharacterAliasMap, resolveCharacterFromText } from '../matchups/characterAliases.js';

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

// Handle !stats <stat-name> <character>
export async function handleStatsLookup(message, args) {
    try {
        console.log(`📊 Stats lookup request from ${message.author.tag}: args =`, args);
        
        if (args.length < 2) {
            const availableStats = Object.keys(statDisplayNames).join(', ');
            return message.reply(`Usage: \`!stats <stat-name> <character>\`\nExample: \`!stats air-acceleration incin\`\n\n**Available stats:**\n${availableStats}`);
        }
        
        const statName = args[0].toLowerCase();
        const characterInput = args.slice(1).join(' ').toLowerCase();
        
        console.log(`📊 Stat: ${statName}, Character input: ${characterInput}`);
        
        // Resolve character alias
        const aliasMap = buildCharacterAliasMap();
        const resolvedSlug = resolveCharacterFromText(characterInput, aliasMap);
        
        console.log(`📊 Resolved character slug: ${resolvedSlug}`);
        
        if (!resolvedSlug) {
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
        
        // Format the response
        const displayName = statDisplayNames[statName] || statName;
        const charDisplayName = characterData.Character;
        
        let response = `📊 **${displayName}** - ${charDisplayName}\n\n`;
        
        // Add all values except the character name
        Object.entries(characterData).forEach(([key, value]) => {
            if (key !== 'Character' && value) {
                response += `**${key}:** ${value}\n`;
            }
        });
        
        console.log(`📊 Sending response for ${charDisplayName}`);
        message.reply(response.trim());
        
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
        
        // Build context for AI
        const statsContext = buildStatsContext(allStatsData);
        
        const prompt = `You are a Super Smash Bros. Ultimate stats expert. Answer the following question using ONLY the provided stats data. Be concise and specific.

STATS DATA:
${statsContext}

QUESTION: ${question}

Provide a clear, factual answer based on the data. If comparing characters, show the relevant numbers. If asking about superlatives (fastest, heaviest, etc.), identify the character and their value.`;
        
        const response = await genAI.models.generateContent({
            model: process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp',
            contents: prompt
        });
        const aiResponse = response.text;
        
        message.reply(`📊 **Stats Answer:**\n\n${aiResponse}`);
        
    } catch (error) {
        console.error('Error in handleStatsQuestion:', error);
        message.reply('❌ Sorry, I encountered an error processing your stats question.');
    }
}

// Build a text summary of all stats for AI context
function buildStatsContext(allStatsData) {
    let context = '';
    
    for (const [statName, csvData] of Object.entries(allStatsData)) {
        const displayName = statDisplayNames[statName] || statName;
        context += `\n## ${displayName}\n`;
        
        // Include all data for accurate comparisons
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