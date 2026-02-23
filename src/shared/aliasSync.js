/**
 * Sync character aliases to/from S3 so state persists across Beanstalk deploys.
 * Key: admin/character-aliases.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchFromS3Raw, putToS3 } from './s3Helper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ALIASES_PATH = path.join(__dirname, '../../data/character-aliases.json');
const S3_KEY = 'admin/character-aliases.json';

/**
 * Fetch aliases JSON from S3 and write to local file. Call at app startup so
 * Beanstalk instances get the latest state. No-op if S3 key missing or credentials invalid.
 */
export async function syncAliasesFromS3() {
    try {
        const raw = await fetchFromS3Raw(S3_KEY);
        if (raw != null && raw.trim()) {
            const data = JSON.parse(raw);
            if (data && typeof data === 'object' && !Array.isArray(data)) {
                fs.writeFileSync(ALIASES_PATH, JSON.stringify(data, null, 2), 'utf8');
            }
        }
    } catch (err) {
        if (err.name === 'NoSuchKey' || err.Code === 'NoSuchKey') return;
        throw err;
    }
}

/**
 * Upload aliases JSON to S3. Used by admin save.
 */
export async function putAliasesToS3(jsonString) {
    await putToS3(S3_KEY, jsonString, 'application/json');
}

/**
 * Fetch aliases JSON from S3. Returns null if key not found or on error.
 */
export async function fetchAliasesFromS3() {
    try {
        return await fetchFromS3Raw(S3_KEY);
    } catch (err) {
        if (err.name === 'NoSuchKey' || err.Code === 'NoSuchKey') return null;
        throw err;
    }
}

/**
 * Update a single alias mapping in S3.
 */
export async function updateAliasInS3(alias, canonical) {
    const raw = await fetchAliasesFromS3();
    let data = {};
    if (raw != null && raw.trim()) {
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                data = parsed;
            }
        } catch (err) {}
    }
    data[alias.toLowerCase()] = canonical;
    await putAliasesToS3(JSON.stringify(data, null, 2));
}
