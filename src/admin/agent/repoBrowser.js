/**
 * Read-only repo browser: list branches, tree at path, file content at ref.
 * Uses local git when available; falls back to GitHub API when no clone (e.g. production).
 */
import path from 'path';
import fs from 'fs';
import { Buffer } from 'node:buffer';
import { simpleGit } from 'simple-git';
import { Octokit } from '@octokit/rest';
import { WORKSPACE_ROOT } from './codebaseTools.js';

const EXCLUDED_DIRS = new Set(['.git', 'node_modules']);
const MAX_FILE_SIZE = 512 * 1024;
/** Max size of combined diff text returned (chars) to avoid token overflow. */
const MAX_DIFF_CHARS = 100 * 1024;

/** Resolve directory that actually contains .git so git commands work (cwd can differ from WORKSPACE_ROOT). */
function resolveRepoRoot() {
    const candidates = [path.resolve(WORKSPACE_ROOT), process.cwd()];
    for (const dir of candidates) {
        if (dir && fs.existsSync(path.join(dir, '.git'))) return dir;
    }
    return path.resolve(WORKSPACE_ROOT);
}

/** Parse GITHUB_REPO (owner/repo) when there is no local git. */
function getRepoFromEnv() {
    const envRepo = process.env.GITHUB_REPO;
    if (!envRepo || !/^[^/]+\/[^/]+$/.test(envRepo.trim())) return null;
    const [owner, repo] = envRepo.trim().split('/');
    return { owner, repo: repo.replace(/\.git$/, '') };
}

const REPO_ROOT = resolveRepoRoot();
/** True when we have a local git clone. */
const REPO_AVAILABLE = fs.existsSync(path.join(REPO_ROOT, '.git'));
/** True when no clone but we can use GitHub API (GITHUB_TOKEN + GITHUB_REPO). */
const GITHUB_REPO_AVAILABLE = !REPO_AVAILABLE && !!process.env.GITHUB_TOKEN && !!getRepoFromEnv();

const git = simpleGit({ baseDir: REPO_ROOT });

function safeRelativePath(input) {
    const raw = (input || '').trim();
    if (raw === '' || raw === '.') return '';
    const normalized = path.normalize(raw).replace(/^\.[/\\]/, '');
    if (normalized === '' || normalized === '.') return '';
    if (normalized.includes('..') || path.isAbsolute(normalized)) return null;
    return normalized;
}

// ----- GitHub API helpers (used when no local clone) -----
async function listBranchesGitHub() {
    const repo = getRepoFromEnv();
    if (!repo) return { ok: true, current: 'main', branches: ['main'], repoUnavailable: true };
    try {
        const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
        const [repoRes, branchesRes] = await Promise.all([
            octokit.repos.get({ owner: repo.owner, repo: repo.repo }),
            octokit.repos.listBranches({ owner: repo.owner, repo: repo.repo, per_page: 100 }),
        ]);
        const current = repoRes.data.default_branch || 'main';
        const branches = (branchesRes.data || []).map((b) => b.name);
        return { ok: true, current, branches: branches.length ? branches : [current] };
    } catch (err) {
        return { ok: false, error: err.message || String(err) };
    }
}

async function getTreeGitHub(ref, dirPath) {
    const repo = getRepoFromEnv();
    if (!repo) return { ok: false, error: 'Repo browser not available (no git in this environment)' };
    const safe = safeRelativePath(dirPath);
    if (safe === null) return { ok: false, error: 'Invalid path' };
    const refTrim = typeof ref === 'string' ? ref.trim() : '';
    if (!refTrim) return { ok: false, error: 'Branch required' };
    try {
        const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
        const pathForApi = safe || undefined;
        const { data } = await octokit.repos.getContent({
            owner: repo.owner,
            repo: repo.repo,
            path: pathForApi,
            ref: refTrim,
        });
        if (!Array.isArray(data)) return { ok: false, error: 'Path not found' };
        const entries = data
            .filter((e) => !EXCLUDED_DIRS.has(e.name))
            .map((e) => ({
                name: e.name,
                type: e.type === 'dir' ? 'dir' : 'file',
                path: e.path || (safe ? safe + '/' + e.name : e.name),
            }));
        entries.sort((a, b) => {
            if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });
        return { ok: true, entries };
    } catch (err) {
        if (err.status === 404) return { ok: false, error: 'Path not found' };
        return { ok: false, error: err.message || String(err) };
    }
}

/**
 * Get diff between base and head branch (GitHub API). Used when no local clone.
 * @param {string} baseBranch
 * @param {string} headBranch - Branch to compare (e.g. agent/run-xyz)
 * @returns {Promise<{ ok: true, diffText: string, baseBranch: string, headBranch: string, fileList: string[] } | { ok: false, error: string }>}
 */
