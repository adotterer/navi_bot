/**
 * Orchestrator: runs Researcher -> Planners -> Coders, aggregates edits, then PR.
 * Uses tool registry for read_file and grep_search; passes fileContext and grepContext to Planner.
 */
import pLimit from 'p-limit';
import { appendLog, getRun, updateRun, isRunCancelled } from './runStore.js';
import { runResearcher, runPlanner, runCoder, validateCoderStep } from './agents.js';
import { callTool } from './toolRegistry.js';

/**
 * Run the full pipeline for a given runId.
 * @param {string} runId
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {number} [opts.maxParallelPlanners]
 * @param {number} [opts.maxParallelCoders]
 */
function checkCancelled(runId, log) {
    if (isRunCancelled(runId)) {
        updateRun(runId, { status: 'cancelled' });
        log('system', 'cancelled', 'Run stopped by user.\n');
        return true;
    }
    return false;
}

/** Derive 2-5 search keywords from mission prompt for grep. */
function missionKeywords(prompt, maxKeywords = 5) {
    const tokens = (prompt || '')
        .replace(/[^\w\s-]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !/^\d+$/.test(w));
    const seen = new Set();
    const out = [];
    for (const t of tokens) {
        const lower = t.toLowerCase();
        if (!seen.has(lower)) {
            seen.add(lower);
            out.push(t);
            if (out.length >= maxKeywords) break;
        }
    }
    return out;
}

/** Build grep context string from mission prompt (call grep_search for each keyword). */
async function buildGrepContext(prompt) {
    const keywords = missionKeywords(prompt, 4);
    if (!keywords.length) return '';
    const allMatches = [];
    for (const kw of keywords) {
        const r = await callTool('grep_search', { pattern: kw, pathPrefix: '' });
        if (r.ok && Array.isArray(r.result)) {
            for (const m of r.result) {
                allMatches.push({ path: m.path, lineNumber: m.lineNumber, line: m.line });
            }
        }
    }
    const byPath = new Map();
    for (const m of allMatches) {
        if (!byPath.has(m.path)) byPath.set(m.path, []);
        byPath.get(m.path).push(m);
    }
    const lines = [];
    const maxPerPath = 5;
    const maxTotal = 30;
    for (const [p, arr] of byPath.entries()) {
        if (lines.length >= maxTotal) break;
        for (let i = 0; i < Math.min(maxPerPath, arr.length) && lines.length < maxTotal; i++) {
            const m = arr[i];
            lines.push(`${p}:${m.lineNumber}: ${m.line}`);
        }
    }
    return lines.length ? lines.join('\n') : '';
}

/** Build file context string from task hints (read_file for each path-like hint). Cap total ~25KB. */
async function buildFileContextForTask(task, maxChars = 25000) {
    const hints = task.hints ? String(task.hints).split(/[\s,]+/).map((s) => s.trim()).filter(Boolean) : [];
    const filePaths = hints.filter((h) => /\.(js|ts|json|md|mjs|cjs|tsx|jsx|yml|yaml|html|css)$/i.test(h) || h.includes('/'));
    let total = 0;
    const parts = [];
    for (const p of filePaths) {
        if (total >= maxChars) break;
        const r = await callTool('read_file', { path: p });
        if (r.ok && typeof r.result === 'string') {
            const snippet = r.result.length > 8000 ? r.result.slice(0, 8000) + '\n... (truncated)' : r.result;
            parts.push(`--- ${p} ---\n${snippet}\n`);
            total += snippet.length;
        }
    }
    return parts.join('\n');
}

