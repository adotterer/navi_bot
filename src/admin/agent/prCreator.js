/**
 * Create a branch, apply edits, commit, push, and open a GitHub PR.
 * When no local git clone, uses GitHub API only (create ref, update contents, create PR).
 */
import fs from 'fs';
import path from 'path';
import { Buffer } from 'node:buffer';
import { simpleGit } from 'simple-git';
import { Octokit } from '@octokit/rest';
import { WORKSPACE_ROOT, resolvePath } from './codebaseTools.js';

const EXCLUDED_DIRS = new Set(['.git', 'node_modules', '.env', 'dist', 'coverage']);

function hasGitClone() {
    const candidates = [path.resolve(WORKSPACE_ROOT), process.cwd()];
    for (const dir of candidates) {
        if (dir && fs.existsSync(path.join(dir, '.git'))) return true;
    }
    return false;
}

/** Validate relative path for API-only edits (no filesystem). */
function validateEditPath(relativePath) {
    const raw = (relativePath || '').trim();
    if (!raw) return { ok: false, error: 'Empty path' };
    const normalized = path.normalize(raw).replace(/^\.[/\\]/, '');
    if (normalized.includes('..') || path.isAbsolute(normalized)) return { ok: false, error: 'Invalid path' };
    const segments = normalized.split(path.sep).filter(Boolean);
    for (const seg of segments) {
        if (EXCLUDED_DIRS.has(seg)) return { ok: false, error: 'Path may not include ' + seg };
    }
    return { ok: true, relative: normalized };
}

/**
 * Create PR from aggregated edits (API-only when no local clone).
 * @param {string} runId
 * @param {object} opts
 * @param {string} [opts.prompt]
 * @param {Array<{ path: string, content: string }>} [opts.edits]
 * @returns {Promise<{ ok: boolean, prUrl?: string, error?: string }>}
 */
export async function createPr(runId, opts = {}) {
    const { prompt = '', edits = [], title: runTitle = '' } = opts;
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
        return { ok: true }; // no-op when not configured
    }

    if (!edits.length) {
        return { ok: false, error: 'No edits to apply' };
    }

    const branchName = 'agent/' + runId.replace(/[^a-z0-9-]/gi, '-').slice(0, 80);

    const useApiOnly = process.env.AGENT_NO_LOCAL_GIT === 'true' || process.env.AGENT_NO_LOCAL_GIT === '1';
    if (useApiOnly || !hasGitClone()) {
        return createPrViaApi(runId, { prompt, edits, branchName, token, runTitle });
    }

    const git = simpleGit({ baseDir: WORKSPACE_ROOT });

    // Remember where we started so we can restore it after the PR is pushed.
    let originalBranch = null;

    try {
        const resolvedEdits = [];
        for (const e of edits) {
            const r = resolvePath(e.path);
            if (!r.ok) return { ok: false, error: `Invalid path ${e.path}: ${r.error}` };
            resolvedEdits.push({ absolute: r.absolute, relative: e.path, content: e.content });
        }

        const branchResult = await git.branch();
        originalBranch = branchResult.current;

        // Always base the agent branch off the repo's default branch (main), not whatever
        // the developer currently has checked out.
        const defaultBranch = await resolveDefaultBranch(git);
        await git.checkout(defaultBranch);
        await git.pull();

        await git.checkoutLocalBranch(branchName);

        for (const { absolute, content } of resolvedEdits) {
            if (content == null) continue; // skip edits with no resolved content
            const dir = path.dirname(absolute);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(absolute, content, 'utf8');
        }

        const relPaths = resolvedEdits.map((e) => e.relative);
        await git.add(relPaths);
        const title = (runTitle || prompt).slice(0, 72) || `Agent PR ${runId}`;
        const body = (prompt ? `## Mission\n${prompt}\n\n` : '') + `**Run ID:** ${runId}\n**Files:** ${relPaths.join(', ')}`;
        await git.commit(title + (title.length >= 72 ? '…' : ''));
        await git.push('origin', branchName);

        const repo = await getRepo(git);
        if (!repo) {
            return { ok: false, error: 'Could not determine GitHub owner/repo (set GITHUB_REPO or use origin remote)' };
        }

        const octokit = new Octokit({ auth: token, log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } });
        const { data: pr } = await octokit.rest.pulls.create({
            owner: repo.owner,
            repo: repo.repo,
            title: title.slice(0, 256),
            head: branchName,
            base: defaultBranch,
            body,
        });

        return { ok: true, prUrl: pr.html_url };
    } catch (err) {
        return { ok: false, error: err.message || String(err) };
    } finally {
        // Always restore the branch the developer was on before the agent ran.
        if (originalBranch) {
            try { await git.checkout(originalBranch); } catch (_) {}
        }
    }
}

