#!/usr/bin/env node
/**
 * Upload assets (images or other files) from your Downloads folder (or given path) to S3
 * and print the public URL(s). Uses project .env (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
 * AWS_REGION, S3_BUCKET_NAME).
 *
 * Usage:
 *   node scripts/upload-assets-to-s3.js <filename> [filename2 ...]   # file(s) from ~/Downloads
 *   node scripts/upload-assets-to-s3.js /path/to/file.png            # full path
 *   node scripts/upload-assets-to-s3.js stage-list-na.png --prefix stage-lists/
 *
 * Options:
 *   --prefix <path>   S3 key prefix (e.g. stage-lists/). Trailing slash optional.
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { uploadBufferToS3 } from '../src/shared/s3Helper.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DOWNLOADS = path.join(process.env.HOME || process.env.USERPROFILE || '', 'Downloads');

const EXT_TO_CONTENT_TYPE = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
};

function getContentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return EXT_TO_CONTENT_TYPE[ext] || 'application/octet-stream';
}

function resolveFilePath(arg) {
    if (path.isAbsolute(arg)) return arg;
    const fromDownloads = path.join(DOWNLOADS, arg);
    if (fs.existsSync(fromDownloads)) return fromDownloads;
    const fromCwd = path.resolve(process.cwd(), arg);
    if (fs.existsSync(fromCwd)) return fromCwd;
    return fromDownloads; // let it fail with ENOENT and clear error
}

function parseArgs(argv) {
    const args = argv.slice(2);
    const files = [];
    let prefix = '';
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--prefix' && args[i + 1]) {
            prefix = args[++i].trim().replace(/\/*$/, '') + '/';
            continue;
        }
        if (!args[i].startsWith('--')) files.push(args[i]);
    }
    return { files, prefix };
}

async function main() {
    const { files, prefix } = parseArgs(process.argv);

    if (files.length === 0) {
        console.error('Usage: node scripts/upload-assets-to-s3.js <filename> [filename2 ...] [--prefix stage-lists/]');
        console.error('  Filenames are looked up in ~/Downloads unless you pass an absolute path.');
        process.exit(1);
    }

    if (!process.env.S3_BUCKET_NAME) {
        console.error('Missing S3_BUCKET_NAME in .env. Credentials: AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY, or AUTH_DYNAMODB_ID + AUTH_DYNAMODB_SECRET, or default chain (~/.aws/credentials, SSO).');
        process.exit(1);
    }

    for (const fileArg of files) {
        const filePath = resolveFilePath(fileArg);
        if (!fs.existsSync(filePath)) {
            console.error('File not found:', filePath);
            continue;
        }
        const buffer = fs.readFileSync(filePath);
        const contentType = getContentType(filePath);
        const baseName = path.basename(filePath);
        const key = prefix ? `${prefix}${baseName}` : baseName;

        try {
            const url = await uploadBufferToS3(key, buffer, contentType);
            console.log(url);
        } catch (err) {
            console.error('Upload failed for', filePath, err.message);
        }
    }
}

main();
