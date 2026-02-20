/**
 * Read-only codebase tools for the AI agent: list_directory, read_file, getFileTree.
 * When running with a local git clone, uses filesystem. When no clone but GITHUB_TOKEN + GITHUB_REPO, uses GitHub API.
 */
import fs from 'fs';
import path from 'path';
import { Octokit } from '@octokit/rest';

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

/** True when we have a local git clone (so we use filesystem). */
function hasGitClone() {
    const candidates = [WORKSPACE_ROOT, process.cwd()];
    for (const dir of candidates) {
        if (dir && fs.existsSync(path.join(dir, '.git'))) return true;
    }
    return false;
}

/** Parse GITHUB_REPO (owner/repo). Used when no local clone. */
function getRepoFromEnv() {
    const envRepo = process.env.GITHUB_REPO;
    if (!envRepo || !/^[^/]+\/[^/]+$/.test(envRepo.trim())) return null;
    const [owner, repo] = envRepo.trim().split('/');
    return { owner, repo: repo.replace(/\.git$/, '') };
}

/** When true, use GitHub API for listDirectory/readFile/getFileTree (ref = default branch). */
const GITHUB_MODE = !hasGitClone() && !!process.env.GITHUB_TOKEN && !!getRepoFromEnv();

/** Cached default branch for GitHub mode (lazy-filled). */
let defaultBranchPromise = null;
async function getDefaultBranch() {
    if (!GITHUB_MODE) return 'main';
    if (defaultBranchPromise) return defaultBranchPromise;
    const repo = getRepoFromEnv();
    if (!repo) return 'main';
    defaultBranchPromise = (async () => {
        try {
            const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
            const { data } = await octokit.repos.get({ owner: repo.owner, repo: repo.repo });
            return data.default_branch || 'main';
        } catch (_) {
            return 'main';
        }
    })();
    return defaultBranchPromise;
}

/**
 * Resolve and validate a path: must be under WORKSPACE_ROOT and not in excluded dirs.
 * @param {string} relativePath - Path relative to workspace (e.g. '' or 'src/admin').
 * @returns {{ ok: true, absolute: string } | { ok: false, error: string }}
 */