/**
 * Create PR using only GitHub API (no local git). Used when deployed without a clone.
 */
async function createPrViaApi(runId, opts) {
    const { prompt, edits, branchName, token, runTitle = '' } = opts;
    const repo = getRepoFromEnv();
    if (!repo) {
        return { ok: false, error: 'GITHUB_REPO required when no local git (e.g. owner/repo)' };
    }

    const validated = [];
    for (const e of edits) {
        const v = validateEditPath(e.path);
        if (!v.ok) return { ok: false, error: `${e.path}: ${v.error}` };
        if (e.content == null) continue; // skip edits with no resolved content
        validated.push({ path: v.relative, content: e.content });
    }

    try {
        const octokit = new Octokit({ auth: token, log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } });

        const { data: repoData } = await octokit.repos.get({ owner: repo.owner, repo: repo.repo });
        const defaultBranch = repoData.default_branch || 'main';

        const refRes = await octokit.git.getRef({
            owner: repo.owner,
            repo: repo.repo,
            ref: 'heads/' + defaultBranch,
        });
        const defaultSha = refRes.data.object.sha;

        await octokit.git.createRef({
            owner: repo.owner,
            repo: repo.repo,
            ref: 'refs/heads/' + branchName,
            sha: defaultSha,
        });

        for (const { path: filePath, content } of validated) {
            let sha = null;
            try {
                const { data } = await octokit.repos.getContent({
                    owner: repo.owner,
                    repo: repo.repo,
                    path: filePath,
                    ref: branchName,
                });
                if (!Array.isArray(data) && data.sha) sha = data.sha;
            } catch (e) {
                if (e.status !== 404) throw e;
            }

            await octokit.repos.createOrUpdateFileContents({
                owner: repo.owner,
                repo: repo.repo,
                path: filePath,
                message: `Agent edit: ${filePath}`,
                content: Buffer.from(content, 'utf8').toString('base64'),
                branch: branchName,
                ...(sha ? { sha } : {}),
            });
        }

        const title = (runTitle || prompt || `Agent PR ${runId}`).slice(0, 72);
        const body = (prompt ? `## Mission\n${prompt}\n\n` : '') + `**Run ID:** ${runId}\n**Files:** ${validated.map((e) => e.path).join(', ')}`;

        const { data: pr } = await octokit.pulls.create({
            owner: repo.owner,
            repo: repo.repo,
            title: title.slice(0, 256),
            head: branchName,
            base: defaultBranch,
            body,
        });

        return { ok: true, prUrl: pr.html_url };
    } catch (err) {
        return { ok: false, error: err.message || String(err) };
    }
}

function getRepoFromEnv() {
    const envRepo = process.env.GITHUB_REPO;
    if (!envRepo || !/^[^/]+\/[^/]+$/.test(envRepo.trim())) return null;
    const [owner, repo] = envRepo.trim().split('/');
    return { owner, repo: repo.replace(/\.git$/, '') };
}

/**
 * Determine the repository's default branch.
 * Prefers the remote HEAD symbolic ref; falls back to checking for
 * 'main' then 'master', then 'main' as a last resort.
 * @param {import('simple-git').SimpleGit} git
 * @returns {Promise<string>}
 */
async function resolveDefaultBranch(git) {
    // Try remote HEAD (works when origin is configured)
    try {
        const raw = await git.raw(['rev-parse', '--abbrev-ref', 'origin/HEAD']);
        const ref = (raw || '').trim(); // e.g. "origin/main"
        if (ref) {
            const parts = ref.split('/');
            return parts[parts.length - 1] || 'main';
        }
    } catch (_) {}

    // Fall back: check if main or master exist locally
    try {
        const branches = await git.branchLocal();
        if (branches.all.includes('main')) return 'main';
        if (branches.all.includes('master')) return 'master';
    } catch (_) {}

    return 'main';
}

/**
 * Get { owner, repo } from GITHUB_REPO env or git remote origin.
 * @param {import('simple-git').SimpleGit} git
 * @returns {Promise<{ owner: string, repo: string } | null>}
 */
