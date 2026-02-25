/**
 * Download frame data hitbox images from ultimateframedata.com and upload to S3.
 * Uses assets/framedata/ prefix (kept separate from Assets manager UI).
 * Falls back to Playwright (browser) for URLs that return Access Denied with axios.
 *
 * Run: node local_app_only/uploadFrameDataImages.js
 *       node local_app_only/uploadFrameDataImages.js --start-from=wario --overwrite=wario
 * Requires: AWS credentials, S3_BUCKET_NAME, and local data/framedata/ or S3 admin/data/framedata/
 */
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import fs from 'fs';
import pLimit from 'p-limit';
import {
    listFramedataCharacters,
    listFramedataSections,
} from '../src/shared/dataReader.js';
import { uploadBufferToS3, headS3Key } from '../src/shared/s3Helper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRAMEDATA_DIR = path.join(__dirname, '../data/framedata');
const ASSETS_FRAMEDATA_PREFIX = 'assets/framedata/';
const ULTIMATE_FRAMEDATA_BASE = 'https://ultimateframedata.com';
const CONCURRENCY = 10; // Process this many URLs in parallel

/** Parse CSV and extract GIF URL values from the last column (GIF URL). */
function extractGifUrlsFromCsv(raw) {
    const urls = new Set();
    if (!raw || typeof raw !== 'string') return urls;
    const lines = raw.trim().split('\n');
    if (lines.length < 2) return urls;
    const headers = parseCSVLine(lines[0]);
    const gifCol = headers.findIndex((h) => (h || '').toLowerCase().includes('gif'));
    if (gifCol < 0) return urls;
    for (let i = 1; i < lines.length; i++) {
        const vals = parseCSVLine(lines[i]);
        const cell = vals[gifCol] || '';
        for (const u of cell.split('|').map((x) => x.trim()).filter(Boolean)) {
            if (u.startsWith('http') && u.includes('ultimateframedata.com')) {
                urls.add(u);
            }
        }
    }
    return urls;
}

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
            inQuotes = !inQuotes;
        } else if (inQuotes) {
            current += c === '"' && line[i + 1] === '"' ? '"' : c;
        } else if (c === ',') {
            result.push(current.trim());
            current = '';
        } else {
            current += c;
        }
    }
    result.push(current.trim());
    return result;
}

/** Extract path from ultimateframedata.com URL for S3 key. */
function urlToS3Path(url) {
    try {
        const parsed = new URL(url);
        const pathPart = (parsed.pathname || '').replace(/^\/+/, '');
        if (!pathPart) return null;
        return ASSETS_FRAMEDATA_PREFIX + pathPart;
    } catch (_) {
        return null;
    }
}

/** Extract character slug from URL path, e.g. hitboxes/wario/WarioBike.gif → wario */
function getCharacterFromUrl(url) {
    try {
        const parsed = new URL(url);
        const segments = (parsed.pathname || '').split('/').filter(Boolean);
        if (segments.length >= 2 && segments[0] === 'hitboxes') {
            return segments[1].toLowerCase();
        }
    } catch (_) {}
    return null;
}

/** Parse --start-from=X and --overwrite=X,Y from argv */
function parseArgs() {
    const startFrom = process.argv.find((a) => a.startsWith('--start-from='))?.split('=')[1]?.toLowerCase() || null;
    const overwriteArg = process.argv.find((a) => a.startsWith('--overwrite='))?.split('=')[1];
    const overwriteChars = overwriteArg ? new Set(overwriteArg.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) : new Set();
    return { startFrom, overwriteChars };
}

/** Fetch URL via Playwright browser (bypasses bot protection). Returns { body, contentType } or null. */
async function fetchWithPlaywright(url) {
    let browser;
    try {
        const { chromium } = await import('playwright');
        browser = await chromium.launch();
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        });
        const resp = await context.request.get(url, {
            timeout: 15000,
            headers: { Referer: 'https://ultimateframedata.com/' },
        });
        if (!resp.ok()) return null;
        const buf = await resp.body();
        const contentType = resp.headers()['content-type'] || 'image/gif';
        return { body: Buffer.from(buf), contentType };
    } catch (_) {
        return null;
    } finally {
        if (browser) await browser.close();
    }
}