function resolvePath(relativePath) {
    const raw = (relativePath || '').trim();
    if (raw === '' || raw === '.') {
        return { ok: true, absolute: WORKSPACE_ROOT };
    }
    const normalized = path.normalize(raw).replace(/^\.[/\\]/, '');
    if (normalized.includes('..') || path.isAbsolute(normalized)) {
        return { ok: false, error: 'Path is outside workspace' };
    }
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

/** Validate relative path for GitHub API (no absolute resolution). */
function validateRelativePath(relativePath) {
    const raw = (relativePath || '').trim();
    if (raw === '' || raw === '.') return { ok: true, relative: '' };
    const normalized = path.normalize(raw).replace(/^\.[/\\]/, '');
    if (normalized.includes('..') || path.isAbsolute(normalized)) return { ok: false, error: 'Invalid path' };
    const segments = normalized.split(path.sep).filter(Boolean);
    for (const seg of segments) {
        if (EXCLUDED_DIRS.has(seg)) return { ok: false, error: 'Path may not include ' + seg };
    }
    return { ok: true, relative: normalized };
}

/**
 * List direct children of a directory (files and folders).
 * @param {string} dirPath - Path relative to workspace (e.g. 'src' or '' for root).
 * @returns {Promise<{ ok: true, entries: Array<{ name: string, type: 'file'|'dir' }> } | { ok: false, error: string }>}
 */
export async function listDirectory(dirPath) {
    if (GITHUB_MODE) {
        const v = validateRelativePath(dirPath);
        if (!v.ok) return v;
        const repo = getRepoFromEnv();
        const ref = await getDefaultBranch();
        try {
            const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
            const { data } = await octokit.repos.getContent({
                owner: repo.owner,
                repo: repo.repo,
                path: v.relative || undefined,
                ref,
            });
            if (!Array.isArray(data)) return { ok: false, error: 'Directory not found' };
            const entries = data
                .filter((e) => !EXCLUDED_DIRS.has(e.name))
                .map((e) => ({ name: e.name, type: e.type === 'dir' ? 'dir' : 'file' }));
            return { ok: true, entries };
        } catch (err) {
            if (err.status === 404) return { ok: false, error: 'Directory not found' };
            return { ok: false, error: err.message || String(err) };
        }
    }
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
 * @returns {Promise<{ ok: true, content: string } | { ok: false, error: string }>}
 */
export async function readFile(filePath) {
    if (GITHUB_MODE) {
        const v = validateRelativePath(filePath);
        if (!v.ok) return v;
        const repo = getRepoFromEnv();
        const ref = await getDefaultBranch();
        try {
            const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
            const { data } = await octokit.repos.getContent({
                owner: repo.owner,
                repo: repo.repo,
                path: v.relative,
                ref,
            });
            if (Array.isArray(data) || data.type !== 'file') return { ok: false, error: 'Not a file' };
            let content = data.content;
            if (data.encoding === 'base64') content = Buffer.from(content, 'base64').toString('utf8');
            else if (typeof content !== 'string') content = String(content ?? '');
            if (Buffer.byteLength(content, 'utf8') > MAX_FILE_SIZE) return { ok: false, error: 'File too large (max 256KB)' };
            if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(content)) return { ok: false, error: 'Binary or unsupported file type' };
            return { ok: true, content };
        } catch (err) {
            if (err.status === 404) return { ok: false, error: 'File not found' };
            return { ok: false, error: err.message || String(err) };
        }
    }
    const resolved = resolvePath(filePath);
    if (!resolved.ok) return resolved;
    try {
        const stat = fs.statSync(resolved.absolute);
        if (!stat.isFile()) return { ok: false, error: 'Not a file' };
        if (stat.size > MAX_FILE_SIZE) return { ok: false, error: 'File too large (max 256KB)' };
        const ext = path.extname(resolved.absolute).slice(1).toLowerCase();
        if (ext && !TEXT_EXTENSIONS.has(ext)) return { ok: false, error: 'Binary or unsupported file type' };
        const content = fs.readFileSync(resolved.absolute, 'utf8');
        return { ok: true, content };
    } catch (err) {
        if (err.code === 'ENOENT') return { ok: false, error: 'File not found' };
        if (err.code === 'EISDIR') return { ok: false, error: 'Is a directory' };
        return { ok: false, error: err.message };
    }
}

/**
 * Shallow file tree for a prefix (e.g. first 2 levels). Used by Researcher for codebase structure.
 * @param {string} prefix - Path relative to workspace (e.g. 'src' or '').
 * @param {number} maxDepth - Max depth (default 2).
 * @returns {Promise<{ ok: true, tree: object } | { ok: false, error: string }>}
 */
export async function getFileTree(prefix = '', maxDepth = 2) {
    if (GITHUB_MODE) {
        const v = validateRelativePath(prefix);
        if (!v.ok) return v;
        const repo = getRepoFromEnv();
        const ref = await getDefaultBranch();
        const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
        async function walk(dirPath, currentDepth) {
            if (currentDepth > maxDepth) return null;
            try {
                const { data } = await octokit.repos.getContent({
                    owner: repo.owner,
                    repo: repo.repo,
                    path: dirPath || undefined,
                    ref,
                });
                if (!Array.isArray(data)) return null;
                const obj = {};
                for (const e of data) {
                    if (EXCLUDED_DIRS.has(e.name)) continue;
                    if (e.type === 'dir') {
                        const child = await walk(e.path, currentDepth + 1);
                        obj[e.name + '/'] = child != null ? child : [];
                    } else {
                        obj[e.name] = 'file';
                    }
                }
                return obj;
            } catch (_) {
                return null;
            }
        }
        const tree = await walk(v.relative || undefined, 0);
        return { ok: true, tree: tree || {} };
    }
    const resolved = resolvePath(prefix);
    if (!resolved.ok) return resolved;
    try {
        function walkSync(dir, currentDepth) {
            if (currentDepth > maxDepth) return null;
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            const obj = {};
            for (const e of entries) {
                if (e.name.startsWith('.') || EXCLUDED_DIRS.has(e.name)) continue;
                const full = path.join(dir, e.name);
                if (e.isDirectory()) {
                    const child = walkSync(full, currentDepth + 1);
                    obj[e.name + '/'] = child != null ? child : [];
                } else {
                    obj[e.name] = 'file';
                }
            }
            return obj;
        }
        const tree = walkSync(resolved.absolute, 0);
        return { ok: true, tree: tree || {} };
    } catch (err) {
        if (err.code === 'ENOENT') return { ok: false, error: 'Path not found' };
        return { ok: false, error: err.message };
    }
}

export { WORKSPACE_ROOT, resolvePath };
