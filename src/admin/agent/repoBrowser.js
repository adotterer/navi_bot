/**
 * Read-only repo browser: list branches, tree at path, file content at ref.
 * Uses git ls-tree and git show so we never checkout (safe for concurrent use).
 */
import path from 'path';
import fs from 'fs';
import { Buffer } from 'node:buffer';
import { simpleGit } from 'simple-git';
import { WORKSPACE_ROOT } from './codebaseTools.js';

const EXCLUDED_DIRS = new Set(['.git', 'node_modules']);
const MAX_FILE_SIZE = 512 * 1024;

/** Resolve directory that actually contains .git so git commands work (cwd can differ from WORKSPACE_ROOT). */
function resolveRepoRoot() {
    const candidates = [path.resolve(WORKSPACE_ROOT), process.cwd()];
    for (const dir of candidates) {
        if (dir && fs.existsSync(path.join(dir, '.git'))) return dir;
    }
    return path.resolve(WORKSPACE_ROOT);
}

const REPO_ROOT = resolveRepoRoot();
/** In production (e.g. EB) the app is deployed as a zip without .git; repo browser only works in a clone. */
const REPO_AVAILABLE = fs.existsSync(path.join(REPO_ROOT, '.git'));
const git = simpleGit({ baseDir: REPO_ROOT });

function safeRelativePath(input) {
    const raw = (input || '').trim();
    if (raw === '' || raw === '.') return '';
    const normalized = path.normalize(raw).replace(/^\.[/\\]/, '');
    if (normalized === '' || normalized === '.') return '';
    if (normalized.includes('..') || path.isAbsolute(normalized)) return null;
    return normalized;
}

/**
 * @returns {Promise<{ ok: true, current: string, branches: string[], repoUnavailable?: boolean } | { ok: false, error: string }>}
 */
export async function listBranches() {
    if (!REPO_AVAILABLE) {
        return { ok: true, current: 'main', branches: ['main'], repoUnavailable: true };
    }
    try {
        const summary = await git.branchLocal();
        const current = summary.current;
        const branches = summary.all || [];
        return { ok: true, current: current || 'main', branches: branches.length ? branches : ['main'] };
    } catch (err) {
        return { ok: false, error: err.message || String(err) };
    }
}

/**
 * List tree at ref:path (dirs and files). Excludes .git and node_modules.
 * @param {string} ref - Branch name or HEAD
 * @param {string} dirPath - Relative path (e.g. '' or 'src/admin')
 * @returns {Promise<{ ok: true, entries: Array<{ name: string, type: 'dir'|'file', path: string }> } | { ok: false, error: string }>}
 */
export async function getTree(ref, dirPath) {
    if (!REPO_AVAILABLE) return { ok: false, error: 'Repo browser not available (no git in this environment)' };
    const safe = safeRelativePath(dirPath);
    if (safe === null) return { ok: false, error: 'Invalid path' };
    const refTrim = typeof ref === 'string' ? ref.trim() : '';
    if (!refTrim) return { ok: false, error: 'Branch required' };
    try {
        // Root: git ls-tree ref (no path). Subdirs: git ls-tree ref:path.
        const args = safe ? ['ls-tree', refTrim + ':' + safe] : ['ls-tree', refTrim];
        const out = await git.raw(args);
        let rawStr = '';
        if (typeof out === 'string') rawStr = out;
        else if (Buffer.isBuffer(out)) rawStr = out.toString('utf8');
        else if (out != null && typeof (out.stdOut ?? out.stdout) === 'string') rawStr = out.stdOut ?? out.stdout;
        else if (out != null && typeof out.toString === 'function') rawStr = String(out);
        const lines = rawStr.trim() ? rawStr.trim().split('\n') : [];
        const entries = [];
        for (const line of lines) {
            let match = line.match(/^\d{6}\s+(blob|tree)\s+\S+\t(.+)$/);
            if (!match) match = line.match(/^\d{6}\s+(blob|tree)\s+\S+\s+(.+)$/);
            if (!match) continue;
            const typeStr = match[1];
            const name = match[2].trim();
            if (!name || EXCLUDED_DIRS.has(name)) continue;
            const fullPath = safe ? safe + '/' + name : name;
            entries.push({ name, type: typeStr === 'tree' ? 'dir' : 'file', path: fullPath });
        }
        entries.sort((a, b) => {
            if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });
        return { ok: true, entries };
    } catch (err) {
        const msg = err.message || String(err);
        if (msg.includes('Not a valid object')) return { ok: false, error: 'Path not found' };
        return { ok: false, error: msg };
    }
}

/**
 * Get file content at ref:path. Fails for binary or oversized.
 * @param {string} ref
 * @param {string} filePath
 * @returns {Promise<{ ok: true, content: string } | { ok: false, error: string }>}
 */
export async function getFileContent(ref, filePath) {
    if (!REPO_AVAILABLE) return { ok: false, error: 'Repo browser not available (no git in this environment)' };
    const safe = safeRelativePath(filePath);
    if (safe === null) return { ok: false, error: 'Invalid path' };
    try {
        const out = await git.raw(['show', ref + ':' + safe]);
        const content = out != null ? String(out) : '';
        if (Buffer.byteLength(content, 'utf8') > MAX_FILE_SIZE) return { ok: false, error: 'File too large' };
        if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(content)) return { ok: false, error: 'Binary file' };
        return { ok: true, content };
    } catch (err) {
        if (err.message && err.message.includes('exists on disk')) return { ok: false, error: 'Not a file' };
        return { ok: false, error: err.message || String(err) };
    }
}