async function getBranchDiffGitHub(baseBranch, headBranch) {
    const repo = getRepoFromEnv();
    if (!repo) return { ok: false, error: 'Repo not available (need GITHUB_REPO when no local git)' };
    let base = (baseBranch || 'main').trim();
    const head = (headBranch || '').trim();
    if (!head) return { ok: false, error: 'Branch name required' };
    try {
        const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
        const { data: repoData } = await octokit.repos.get({ owner: repo.owner, repo: repo.repo });
        const defaultBranch = repoData.default_branch || 'main';
        if (!base || base === 'main') base = defaultBranch;
        const { data } = await octokit.repos.compareCommits({
            owner: repo.owner,
            repo: repo.repo,
            base: base,
            head: head,
        });
        const fileList = (data.files || []).map((f) => f.filename || f.previous_filename || '').filter(Boolean);
        const parts = [];
        let total = 0;
        for (const file of data.files || []) {
            const patch = file.patch;
            if (!patch || total >= MAX_DIFF_CHARS) continue;
            const chunk = `--- ${file.filename || file.previous_filename || 'unknown'}\n${patch}`;
            if (total + chunk.length > MAX_DIFF_CHARS) {
                parts.push(chunk.slice(0, MAX_DIFF_CHARS - total));
                total = MAX_DIFF_CHARS;
                break;
            }
            parts.push(chunk);
            total += chunk.length;
        }
        const diffText = parts.join('\n');
        return { ok: true, diffText, baseBranch: base, headBranch: head, fileList };
    } catch (err) {
        if (err.status === 404) {
            const fallback = await getBranchDiffViaPullRequest(repo, base, head);
            if (fallback.ok) return fallback;
            return { ok: false, error: 'Branch not found or not accessible' };
        }
        return { ok: false, error: err.message || String(err) };
    }
}

/** Fallback when compareCommits 404s: find open PR for head branch and build diff from PR files. */
async function getBranchDiffViaPullRequest(repo, baseBranch, headBranch) {
    try {
        const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
        const headQualified = repo.owner + ':' + headBranch;
        const { data: pulls } = await octokit.rest.pulls.list({
            owner: repo.owner,
            repo: repo.repo,
            state: 'open',
            head: headQualified,
        });
        if (!pulls || pulls.length === 0) return { ok: false, error: 'No open PR found for branch' };
        const pr = pulls[0];
        const { data: files } = await octokit.rest.pulls.listFiles({
            owner: repo.owner,
            repo: repo.repo,
            pull_number: pr.number,
        });
        const fileList = (files || []).map((f) => f.filename || '').filter(Boolean);
        const parts = [];
        let total = 0;
        for (const file of files || []) {
            const patch = file.patch;
            if (!patch || total >= MAX_DIFF_CHARS) continue;
            const chunk = `--- ${file.filename || 'unknown'}\n${patch}`;
            if (total + chunk.length > MAX_DIFF_CHARS) {
                parts.push(chunk.slice(0, MAX_DIFF_CHARS - total));
                total = MAX_DIFF_CHARS;
                break;
            }
            parts.push(chunk);
            total += chunk.length;
        }
        const diffText = parts.join('\n');
        return { ok: true, diffText, baseBranch: baseBranch, headBranch: headBranch, fileList };
    } catch (e) {
        return { ok: false, error: e.message || String(e) };
    }
}

async function getFileContentGitHub(ref, filePath) {
    const repo = getRepoFromEnv();
    if (!repo) return { ok: false, error: 'Repo browser not available (no git in this environment)' };
    const safe = safeRelativePath(filePath);
    if (safe === null) return { ok: false, error: 'Invalid path' };
    try {
        const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
        const { data } = await octokit.repos.getContent({
            owner: repo.owner,
            repo: repo.repo,
            path: safe,
            ref: (typeof ref === 'string' ? ref.trim() : '') || 'main',
        });
        if (Array.isArray(data) || data.type !== 'file') return { ok: false, error: 'Not a file' };
        let content = data.content;
        if (data.encoding === 'base64') {
            content = Buffer.from(content, 'base64').toString('utf8');
        } else if (typeof content !== 'string') {
            content = String(content ?? '');
        }
        if (Buffer.byteLength(content, 'utf8') > MAX_FILE_SIZE) return { ok: false, error: 'File too large' };
        if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(content)) return { ok: false, error: 'Binary file' };
        return { ok: true, content };
    } catch (err) {
        if (err.status === 404) return { ok: false, error: 'Path not found' };
        return { ok: false, error: err.message || String(err) };
    }
}

