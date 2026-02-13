import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadCharacterFrameData, findMove, normalizeMoveInput } from '../stats/frameDataHelper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATS_DIR = path.join(__dirname, '../../data/stats');

const statsCache = {};

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

const MOVE_TERMS = new Map([
    ['nair', 'Neutral Air'],
    ['fair', 'Forward Air'],
    ['bair', 'Back Air'],
    ['uair', 'Up Air'],
    ['dair', 'Down Air'],
    ['zair', 'Z Air'],
    ['jab', 'Jab'],
    ['dash attack', 'Dash Attack'],
    ['dashattack', 'Dash Attack'],
    ['da', 'Dash Attack'],
    ['fsmash', 'Forward Smash'],
    ['forward smash', 'Forward Smash'],
    ['usmash', 'Up Smash'],
    ['up smash', 'Up Smash'],
    ['upsmash', 'Up Smash'],
    ['dsmash', 'Down Smash'],
    ['down smash', 'Down Smash'],
    ['downsmash', 'Down Smash'],
    ['ftilt', 'Forward Tilt'],
    ['forward tilt', 'Forward Tilt'],
    ['utilt', 'Up Tilt'],
    ['up tilt', 'Up Tilt'],
    ['uptilt', 'Up Tilt'],
    ['dtilt', 'Down Tilt'],
    ['down tilt', 'Down Tilt'],
    ['downtilt', 'Down Tilt'],
    ['grab', 'Grab'],
    ['dash grab', 'Dash Grab'],
    ['pivot grab', 'Pivot Grab'],
    ['fthrow', 'Forward Throw'],
    ['forward throw', 'Forward Throw'],
    ['bthrow', 'Backward Throw'],
    ['back throw', 'Backward Throw'],
    ['uthrow', 'Up Throw'],
    ['up throw', 'Up Throw'],
    ['dthrow', 'Down Throw'],
    ['down throw', 'Down Throw'],
    ['neutral b', 'Neutral B'],
    ['neutralb', 'Neutral B'],
    ['side b', 'Side B'],
    ['sideb', 'Side B'],
    ['up b', 'Up B'],
    ['upb', 'Up B'],
    ['down b', 'Down B'],
    ['downb', 'Down B']
]);

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

function readStatCSV(statName) {
    if (statsCache[statName]) return statsCache[statName];

    const csvPath = path.join(STATS_DIR, `${statName}.csv`);
    if (!fs.existsSync(csvPath)) return null;

    const content = fs.readFileSync(csvPath, 'utf8');
    const lines = content.trim().split('\n');
    if (lines.length < 2) return null;

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
    statsCache[statName] = result;
    return result;
}

