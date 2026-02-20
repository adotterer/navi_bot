/**
 * Read-only codebase tools for the AI agent: list_directory, read_file.
 * All paths are resolved relative to workspace root and validated (no path traversal, no .git/node_modules).
 */
import fs from 'fs';
import path from 'path';

const WORKSPACE_ROOT = path.resolve(process.env.WORKSPACE_ROOT || process.cwd());

/** Paths that are never allowed (relative segments to exclude). */
const EXCLUDED_DIRS = new Set(['.git', 'node_modules', '.env', 'dist', 'coverage']);

/** Max file size to read (bytes). */
const MAX_FILE_SIZE = 256 * 1024;

/** Text extensions we allow for read_file (others are treated as binary). */
const TEXT_EXTENSIONS = new Set([
    'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'json', 'md', 'txt', 'html', 'css', 'scss',
    'yml', 'yaml', 'xml', 'sh', 'bash', 'env', 'example', 'gitignore', 'cursorignore'
]);

/**
 * Resolve and validate a path: must be under WORKSPACE_ROOT and not in excluded dirs.
 * @param {string} relativePath - Path relative to workspace (e.g. '' or 'src/admin').
 * @returns {{ ok: true, absolute: string } | { ok: false, error: string }}
 */
function resolvePath(relativePath) {
    const normalized = path.normalize(relativePath || '.').replace(/^\.[/\\]/, '');
    const absolute = path.resolve(WORKSPACE_ROOT, normalized);
    if (!absolute.startsWith(WORKSPACE_ROOT)) {
        return { ok: false, error: 'Path is outside workspace' };
    }
    const segments = path.relative(WORKSPACE_ROOT, absolute).split(path.sep).filter(Boolean);
    for (const seg of segments) {
        if (EXCLUDED_DIRS.has(seg)) {
            return { ok: false, error: 'Path may not include ' + seg };
        }
    }
    return { ok: true, absolute };
}

/**
 * List direct children of a directory (files and folders).
 * @param {string} dirPath - Path relative to workspace (e.g. 'src' or '' for root).
 * @returns {{ ok: true, entries: Array<{ name: string, type: 'file'|'dir' }> } | { ok: false, error: string }}
 */
export function listDirectory(dirPath) {
    const resolved = resolvePath(dirPath);
    if (!resolved.ok) return resolved;
    try {
        const entries = fs.readdirSync(resolved.absolute, { withFileTypes: true });
        const result = entries
            .filter((e) => !e.name.startsWith('.') && !EXCLUDED_DIRS.has(e.name))
            .map((e) => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }));
        return { ok: true, entries: result };
    } catch (err) {
        if (err.code === 'ENOENT') return { ok: false, error: 'Directory not found' };
        if (err.code === 'ENOTDIR') return { ok: false, error: 'Not a directory' };
        return { ok: false, error: err.message };
    }
}

/**
 * Read file contents (text only; binary and oversized files rejected).
 * @param {string} filePath - Path relative to workspace (e.g. 'src/app.js').
 * @returns {{ ok: true, content: string } | { ok: false, error: string }}
 */
export function readFile(filePath) {
    const resolved = resolvePath(filePath);
    if (!resolved.ok) return resolved;
    try {
        const stat = fs.statSync(resolved.absolute);
        if (!stat.isFile()) {
            return { ok: false, error: 'Not a file' };
        }
        if (stat.size > MAX_FILE_SIZE) {
            return { ok: false, error: 'File too large (max 256KB)' };
        }
        const ext = path.extname(resolved.absolute).slice(1).toLowerCase();
        if (ext && !TEXT_EXTENSIONS.has(ext)) {
            return { ok: false, error: 'Binary or unsupported file type' };
        }
        const content = fs.readFileSync(resolved.absolute, 'utf8');
        return { ok: true, content };
    } catch (err) {
        if (err.code === 'ENOENT') return { ok: false, error: 'File not found' };
        if (err.code === 'EISDIR') return { ok: false, error: 'Is a directory' };
        return { ok: false, error: err.message };
    }
}

/**
 * Optional: shallow file tree for a prefix (e.g. first 2 levels).
 * @param {string} prefix - Path relative to workspace (e.g. 'src' or '').
 * @param {number} maxDepth - Max depth (default 2).
 * @returns {{ ok: true, tree: object } | { ok: false, error: string }}
 */
export function getFileTree(prefix = '', maxDepth = 2) {
    const resolved = resolvePath(prefix);
    if (!resolved.ok) return resolved;
    try {
        function walk(dir, currentDepth) {
            if (currentDepth > maxDepth) return null;
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            const obj = {};
            for (const e of entries) {
                if (e.name.startsWith('.') || EXCLUDED_DIRS.has(e.name)) continue;
                const full = path.join(dir, e.name);
                if (e.isDirectory()) {
                    const child = walk(full, currentDepth + 1);
                    obj[e.name + '/'] = child != null ? child : [];
                } else {
                    obj[e.name] = 'file';
                }
            }
            return obj;
        }
        const tree = walk(resolved.absolute, 0);
        return { ok: true, tree: tree || {} };
    } catch (err) {
        if (err.code === 'ENOENT') return { ok: false, error: 'Path not found' };
        return { ok: false, error: err.message };
    }
}

export { WORKSPACE_ROOT, resolvePath };