async function main() {
    console.log('📥 Collecting frame data CSV sources...\n');

    const csvSources = [];
    const localChars = listFramedataCharacters();
    for (const char of localChars) {
        const sections = listFramedataSections(char);
        for (const section of sections) {
            csvSources.push({ character: char, section });
        }
    }

    console.log(`Found ${csvSources.length} CSV files to scan.\n`);

    const allUrls = new Set();
    for (const { character, section } of csvSources) {
        const filePath = path.join(FRAMEDATA_DIR, character, section + '.csv');
        try {
            if (fs.existsSync(filePath)) {
                const raw = fs.readFileSync(filePath, 'utf8');
                for (const u of extractGifUrlsFromCsv(raw)) {
                    allUrls.add(u);
                }
            }
        } catch (_) { /* skip unreadable */ }
    }

    let urlList = Array.from(allUrls).sort();

    const { startFrom, overwriteChars } = parseArgs();
    if (startFrom) {
        urlList = urlList.filter((url) => {
            const char = getCharacterFromUrl(url);
            return char && char.localeCompare(startFrom, undefined, { sensitivity: 'base' }) >= 0;
        });
        console.log(`Filtered to ${urlList.length} URLs (--start-from=${startFrom})\n`);
    }
    if (overwriteChars.size) {
        console.log(`Will overwrite existing for: ${[...overwriteChars].join(', ')}\n`);
    }

    console.log(`Found ${urlList.length} unique image URLs from ultimateframedata.com.\n`);

    if (urlList.length === 0) {
        console.log('Nothing to upload.');
        return;
    }

    let uploaded = 0;
    let skipped = 0;
    let failed = 0;

    console.log(`Starting upload loop (${CONCURRENCY} concurrent)...\n`);

    const limit = pLimit(CONCURRENCY);

    const processOne = async (url) => {
        const s3Key = urlToS3Path(url);
        if (!s3Key) return { uploaded: 0, skipped: 0, failed: 1 };

        const char = getCharacterFromUrl(url);
        const shouldOverwrite = overwriteChars.has(char);

        if (!shouldOverwrite) {
            let exists = false;
            try {
                exists = await Promise.race([
                    headS3Key(s3Key),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000)),
                ]);
            } catch (_) {}
            if (exists) return { uploaded: 0, skipped: 1, failed: 0 };
        }

        let buf = null;
        let contentType = 'image/gif';
        try {
            const resp = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': 'https://ultimateframedata.com/',
                },
            });
            buf = Buffer.from(resp.data);
            contentType = resp.headers['content-type'] || contentType;
        } catch (err) {
            const msg = (err.message || '').toLowerCase();
            if (msg.includes('access denied') || msg.includes('403') || msg.includes('forbidden') || err.response?.status === 403) {
                const pw = await fetchWithPlaywright(url);
                if (pw) {
                    buf = pw.body;
                    contentType = pw.contentType;
                }
            }
        }
        if (!buf) return { uploaded: 0, skipped: 0, failed: 1 };
        try {
            await uploadBufferToS3(s3Key, buf, contentType);
            return { uploaded: 1, skipped: 0, failed: 0 };
        } catch (upErr) {
            console.log(`\n  ❌ Upload failed: ${url} - ${upErr.message || upErr}`);
            return { uploaded: 0, skipped: 0, failed: 1 };
        }
    };

    let completed = 0;
    const tasks = urlList.map((url) =>
        limit(async () => {
            const r = await processOne(url);
            completed++;
            if (completed % 200 === 0 || completed === urlList.length) {
                process.stdout.write(`  Progress: ${completed}/${urlList.length}\r`);
            }
            return r;
        })
    );
    const results = await Promise.all(tasks);

    for (const r of results) {
        uploaded += r.uploaded;
        skipped += r.skipped;
        failed += r.failed;
    }

    console.log(`\n\n✅ Done. Uploaded: ${uploaded}, Skipped (already in S3): ${skipped}, Failed: ${failed}`);
    console.log(`\nImages are stored at S3 key prefix: ${ASSETS_FRAMEDATA_PREFIX}`);
    console.log(`Served at: /assets/framedata/... (ensure APP_BASE_URL is set for Discord embeds)`);
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