function normalizeKey(value) {
    return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function displayNameFromSlug(slug) {
    return slug
        .split(/[-\s|︱｜]+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function buildCharacterCandidates(slug, alias) {
    const candidates = new Set();

    if (alias) candidates.add(alias);
    if (slug) candidates.add(slug);

    if (slug) {
        const parts = slug.split(/[|︱｜]/).map((p) => p.trim()).filter(Boolean);
        for (const part of parts) {
            candidates.add(part);
            candidates.add(displayNameFromSlug(part));
        }
        candidates.add(displayNameFromSlug(slug));
    }

    return Array.from(candidates).filter(Boolean);
}

function findCharacterRow(data, candidates) {
    for (const row of data) {
        const rowChar = normalizeKey(row.Character);
        if (!rowChar) continue;

        for (const candidate of candidates) {
            const normalized = normalizeKey(candidate);
            if (!normalized) continue;
            if (rowChar.includes(normalized) || normalized.includes(rowChar)) {
                return row;
            }
        }
    }

    return null;
}

function formatStatRow(statName, row, headers) {
    const displayName = statDisplayNames[statName] || statName;
    const valueHeaders = headers.filter((h) => h !== 'Character');
    const values = valueHeaders
        .map((header) => `${header}: ${row[header] || '--'}`)
        .join(', ');
    return `${displayName}: ${values}`;
}

function buildStatsBlock(slug, alias) {
    const candidates = buildCharacterCandidates(slug, alias);
    const lines = [];

    for (const statName of Object.keys(statDisplayNames)) {
        const result = readStatCSV(statName);
        if (!result) continue;

        const row = findCharacterRow(result.data, candidates);
        if (!row) continue;

        lines.push(formatStatRow(statName, row, result.headers));
    }

    if (lines.length === 0) return null;

    const displayName = displayNameFromSlug(alias || slug);
    return `STATS: ${displayName}\n${lines.join('\n')}`;
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectMoveMentions(text, frameData) {
    if (!text || !frameData) return [];

    const lowerText = text.toLowerCase();
    const mentions = new Set();

    for (const [term, moveName] of MOVE_TERMS.entries()) {
        const pattern = new RegExp(`\\b${escapeRegex(term)}\\b`, 'i');
        if (pattern.test(lowerText)) {
            mentions.add(moveName);
        }
    }

    const moveNames = new Set();
    for (const moves of Object.values(frameData.moves || {})) {
        for (const move of moves) {
            const moveNameField = move['Move Name'];
            if (moveNameField) moveNames.add(moveNameField);
        }
    }

    for (const moveName of moveNames) {
        const normalized = moveName.toLowerCase();
        if (normalized.length < 3) continue;
        const pattern = new RegExp(`\\b${escapeRegex(normalized)}\\b`, 'i');
        if (pattern.test(lowerText)) {
            mentions.add(moveName);
        }
    }

    return Array.from(mentions);
}

function formatMoveData(found) {
    if (!found || !found.move) return null;

    const moveName = found.move['Move Name'] || 'Move';
    const moveType = (found.moveType || '').replace(/_/g, ' ');
    const fields = [
        'Startup',
        'On Shield',
        'Base Damage',
        'Total Frames',
        'End Lag',
        'Landing Lag',
        'Active Frames',
        'Notes'
    ];

    const parts = [];
    for (const field of fields) {
        const value = found.move[field];
        if (value && value !== '--') {
            parts.push(`${field}: ${value}`);
        }
    }

    if (parts.length === 0) return null;

    return `${moveName} (${moveType}): ${parts.join(', ')}`;
}

function buildFrameDataBlock(slug, alias, textSource) {
    const frameData = loadCharacterFrameData(slug, alias);
    if (!frameData) return null;

    const moves = detectMoveMentions(textSource, frameData);
    if (moves.length === 0) return null;

    const lines = [];
    for (const moveName of moves) {
        const normalized = normalizeMoveInput(moveName);
        const found = findMove(frameData, normalized);
        const formatted = formatMoveData(found);
        if (formatted) lines.push(formatted);
        if (lines.length >= 12) break;
    }

    if (lines.length === 0) return null;

    const displayName = displayNameFromSlug(alias || slug);
    return `FRAME DATA: ${displayName}\n${lines.join('\n')}`;
}

function buildReferenceBlock(slug, alias, textSource) {
    const blocks = [];

    const frameBlock = buildFrameDataBlock(slug, alias, textSource);
    if (frameBlock) blocks.push(frameBlock);

    const statsBlock = buildStatsBlock(slug, alias);
    if (statsBlock) blocks.push(statsBlock);

    return blocks.join('\n');
}

export function buildMatchupReferenceData({ opponentSlug, opponentAlias, messages, question }) {
    const textParts = [];

    if (Array.isArray(messages)) {
        for (const msg of messages) {
            if (msg?.content) textParts.push(msg.content);
            if (msg?.replyingToContent) textParts.push(msg.replyingToContent);
        }
    }

    if (question) textParts.push(question);

    const textSource = textParts.join(' \n ');
    const blocks = [];

    const opponentBlock = buildReferenceBlock(opponentSlug, opponentAlias, textSource);
    if (opponentBlock) blocks.push(opponentBlock);

    const zeldaBlock = buildReferenceBlock('zelda', 'zelda', textSource);
    if (zeldaBlock) blocks.push(zeldaBlock);

    return blocks.join('\n\n');
}