export async function runPipeline(runId, opts = {}) {
    const { prompt = '', maxParallelPlanners = 2, maxParallelCoders = 3 } = opts;
    const log = (role, stage, message) => appendLog(runId, { role, stage, message });

    try {
        if (checkCancelled(runId, log)) return;
        updateRun(runId, { status: 'research' });
        log('system', 'research', 'Running Researcher…\n');

        const researchResult = await runResearcher(prompt, {});
        if (!researchResult.ok) {
            updateRun(runId, { status: 'error', error: researchResult.error });
            log('system', 'error', 'Researcher failed: ' + researchResult.error + '\n');
            return;
        }

        const flightPlan = researchResult.flightPlan;
        updateRun(runId, { flightPlan });
        log('system', 'research', `Flight plan: ${flightPlan.length} task(s).\n`);

        if (checkCancelled(runId, log)) return;

        const grepContext = await buildGrepContext(prompt);

        const allEdits = []; // { path, content }[]
        const limitPlanners = pLimit(Math.max(1, Math.min(5, maxParallelPlanners)));
        const limitCoders = pLimit(Math.max(1, Math.min(10, maxParallelCoders)));

        if (checkCancelled(runId, log)) return;
        updateRun(runId, { status: 'planning' });
        const planResults = await Promise.all(
            flightPlan.map((task, i) =>
                limitPlanners(async () => {
                    log('system', 'planning', `Planner: ${task.title}\n`);
                    const fileContext = await buildFileContextForTask(task);
                    const planResult = await runPlanner(task, { fileContext, grepContext });
                    if (planResult.ok) {
                        const n = (planResult.steps && planResult.steps.length) || 0;
                        log('system', 'planning', `Planner: ${task.title} — ${n} step(s)\n`);
                    }
                    return { task, planResult, taskIndex: i };
                })
            )
        );

        for (const { planResult } of planResults) {
            if (!planResult.ok) {
                updateRun(runId, { status: 'error', error: planResult.error });
                log('system', 'error', 'Planner failed: ' + planResult.error + '\n');
                return;
            }
        }

        const allSteps = planResults.flatMap(({ planResult }) => planResult.steps);

        if (checkCancelled(runId, log)) return;
        updateRun(runId, { status: 'coding' });
        const coderResults = await Promise.all(
            allSteps.map((step, j) =>
                limitCoders(async () => {
                    log('system', 'coding', `Coder: ${step.what}\n`);
                    const fileContext = {};
                    for (const p of step.files || []) {
                        const r = await callTool('read_file', { path: p });
                        if (r.ok && typeof r.result === 'string') fileContext[p] = r.result;
                    }
                    const coderResult = await runCoder(step, fileContext, {});
                    return { step, coderResult, stepIndex: j };
                })
            )
        );

        const stepResults = [];
        for (const { step, coderResult } of coderResults) {
            if (!coderResult.ok) {
                stepResults.push({ step, status: 'failed', reason: coderResult.error });
                log('system', 'coding', `Coder: ${step.what} — failed: ${coderResult.error}\n`);
                continue;
            }
            const validation = await validateCoderStep(step, prompt, coderResult.edits || []);
            stepResults.push({
                step,
                status: validation.status,
                edits: validation.status === 'done' ? coderResult.edits : undefined,
                reason: validation.reason,
            });
            if (validation.status === 'done') {
                const n = (coderResult.edits || []).length;
                log('system', 'coding', `Coder: ${step.what} — done (${n} edit(s))\n`);
                allEdits.push(...(coderResult.edits || []));
            } else {
                log('system', 'coding', `Coder: ${step.what} — failed${validation.reason ? ': ' + validation.reason : ''}\n`);
            }
        }

        const run = getRun(runId);
        if (run) run.stepResults = stepResults;

        // Aggregate by path (last write wins)
        const byPath = new Map();
        for (const e of allEdits) {
            if (e.path) byPath.set(e.path, e.content);
        }
        const aggregatedEdits = Array.from(byPath.entries()).map(([path, content]) => ({ path, content }));

        if (run) run.edits = aggregatedEdits;

        if (aggregatedEdits.length === 0) {
            updateRun(runId, { status: 'done' });
            log('system', 'done', 'Run complete (no edits approved).\n');
            return;
        }

        if (checkCancelled(runId, log)) return;
        updateRun(runId, { status: 'creating_pr' });
        log('system', 'creating_pr', `Collected ${aggregatedEdits.length} file edit(s). Creating PR…\n`);

        const prResult = await createPrIfConfigured(runId, { prompt, edits: aggregatedEdits });
        if (prResult.ok && prResult.prUrl) {
            updateRun(runId, { status: 'done', prUrl: prResult.prUrl });
            log('system', 'done', 'PR: ' + prResult.prUrl + '\n');
        } else if (prResult.error) {
            updateRun(runId, { status: 'error', error: prResult.error });
            log('system', 'error', 'PR failed: ' + prResult.error + '\n');
        } else {
            updateRun(runId, { status: 'done' });
            log('system', 'done', 'Run complete (PR not configured or dry run).\n');
        }
    } catch (err) {
        updateRun(runId, { status: 'error', error: err.message || String(err) });
        appendLog(runId, { role: 'system', stage: 'error', message: (err.message || String(err)) + '\n' });
    }
}

/**
 * Stub: create PR when GITHUB_TOKEN etc. are set; otherwise no-op.
 * @param {string} runId
 * @param {object} opts
 * @param {string} [opts.prompt]
 * @param {Array<{ path: string, content: string }>} [opts.edits]
 * @returns {Promise<{ ok: boolean, prUrl?: string, error?: string }>}
 */
async function createPrIfConfigured(runId, opts = {}) {
    try {
        const creator = await import('./prCreator.js').then((m) => m.createPr).catch(() => null);
        if (!creator) return { ok: true };
        return await creator(runId, opts);
    } catch (e) {
        return { ok: false, error: e.message || String(e) };
    }
}
