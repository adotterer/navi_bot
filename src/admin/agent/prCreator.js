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
    const { prompt = '', edits = [] } = opts;
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
        return { ok: true }; // no-op when not configured
    }

    if (!edits.length) {
        return { ok: false, error: 'No edits to apply' };
    }

    const branchName = 'agent/' + runId.replace(/[^a-z0-9-]/gi, '-').slice(0, 80);

    if (!hasGitClone()) {
        return createPrViaApi(runId, { prompt, edits, branchName, token });
    }

    const git = simpleGit({ baseDir: WORKSPACE_ROOT });

    try {
        const resolvedEdits = [];
        for (const e of edits) {
            const r = resolvePath(e.path);
            if (!r.ok) return { ok: false, error: `Invalid path ${e.path}: ${r.error}` };
            resolvedEdits.push({ absolute: r.absolute, relative: e.path, content: e.content });
        }

        const branchResult = await git.branch();
        const defaultBranch = branchResult.current || 'main';
        await git.checkout(defaultBranch);
        await git.pull();

        await git.checkoutLocalBranch(branchName);

        for (const { absolute, content } of resolvedEdits) {
            const dir = path.dirname(absolute);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(absolute, content, 'utf8');
        }

        const relPaths = resolvedEdits.map((e) => e.relative);
        await git.add(relPaths);
        const title = prompt.slice(0, 72) || `Agent PR ${runId}`;
        const body = (prompt ? `## Mission\n${prompt}\n\n` : '') + `**Run ID:** ${runId}\n**Files:** ${relPaths.join(', ')}`;
        await git.commit(title + (title.length >= 72 ? '…' : ''));
        await git.push('origin', branchName);

        const repo = await getRepo(git);
        if (!repo) {
            return { ok: false, error: 'Could not determine GitHub owner/repo (set GITHUB_REPO or use origin remote)' };
        }

        const octokit = new Octokit({ auth: token });
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
    }
}

/**
 * Create PR using only GitHub API (no local git). Used when deployed without a clone.
 */
async function createPrViaApi(runId, opts) {
    const { prompt, edits, branchName, token } = opts;
    const repo = getRepoFromEnv();
    if (!repo) {
        return { ok: false, error: 'GITHUB_REPO required when no local git (e.g. owner/repo)' };
    }

    const validated = [];
    for (const e of edits) {
        const v = validateEditPath(e.path);
        if (!v.ok) return { ok: false, error: `${e.path}: ${v.error}` };
        validated.push({ path: v.relative, content: e.content });
    }

    try {
        const octokit = new Octokit({ auth: token });

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

        const title = (prompt || `Agent PR ${runId}`).slice(0, 72);
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
