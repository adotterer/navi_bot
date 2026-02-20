/**
 * Sync Discord emoji library to/from S3 so state persists across deploys.
 * Key: admin/discord-emojis.json
 * Format: array of { label: string, code: string } e.g. { "label": "Navi bullet", "code": "<:6symbolnavi:1341400385709019138>" }
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchFromS3Raw, putToS3 } from './s3Helper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const EMOJIS_PATH = path.join(__dirname, '../../data/discord-emojis.json');
const S3_KEY = 'admin/discord-emojis.json';

const DEFAULT_EMOJIS = [
    { label: 'Navi bullet', code: '<:6symbolnavi:1341400385709019138>' },
    { label: 'Ganon hazard', code: '<:6acnlganon:1341460148161609930>' },
    { label: 'Farore tip', code: '<a:6mcgoddessservingfarore:1343330440240693270>' },
    { label: 'Nayru tip', code: '<a:6mcgoddessservingnayru:1343320090984054817>' },
    { label: 'Din tip', code: '<a:6mcgoddessservingdin:1341429490177413120>' },
    { label: 'Farore hazard', code: '<a:6mcgoddesslookingfarore:1343332732738080918>' },
    { label: 'Nayru hazard', code: '<a:6mcgoddesslookingnayru:1343327209590620171>' },
    { label: 'Din hazard', code: '<a:6mcgoddesslookingdin:1343327832675192922>' },
];

function ensureArray(data) {
    if (Array.isArray(data)) return data.filter((e) => e && typeof e.label === 'string' && typeof e.code === 'string');
    return [];
}

/**
 * Load emoji library from local file. Returns default list if file missing or invalid.
 */
export function getEmojiLibrary() {
    try {
        const raw = fs.readFileSync(EMOJIS_PATH, 'utf8');
        const data = JSON.parse(raw);
        const list = ensureArray(data);
        return list.length > 0 ? list : DEFAULT_EMOJIS;
    } catch (_) {
        return DEFAULT_EMOJIS;
    }
}

/**
 * Write emoji library to local file.
 */
export function saveEmojiLibrary(list) {
    const arr = ensureArray(list);
    fs.writeFileSync(EMOJIS_PATH, JSON.stringify(arr, null, 2), 'utf8');
}

/**
 * Fetch emojis JSON from S3 and write to local file. Call at app startup.
 */
export async function syncEmojisFromS3() {
    try {
        const raw = await fetchFromS3Raw(S3_KEY);
        if (raw != null && raw.trim()) {
            const data = JSON.parse(raw);
            const list = ensureArray(data);
            if (list.length > 0) {
                fs.writeFileSync(EMOJIS_PATH, JSON.stringify(list, null, 2), 'utf8');
            }
        }
    } catch (err) {
        if (err.name === 'NoSuchKey' || err.Code === 'NoSuchKey') return;
        throw err;
    }
}

/**
 * Upload emojis JSON to S3.
 */
export async function putEmojisToS3(jsonString) {
    await putToS3(S3_KEY, jsonString, 'application/json');
}

/**
 * Fetch emojis JSON from S3. Returns null if key not found or on error.
 */
export async function fetchEmojisFromS3() {
    try {
        return await fetchFromS3Raw(S3_KEY);
    } catch (err) {
        if (err.name === 'NoSuchKey' || err.Code === 'NoSuchKey') return null;
        throw err;
    }
}