async function getRepo(git) {
    const envRepo = process.env.GITHUB_REPO;
    if (envRepo && /^[^/]+\/[^/]+$/.test(envRepo.trim())) {
        const [owner, repo] = envRepo.trim().split('/');
        return { owner, repo: repo.replace(/\.git$/, '') };
    }
    try {
        const url = await git.raw(['remote', 'get-url', 'origin']);
        const s = (url && typeof url === 'object' && url.valueOf) ? String(url).trim() : String(url || '').trim();
        const m = s.match(/github\.com[:/]([^/]+)\/([^/]+?)(\.git)?$/i);
        if (m) return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
    } catch (_) {}
    return null;
}

/**
 * Push additional edits to an existing PR branch (e.g. after "Apply fixes to PR").
 * @param {string} runId
 * @param {Array<{ path: string, content: string }>} edits - Resolved edits (path + full content per file).
 * @returns {Promise<{ ok: boolean, prUrl?: string, error?: string }>}
 */
export async function pushEditsToBranch(runId, edits) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) return { ok: false, error: 'GITHUB_TOKEN not set' };
    if (!edits || !edits.length) return { ok: false, error: 'No edits to apply' };

    const branchName = 'agent/' + runId.replace(/[^a-z0-9-]/gi, '-').slice(0, 80);
    const useApiOnly = process.env.AGENT_NO_LOCAL_GIT === 'true' || process.env.AGENT_NO_LOCAL_GIT === '1';

    if (useApiOnly || !hasGitClone()) {
        return pushEditsToBranchViaApi(runId, branchName, edits, token);
    }

    const git = simpleGit({ baseDir: WORKSPACE_ROOT });
    let originalBranch = null;

    try {
        const resolvedEdits = [];
        for (const e of edits) {
            const r = resolvePath(e.path);
            if (!r.ok) return { ok: false, error: `Invalid path ${e.path}: ${r.error}` };
            resolvedEdits.push({ absolute: r.absolute, relative: e.path, content: e.content });
        }

        const branchResult = await git.branch();
        originalBranch = branchResult.current;

        await git.fetch();
        const branchList = await git.branchLocal();
        if (!branchList.all.includes(branchName)) {
            await git.checkoutBranch(branchName, 'origin/' + branchName);
        } else {
            await git.checkout(branchName);
        }
        await git.pull();

        for (const { absolute, content } of resolvedEdits) {
            if (content == null) continue;
            const dir = path.dirname(absolute);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(absolute, content, 'utf8');
        }

        const relPaths = resolvedEdits.map((e) => e.relative);
        await git.add(relPaths);
        await git.commit('Apply Quality Review fixes');
        await git.push('origin', branchName);

        const repo = await getRepo(git);
        const prUrl = repo ? `https://github.com/${repo.owner}/${repo.repo}/pull/...` : undefined;
        return { ok: true, prUrl };
    } catch (err) {
        return { ok: false, error: err.message || String(err) };
    } finally {
        if (originalBranch) {
            try { await git.checkout(originalBranch); } catch (_) {}
        }
    }
}

async function pushEditsToBranchViaApi(runId, branchName, edits, token) {
    const repo = getRepoFromEnv();
    if (!repo) return { ok: false, error: 'GITHUB_REPO required (e.g. owner/repo)' };

    const validated = [];
    for (const e of edits) {
        const v = validateEditPath(e.path);
        if (!v.ok) return { ok: false, error: `${e.path}: ${v.error}` };
        if (e.content == null) continue;
        validated.push({ path: v.relative, content: e.content });
    }
    if (!validated.length) return { ok: false, error: 'No valid edits' };

    try {
        const octokit = new Octokit({ auth: token, log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } });
        for (const { path: filePath, content } of validated) {
            let sha = null;
            try {
                const { data } = await octokit.repos.getContent({
                    owner: repo.owner,
                    repo: repo.repo,
                    path: filePath,
                    ref: branchName,
                });
                if (!Array.isArray(data) && data.sha) sha = data.sha;
            } catch (e) {
                if (e.status !== 404) throw e;
            }
            await octokit.repos.createOrUpdateFileContents({
                owner: repo.owner,
                repo: repo.repo,
                path: filePath,
                message: 'Apply Quality Review fixes',
                content: Buffer.from(content, 'utf8').toString('base64'),
                branch: branchName,
                ...(sha ? { sha } : {}),
            });
        }
        const prUrl = `https://github.com/${repo.owner}/${repo.repo}/pulls`;
        return { ok: true, prUrl };
    } catch (err) {
        return { ok: false, error: err.message || String(err) };
    }
}
