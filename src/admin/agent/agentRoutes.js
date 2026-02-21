/**
 * Agent PR routes: main page, start run, SSE stream.
 */
import express from 'express';
import { adminHead, adminNav, adminContainer, breadcrumb, escapeHtml } from '../layout.js';
import { getAgentPageContent } from './agentPageContent.js';
import { createRun, getRun, updateRun, subscribe, listRuns, setRunCancelled, hydrateRun, deleteRun, DEFAULT_DOCS } from './runStore.js';
import { runPipeline } from './orchestrator.js';
import { listBranches, getTree, getFileContent } from './repoBrowser.js';
import { loadRunFromS3, loadRunMetadataFromS3, persistRunToS3 } from './agentRunPersistence.js';
import { listS3KeysWithPrefix, deleteFromS3, fetchFromS3Buffer } from '../../shared/s3Helper.js';
import { getAgentPrompt, saveAgentPrompt, resetAgentPromptToDefault, listAgentPromptIds } from './agentPromptLoader.js';
import { listModelsForMissions } from './agents.js';
import { Octokit } from '@octokit/rest';

const router = express.Router();
const SSE_HEARTBEAT_MS = 15000;

// ----- GET /admin/agent – main page (template in agentPageContent.js + agentPageContentInner.html) -----
router.get('/', (req, res) => {
    const { content, prismTail } = getAgentPageContent({ adminNav, adminContainer, breadcrumb });
    const themeScript = '<script>(function(){var t=localStorage.getItem("theme");if(t==="dark"||(!t&&window.matchMedia("(prefers-color-scheme:dark)").matches))document.documentElement.classList.add("dark");})();<\/script>';
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>${adminHead('Missions')}</head>
<body class="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">${themeScript}
${content}
${prismTail}
</body>
</html>`);
});

// ----- GET /admin/agent/models – list Gemini + Claude models for Missions dropdown -----
const DEFAULT_MODEL_ID = 'gemini-3-flash-preview';
const MODELS_CACHE_MS = 10 * 60 * 1000; // 10 minutes
let modelsCache = null;
let modelsCacheTime = 0;

/** Curated Claude models for Missions (Anthropic has no public list API). Requires ANTHROPIC_SECRET. Use current active model IDs; see https://docs.anthropic.com/en/docs/resources/model-deprecations */
const CLAUDE_MODELS = [
    { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6' },
    { id: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4' },
    { id: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5' },
    { id: 'claude-opus-4-6', displayName: 'Claude Opus 4.6' },
    { id: 'claude-opus-4-20250514', displayName: 'Claude Opus 4' },
];

/** Assign sort order, short description, and icon for Missions dropdown. Lower sortTier = better for this project. Icons are emoji so they render in native <option>. */
function modelMeta(id, displayName) {
    const lower = (id || '').toLowerCase();
    const name = (displayName || id || '').toLowerCase();
    if (/^claude-/.test(lower)) {
        return { sortTier: 1, hint: 'Claude model. Requires ANTHROPIC_SECRET in env.', premium: true, icon: '💻' };
    }
    if (/image|imagen|generation.*image|image.*generation/.test(lower) || /image\s*gen|image\s*generation/i.test(name)) {
        return { sortTier: 5, hint: 'Image-only model. Not recommended for text Missions.', icon: '🖼️' };
    }
    if (/computer.use|computeruse|veo|audio|tts|speech/.test(lower)) {
        return { sortTier: 5, hint: 'Multimedia/special model. Not recommended for text Missions.', icon: '🔇' };
    }
    if (/lite|nano|8b|small/.test(lower) && !/flash-lite.*001/.test(lower)) {
        return { sortTier: 2, hint: 'Lightweight & fast. Good for simple Missions; may miss nuance on complex tasks.', icon: '⚡' };
    }
    if (/experimental|exp\b|preview/.test(lower) && !/2\.5.*preview/.test(lower)) {
        return { sortTier: 3, hint: 'Experimental/preview. Use for cutting-edge; behavior may change.', icon: '🧪' };
    }
    if (/3-flash|2\.0-flash\b|2\.5-flash\b|1\.5-flash\b/.test(lower) && !/lite|nano|8b|image/.test(lower)) {
        return { sortTier: 0, hint: 'Best for Missions: fast, strong at code and planning. Recommended.', icon: '💻' };
    }
    if (/3-pro|2\.5-pro|2\.0-pro|1\.5-pro/.test(lower)) {
        return { sortTier: 0, hint: 'Best for hard Missions: best reasoning and multi-step code. Recommended.', icon: '💻' };
    }
    return { sortTier: 1, hint: 'General text/code. Good for Missions.', icon: '📝' };
}

router.get('/models', async (req, res) => {
    const now = Date.now();
    if (!modelsCache || now - modelsCacheTime >= MODELS_CACHE_MS) {
        try {
            const geminiList = await listModelsForMissions();
            const combined = [...geminiList, ...CLAUDE_MODELS];
            if (combined.length === 0) {
                const fallback = [{ id: DEFAULT_MODEL_ID, displayName: DEFAULT_MODEL_ID, hint: 'Best for Missions: fast, strong at code and planning.' }];
                return res.json({ models: fallback, default: DEFAULT_MODEL_ID, fromCache: false });
            }
            const enriched = combined.map((m) => {
                const meta = modelMeta(m.id, m.displayName);
                return { ...m, ...meta, hint: meta.hint || 'General text/code.', premium: !!meta.premium, icon: meta.icon || '📝' };
            });
            enriched.sort((a, b) => {
                if (a.sortTier !== b.sortTier) return a.sortTier - b.sortTier;
                return (a.id || '').localeCompare(b.id || '');
            });
            modelsCache = enriched;
            modelsCacheTime = now;
        } catch (_) {
            const fallback = [{ id: DEFAULT_MODEL_ID, displayName: DEFAULT_MODEL_ID, hint: 'Best for Missions: fast, strong at code and planning.' }];
            return res.json({ models: fallback, default: DEFAULT_MODEL_ID, fromCache: false });
        }
    }
    let visible = modelsCache.filter((m) => m.sortTier !== 0 && m.sortTier < 5);
    const defaultId = visible.length ? (visible.some((m) => m.id === DEFAULT_MODEL_ID) ? DEFAULT_MODEL_ID : visible[0].id) : (modelsCache[0]?.id || '');
    res.json({ models: visible.length ? visible : modelsCache.filter((m) => m.sortTier !== 0 && m.sortTier < 5), default: defaultId, fromCache: true });
});

// ----- GET /admin/agent/prompts – edit Researcher, Planner, Coder, Reviewer system prompts -----
const AGENT_PROMPT_LABELS = { researcher: 'Researcher', planner: 'Planner', coder: 'Coder', reviewer: 'Reviewer', auditor: 'Auditor', ask: 'Ask', tester: 'Tester' };
router.get('/prompts', async (req, res) => {
    try {
        const ids = listAgentPromptIds();
        const prompts = await Promise.all(ids.map(async (id) => ({ id, body: await getAgentPrompt(id), label: AGENT_PROMPT_LABELS[id] || id })));
        const sections = prompts.map(({ id, body, label }) => `
    <section class="rounded-xl border border-slate-200 bg-white overflow-hidden mb-6">
      <div class="border-b border-slate-200 px-4 py-2.5 bg-slate-50 flex items-center justify-between">
        <span class="text-sm font-medium text-slate-700">${escapeHtml(label)}</span>
        <div class="flex items-center gap-2">
          <button type="button" class="agent-prompt-save rounded-lg bg-emerald-600 text-white text-sm font-medium py-1.5 px-3 hover:bg-emerald-700" data-id="${escapeHtml(id)}">Save</button>
          <button type="button" class="agent-prompt-reset rounded-lg border border-slate-300 text-slate-600 text-sm font-medium py-1.5 px-3 hover:bg-slate-50" data-id="${escapeHtml(id)}">Reset to default</button>
        </div>
      </div>
      <textarea class="agent-prompt-body w-full min-h-[200px] rounded-none border-0 px-4 py-3 font-mono text-sm text-slate-800 dark:text-slate-100 dark:bg-slate-800 resize-y focus:ring-2 focus:ring-emerald-500 focus:ring-inset" data-id="${escapeHtml(id)}" spellcheck="false">${escapeHtml(body || '')}</textarea>
      <div class="agent-prompt-status border-t border-slate-100 dark:border-slate-700 px-4 py-1.5 text-xs text-slate-400 hidden" data-id="${escapeHtml(id)}"></div>
    </section>`).join('');
        const content = `
  ${adminNav('agent')}
  ${adminContainer(`
    ${breadcrumb([{ href: '/admin', label: 'Dashboard' }, { href: '/admin/agent', label: 'Missions' }, { label: 'Agent prompts' }])}
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-semibold text-slate-800">Agent prompts</h1>
      <a href="/admin/agent" class="text-sm font-medium text-slate-500 hover:text-slate-700">← Missions</a>
    </div>
    <p class="text-slate-600 mb-6">Edit the system prompts used by the Researcher, Planner, Coder, and Reviewer. Changes are saved to S3 and used on the next mission run.</p>
    ${sections}
    <script>
      document.querySelectorAll('.agent-prompt-save').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var id = btn.dataset.id;
          var textarea = document.querySelector('.agent-prompt-body[data-id="' + id + '"]');
          var status = document.querySelector('.agent-prompt-status[data-id="' + id + '"]');
          if (!textarea || !status) return;
          status.classList.remove('hidden');
          status.textContent = 'Saving…';
          status.className = 'agent-prompt-status border-t border-slate-100 px-4 py-1.5 text-xs text-slate-400';
          fetch('/admin/agent/prompts/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id, body: textarea.value }) })
            .then(function(r) { return r.json().then(function(data) { return { ok: r.ok, data: data }; }); })
            .then(function(o) {
              status.textContent = o.ok ? 'Saved.' : (o.data && o.data.error ? o.data.error : 'Save failed');
              if (!o.ok) status.classList.add('text-red-600');
            })
            .catch(function() { status.textContent = 'Save failed'; status.classList.add('text-red-600'); });
        });
      });
      document.querySelectorAll('.agent-prompt-reset').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var id = btn.dataset.id;
          var status = document.querySelector('.agent-prompt-status[data-id="' + id + '"]');
          if (!status) return;
          if (!confirm('Reset ' + id + ' to the built-in default? This will overwrite your saved version.')) return;
          status.classList.remove('hidden');
          status.textContent = 'Resetting…';
          status.className = 'agent-prompt-status border-t border-slate-100 px-4 py-1.5 text-xs text-slate-400';
          fetch('/admin/agent/prompts/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) })
            .then(function(r) { return r.json().then(function(data) { return { ok: r.ok, data: data }; }); })
            .then(function(o) {
              if (o.ok) { window.location.reload(); return; }
              status.textContent = o.data && o.data.error ? o.data.error : 'Reset failed';
              status.classList.add('text-red-600');
            })
            .catch(function() { status.textContent = 'Reset failed'; status.classList.add('text-red-600'); });
        });
      });
    <\/script>
  `)}
`;
        res.send(`<!DOCTYPE html>
<html lang="en">
<head>${adminHead('Agent prompts')}</head>
<body class="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">${content}</body>
</html>`);
    } catch (err) {
        console.error('Agent prompts page:', err);
        res.status(500).send('Error loading agent prompts.');
    }
});

router.post('/prompts/save', express.json(), async (req, res) => {
    const { id, body } = req.body || {};
    if (!id || !listAgentPromptIds().includes(id)) return res.status(400).json({ error: 'Invalid or missing id.' });
    if (typeof body !== 'string') return res.status(400).json({ error: 'Missing body.' });
    try {
        await saveAgentPrompt(id, body);
        res.json({ ok: true });
    } catch (err) {
        console.error('Agent prompt save:', err);
        res.status(500).json({ error: err.message || 'Save failed.' });
    }
});

router.post('/prompts/reset', express.json(), async (req, res) => {
    const { id } = req.body || {};
    if (!id || !listAgentPromptIds().includes(id)) return res.status(400).json({ error: 'Invalid or missing id.' });
    try {
        await resetAgentPromptToDefault(id);
        res.json({ ok: true });
    } catch (err) {
        console.error('Agent prompt reset:', err);
        res.status(500).json({ error: err.message || 'Reset failed.' });
    }
});

// ----- Repo browser API -----
router.get('/repo/branches', async (req, res) => {
    const result = await listBranches();
    if (!result.ok) return res.status(500).json({ ok: false, error: result.error });
    res.json({ ok: true, current: result.current, branches: result.branches, repoUnavailable: result.repoUnavailable });
});
router.get('/repo/tree', async (req, res) => {
    const branch = req.query.branch || 'main';
    const path = req.query.path || '';
    const result = await getTree(branch, path);
    if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, entries: result.entries });
});
router.get('/repo/file', async (req, res) => {
    const branch = req.query.branch || 'main';
    const path = req.query.path;
    if (!path) return res.status(400).json({ ok: false, error: 'path required' });
    const result = await getFileContent(branch, path);
    if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, content: result.content });
});

// ----- GET /admin/agent/runs – list recent in-memory runs -----
router.get('/runs', (req, res) => {
    const limit = Math.min(50, parseInt(req.query.limit, 10) || 20);
    res.json({ runs: listRuns(limit) });
});

// ----- GET /admin/agent/runs/history – list runs persisted to S3 (survives server restart) -----
router.get('/runs/history', async (req, res) => {
    try {
        const keys = await listS3KeysWithPrefix('admin/agent-runs/', 50);
        const sorted = keys
            .sort((a, b) => new Date(b.LastModified || 0) - new Date(a.LastModified || 0))
            .slice(0, 20);
        const runs = await Promise.all(sorted.map(async (k) => {
            const runId = k.Key.replace('admin/agent-runs/', '').replace('.json', '');
            const fallbackTs = k.LastModified ? new Date(k.LastModified).getTime() : 0;
            const meta = await loadRunMetadataFromS3(runId);
            return {
                runId,
                title: meta?.title || '',
                prompt: meta?.prompt || '',
                status: meta?.status || '',
                createdAt: meta?.createdAt || fallbackTs,
                lastModified: fallbackTs,
                model: meta?.model || '',
                inputTokens: meta?.inputTokens || 0,
                outputTokens: meta?.outputTokens || 0,
            };
        }));
        res.json({ runs });
    } catch (_) {
        res.json({ runs: [] });
    }
});

// ----- DELETE /admin/agent/run/:runId – delete run from memory and S3 -----
router.delete('/run/:runId', async (req, res) => {
    const { runId } = req.params;
    const run = getRun(runId);
    if (run) {
        const active = !['done', 'error', 'cancelled'].includes(run.status);
        if (active) return res.status(400).json({ ok: false, error: 'Cannot delete an active run; stop it first.' });
    }
    deleteRun(runId);
    try {
        await deleteFromS3('admin/agent-runs/' + runId + '.json');
    } catch (_) {}
    res.json({ ok: true });
});

// ----- POST /admin/agent/run/:runId/cancel – request run to stop (no more token use after next check) -----
router.post('/run/:runId/cancel', (req, res) => {
    const runId = req.params.runId;
    const run = getRun(runId);
    if (!run) return res.status(404).json({ ok: false, error: 'Run not found' });
    const terminal = ['done', 'error', 'cancelled'].includes(run.status);
    if (terminal) return res.status(400).json({ ok: false, error: 'Run already finished' });
    setRunCancelled(runId);
    persistRunToS3(runId).catch(() => {});
    res.json({ ok: true });
});

// ----- POST /admin/agent/run/:runId/pr-action – merge or close the run's PR via GitHub API -----
router.post('/run/:runId/pr-action', express.json(), async (req, res) => {
    const runId = req.params.runId;
    const action = (req.body && req.body.action) === 'close' ? 'close' : (req.body && req.body.action) === 'merge' ? 'merge' : null;
    if (!action) return res.status(400).json({ ok: false, error: 'Missing or invalid body.action; use "merge" or "close".' });

    let run = getRun(runId);
    if (!run) {
        const snapshot = await loadRunFromS3(runId);
        if (!snapshot) return res.status(404).json({ ok: false, error: 'Run not found' });
        hydrateRun(runId, snapshot);
        run = getRun(runId);
    }
    if (!run || !run.prUrl) return res.status(400).json({ ok: false, error: 'Run has no PR.' });

    const repo = (run.prUrl || '').match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i);
    if (!repo) return res.status(400).json({ ok: false, error: 'Could not parse PR URL.' });
    const owner = repo[1];
    const repoName = repo[2].replace(/\.git$/, '');
    const pullNumber = parseInt(repo[3], 10);

    const token = process.env.GITHUB_TOKEN;
    if (!token) return res.status(503).json({ ok: false, error: 'GITHUB_TOKEN not set.' });

    try {
        const octokit = new Octokit({ auth: token, log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } });
        if (action === 'merge') {
            await octokit.rest.pulls.merge({ owner, repo: repoName, pull_number: pullNumber });
            return res.json({ ok: true, message: 'PR merged.' });
        }
        await octokit.rest.pulls.update({ owner, repo: repoName, pull_number: pullNumber, state: 'closed' });
        return res.json({ ok: true, message: 'PR closed.' });
    } catch (err) {
        const msg = err.message || String(err);
        const status = err.status || err.response?.status;
        return res.status(status === 404 ? 404 : 502).json({ ok: false, error: msg });
    }
});

// ----- GET /admin/agent/run/:runId – run summary; falls back to S3 if not in memory -----
router.get('/run/:runId', async (req, res) => {
    let run = getRun(req.params.runId);
    if (!run) {
        const snapshot = await loadRunFromS3(req.params.runId);
        if (!snapshot) return res.status(404).json({ error: 'Run not found' });
        hydrateRun(req.params.runId, snapshot);
        run = getRun(req.params.runId);
    }
    if (!run) return res.status(404).json({ error: 'Run not found' });
    const { runId, status, logs, flightPlan, steps, docs, stepResults, prUrl, error, createdAt, prompt, title, edits, model, runMode, auditReport, auditReportImageKey, askResponse, askResponseImageKey, reviewReport, reviewReportError, diagramKeys } = run;
    res.json({
        runId,
        status,
        runMode: runMode || 'pr',
        auditReport: auditReport || '',
        auditReportImageKey: auditReportImageKey || '',
        askResponse: askResponse || '',
        askResponseImageKey: askResponseImageKey || '',
        reviewReport: reviewReport || '',
        reviewReportError: reviewReportError || '',
        diagramKeys: diagramKeys || [],
        logs,
        flightPlan,
        steps: steps || [],
        docs: docs || { ...DEFAULT_DOCS },
        stepResults: stepResults || [],
        prUrl,
        error,
        createdAt,
        prompt,
        title: title || '',
        edits: edits || [],
        model: model || '',
    });
});

// ----- GET /admin/agent/run/:runId/audit-image – serve audit diagram image from S3 -----
router.get('/run/:runId/audit-image', async (req, res) => {
    let run = getRun(req.params.runId);
    if (!run) {
        const snapshot = await loadRunFromS3(req.params.runId);
        if (!snapshot) return res.status(404).send('Run not found');
        hydrateRun(req.params.runId, snapshot);
        run = getRun(req.params.runId);
    }
    const key = run?.auditReportImageKey;
    if (!key) return res.status(404).send('No audit image');
    const result = await fetchFromS3Buffer(key);
    if (!result) return res.status(404).send('Image not found');
    res.set('Content-Type', result.contentType);
    res.send(result.body);
});

// ----- GET /admin/agent/run/:runId/ask-image – serve ask diagram image from S3 -----
router.get('/run/:runId/ask-image', async (req, res) => {
    let run = getRun(req.params.runId);
    if (!run) {
        const snapshot = await loadRunFromS3(req.params.runId);
        if (!snapshot) return res.status(404).send('Run not found');
        hydrateRun(req.params.runId, snapshot);
        run = getRun(req.params.runId);
    }
    const key = run?.askResponseImageKey;
    if (!key) return res.status(404).send('No ask image');
    const result = await fetchFromS3Buffer(key);
    if (!result) return res.status(404).send('Image not found');
    res.set('Content-Type', result.contentType);
    res.send(result.body);
});

// ----- GET /admin/agent/run/:runId/diagram/:index – serve inline diagram image from S3 -----
router.get('/run/:runId/diagram/:index', async (req, res) => {
    const idx = parseInt(req.params.index, 10);
    if (isNaN(idx) || idx < 0) return res.status(400).send('Invalid index');
    let run = getRun(req.params.runId);
    if (!run) {
        const snapshot = await loadRunFromS3(req.params.runId);
        if (!snapshot) return res.status(404).send('Run not found');
        hydrateRun(req.params.runId, snapshot);
        run = getRun(req.params.runId);
    }
    const keys = run?.diagramKeys;
    if (!Array.isArray(keys) || idx >= keys.length) return res.status(404).send('Diagram not found');
    try {
        const result = await fetchFromS3Buffer(keys[idx]);
        if (!result) return res.status(404).send('Image not found in S3');
        res.set('Content-Type', result.contentType);
        res.set('Cache-Control', 'public, max-age=86400');
        res.send(result.body);
    } catch (e) {
        console.warn('[diagram route]', e.message || e);
        res.status(500).send('Failed to load diagram');
    }
});

const DOC_SECTIONS = ['overview', 'requirements', 'architecture', 'decisions', 'notes'];

// ----- PATCH /admin/agent/run/:runId/docs – update one doc section -----
router.patch('/run/:runId/docs', express.json(), (req, res) => {
    const runId = req.params.runId;
    const run = getRun(runId);
    if (!run) return res.status(404).json({ ok: false, error: 'Run not found' });
    const { section, content } = req.body || {};
    if (!section || typeof section !== 'string' || !DOC_SECTIONS.includes(section)) {
        return res.status(400).json({ ok: false, error: 'Invalid or missing section; use one of: ' + DOC_SECTIONS.join(', ') });
    }
    updateRun(runId, { docs: { [section]: content != null ? String(content) : '' } });
    persistRunToS3(runId).catch(() => {});
    res.json({ ok: true });
});

// ----- POST /admin/agent/run – start run (returns runId, runs orchestrator in background) -----
router.post('/run', express.json(), (req, res) => {
    const { prompt = '', model = '', mode = 'pr', maxParallelPlanners = 2, maxParallelCoders = 3, seedDocs } = req.body || {};
    const runId = createRun({ prompt, model, mode });
    if (seedDocs && typeof seedDocs === 'object') {
        updateRun(runId, { docs: seedDocs });
    }
    res.json({ runId });

    setImmediate(() => {
        runPipeline(runId, { prompt, model, maxParallelPlanners, maxParallelCoders });
    });
});

// ----- POST /admin/agent/run/:runId/resume – resume a run (load from S3 if not in memory) -----
router.post('/run/:runId/resume', async (req, res) => {
    const runId = req.params.runId;
    let run = getRun(runId);
    if (!run) {
        const snapshot = await loadRunFromS3(runId);
        if (!snapshot) return res.status(404).json({ ok: false, error: 'Run not found' });
        hydrateRun(runId, snapshot);
        run = getRun(runId);
    }
    const terminal = ['done', 'error', 'cancelled'].includes(run.status);
    if (terminal) return res.status(400).json({ ok: false, error: 'Run already finished; cannot resume' });

    res.json({ ok: true });
    setImmediate(() => runPipeline(runId, { prompt: run.prompt, model: run.model, maxParallelPlanners: 2, maxParallelCoders: 3, resume: true }));
});

// ----- GET /admin/agent/stream/:runId – SSE -----
router.get('/stream/:runId', (req, res) => {
    const { runId } = req.params;
    const run = getRun(runId);
    if (!run) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-store');
        res.write('data: ' + JSON.stringify({ type: 'error', message: 'Run not found' }) + '\n\n');
        res.end();
        return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.flushHeaders?.();

    // Send all existing logs
    run.logs.forEach((entry) => {
        res.write('data: ' + JSON.stringify({ type: 'log', ...entry }) + '\n\n');
    });
    res.write('data: ' + JSON.stringify({ type: 'status', status: run.status, inputTokens: run.inputTokens || 0, outputTokens: run.outputTokens || 0 }) + '\n\n');

    if (run.status === 'done' || run.status === 'error' || run.status === 'cancelled') {
        res.write('data: ' + JSON.stringify({
            type: 'done',
            prUrl: run.prUrl,
            error: run.status === 'cancelled' ? 'Run stopped by user.' : run.error,
            cancelled: run.status === 'cancelled',
            inputTokens: run.inputTokens || 0,
            outputTokens: run.outputTokens || 0,
        }) + '\n\n');
        res.end();
        return;
    }

    const unsub = subscribe((id, entry) => {
        if (id !== runId) return;
        if (entry.type === 'docs') {
            res.write('data: ' + JSON.stringify({ type: 'docs', docs: entry.docs }) + '\n\n');
        } else {
            res.write('data: ' + JSON.stringify({ type: 'log', ...entry }) + '\n\n');
        }
        const r = getRun(runId);
        res.write('data: ' + JSON.stringify({ type: 'status', status: r?.status, inputTokens: r?.inputTokens || 0, outputTokens: r?.outputTokens || 0 }) + '\n\n');
    });

    const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
    }, SSE_HEARTBEAT_MS);

    const checkDone = setInterval(() => {
        const r = getRun(runId);
        if (r && (r.status === 'done' || r.status === 'error' || r.status === 'cancelled')) {
            clearInterval(checkDone);
            clearInterval(heartbeat);
            unsub();
            res.write('data: ' + JSON.stringify({
                type: 'done',
                prUrl: r.prUrl,
                error: r.status === 'cancelled' ? 'Run stopped by user.' : r.error,
                cancelled: r.status === 'cancelled',
                inputTokens: r.inputTokens || 0,
                outputTokens: r.outputTokens || 0,
            }) + '\n\n');
            res.end();
        }
    }, 500);

    req.on('close', () => {
        clearInterval(checkDone);
        clearInterval(heartbeat);
        unsub();
    });
});

export { router as agentRoutes };
