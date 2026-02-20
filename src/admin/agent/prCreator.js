/**
 * Create a branch, apply edits, commit, push, and open a GitHub PR.
 */
import fs from 'fs';
import path from 'path';
import { simpleGit } from 'simple-git';
import { Octokit } from '@octokit/rest';
import { WORKSPACE_ROOT, resolvePath } from './codebaseTools.js';

/**
 * Create PR from aggregated edits.
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

    const git = simpleGit({ baseDir: WORKSPACE_ROOT });

    try {
        // Validate all edit paths and resolve absolute paths
        const resolvedEdits = [];
        for (const e of edits) {
            const r = resolvePath(e.path);
            if (!r.ok) return { ok: false, error: `Invalid path ${e.path}: ${r.error}` };
            resolvedEdits.push({ absolute: r.absolute, relative: e.path, content: e.content });
        }

        // Ensure default branch and latest
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
        // Amend commit to set body as description would be in PR body, not commit - so we're good

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
