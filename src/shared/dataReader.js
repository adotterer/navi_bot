/**
 * Read/write stats and framedata CSVs. Admin UI: S3 first (admin/data/stats/, admin/data/framedata/), then disk (data/stats, data/framedata).
 * Used by admin routes; bot can use this for S3 overrides.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchFromS3Raw, putToS3 } from './s3Helper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATS_DIR = path.join(__dirname, '../../data/stats');
const FRAMEDATA_DIR = path.join(__dirname, '../../data/framedata');
const S3_STATS_PREFIX = 'admin/data/stats/';
const S3_FRAMEDATA_PREFIX = 'admin/data/framedata/';

const statsCache = {};
const framedataCache = {};

function safeReaddir(dir, opts = {}) {
    try {
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
        return fs.readdirSync(dir, opts);
    } catch {
        return [];
    }
}

// ----- Stats -----

export function listStatsFiles() {
    const files = safeReaddir(STATS_DIR).filter(f => f.endsWith('.csv'));
    return files.map(f => f.replace(/\.csv$/i, ''));
}

export async function getStatsCSVRaw(statName) {
    const key = statName.replace(/\.csv$/i, '');
    if (statsCache[key] !== undefined) return statsCache[key];
    const s3Key = S3_STATS_PREFIX + key + '.csv';
    const fromS3 = await fetchFromS3Raw(s3Key);
    if (fromS3 != null) {
        statsCache[key] = fromS3;
        return fromS3;
    }
    const filePath = path.join(STATS_DIR, key + '.csv');
    try {
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf8');
            return raw;
        }
    } catch (e) {
        console.error('dataReader getStatsCSVRaw:', e.message);
    }
    return null;
}

export function clearStatsCache(statName) {
    const key = (statName || '').replace(/\.csv$/i, '');
    if (key) delete statsCache[key];
}

export async function putStatsCSV(statName, rawContent) {
    const key = statName.replace(/\.csv$/i, '');
    const s3Key = S3_STATS_PREFIX + key + '.csv';
    await putToS3(s3Key, rawContent, 'text/csv');
    clearStatsCache(key);
}

// ----- Framedata -----

export function listFramedataCharacters() {
    const dirs = safeReaddir(FRAMEDATA_DIR).filter(f => {
        const full = path.join(FRAMEDATA_DIR, f);
        return fs.statSync(full).isDirectory();
    });
    return dirs.sort((a, b) => a.localeCompare(b));
}

export function listFramedataSections(characterSlug) {
    const dir = path.join(FRAMEDATA_DIR, characterSlug);
    const files = safeReaddir(dir).filter(f => f.endsWith('.csv'));
    return files.map(f => f.replace(/\.csv$/i, ''));
}

export async function getFramedataCSVRaw(characterSlug, section) {
    const sectionClean = (section || '').replace(/\.csv$/i, '');
    const cacheKey = characterSlug + ':' + sectionClean;
    if (framedataCache[cacheKey] !== undefined) return framedataCache[cacheKey];
    const s3Key = S3_FRAMEDATA_PREFIX + characterSlug + '/' + sectionClean + '.csv';
    const fromS3 = await fetchFromS3Raw(s3Key);
    if (fromS3 != null) {
        framedataCache[cacheKey] = fromS3;
        return fromS3;
    }
    const filePath = path.join(FRAMEDATA_DIR, characterSlug, sectionClean + '.csv');
    try {
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf8');
            return raw;
        }
    } catch (e) {
        console.error('dataReader getFramedataCSVRaw:', e.message);
    }
    return null;
}

export function clearFramedataCache(characterSlug) {
    const prefix = (characterSlug || '') + ':';
    for (const k of Object.keys(framedataCache)) {
        if (k.startsWith(prefix)) delete framedataCache[k];
    }
}

export async function putFramedataCSV(characterSlug, section, rawContent) {
    const sectionClean = (section || '').replace(/\.csv$/i, '');
    const s3Key = S3_FRAMEDATA_PREFIX + characterSlug + '/' + sectionClean + '.csv';
    await putToS3(s3Key, rawContent, 'text/csv');
    clearFramedataCache(characterSlug);
}