// ----- Public API -----

/**
 * Get diff from an existing PR (by URL). Uses the PR's changed files — the branch that backs the PR.
 * Prefer this for Quality Review when we have the PR URL; avoids compare API 404s.
 * @param {string} prUrl - e.g. https://github.com/owner/repo/pull/123
 * @returns {Promise<{ ok: true, diffText: string, baseBranch: string, headBranch: string, fileList: string[] } | { ok: false, error: string }>}
 */
export async function getDiffForPullRequest(prUrl) {
    const repo = getRepoFromEnv();
    if (!repo) return { ok: false, error: 'Repo not available (need GITHUB_REPO when no local git)' };
    const match = (prUrl || '').match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i);
    if (!match) return { ok: false, error: 'Invalid PR URL' };
    const [, owner, repoName, pullNumberStr] = match;
    const pullNumber = parseInt(pullNumberStr, 10);
    if (!pullNumber) return { ok: false, error: 'Invalid PR number' };
    try {
        const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
        const { data: pr } = await octokit.rest.pulls.get({
            owner,
            repo: repoName.replace(/\.git$/, ''),
            pull_number: pullNumber,
        });
        const baseBranch = (pr.base && pr.base.ref) || 'main';
        const headBranch = (pr.head && pr.head.ref) || '';
        const { data: files } = await octokit.rest.pulls.listFiles({
            owner,
            repo: repoName.replace(/\.git$/, ''),
            pull_number: pullNumber,
        });
        const fileList = (files || []).map((f) => f.filename || '').filter(Boolean);
        const parts = [];
        let total = 0;
        for (const file of files || []) {
            const patch = file.patch;
            if (!patch || total >= MAX_DIFF_CHARS) continue;
            const chunk = `--- ${file.filename || 'unknown'}\n${patch}`;
            if (total + chunk.length > MAX_DIFF_CHARS) {
                parts.push(chunk.slice(0, MAX_DIFF_CHARS - total));
                total = MAX_DIFF_CHARS;
                break;
            }
            parts.push(chunk);
            total += chunk.length;
        }
        const diffText = parts.join('\n');
        return { ok: true, diffText, baseBranch, headBranch, fileList };
    } catch (err) {
        if (err.status === 404) return { ok: false, error: 'PR not found or not accessible' };
        return { ok: false, error: err.message || String(err) };
    }
}

/**
 * Get diff of headBranch vs baseBranch. Works with local git or GitHub API.
 * @param {string} headBranch - Branch to review (e.g. agent/run-xyz)
 * @param {string} [baseBranch='main']
 * @returns {Promise<{ ok: true, diffText: string, baseBranch: string, headBranch: string, fileList?: string[] } | { ok: false, error: string }>}
 */
export async function getBranchDiff(headBranch, baseBranch = 'main') {
    const base = (baseBranch || 'main').trim();
    const head = (headBranch || '').trim();
    if (!head) return { ok: false, error: 'Branch name required' };

    if (GITHUB_REPO_AVAILABLE) return getBranchDiffGitHub(base, head);

    if (!REPO_AVAILABLE) return { ok: false, error: 'Repo not available (need local git clone or GITHUB_TOKEN + GITHUB_REPO)' };

    try {
        const out = await git.raw(['diff', base + '...' + head, '--no-color']);
        let diffText = out != null ? String(out) : '';
        const fileList = [];
        const fileRe = /^diff --git a\/(.+?) b\//gm;
        let m;
        while ((m = fileRe.exec(diffText)) !== null) fileList.push(m[1]);
        if (diffText.length > MAX_DIFF_CHARS) {
            diffText = diffText.slice(0, MAX_DIFF_CHARS) + '\n\n[... diff truncated ...]';
        }
        return { ok: true, diffText, baseBranch: base, headBranch: head, fileList };
    } catch (err) {
        const msg = err.message || String(err);
        if (msg.includes('unknown revision') || msg.includes('bad revision')) return { ok: false, error: 'Branch not found' };
        return { ok: false, error: msg };
    }
}

/**
 * @returns {Promise<{ ok: true, current: string, branches: string[], repoUnavailable?: boolean } | { ok: false, error: string }>}
 */
export async function listBranches() {
    if (GITHUB_REPO_AVAILABLE) return listBranchesGitHub();
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
    if (GITHUB_REPO_AVAILABLE) return getTreeGitHub(ref, dirPath);
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
    if (GITHUB_REPO_AVAILABLE) return getFileContentGitHub(ref, filePath);
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
