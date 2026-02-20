/**
 * Orchestrator: runs Researcher -> Planners -> Coders, aggregates edits, then PR.
 * Uses tool registry for read_file and grep_search; passes fileContext and grepContext to Planner.
 */
import pLimit from 'p-limit';
import { appendLog, getRun, updateRun, isRunCancelled } from './runStore.js';
import { runResearcher, runPlanner, runCoder, validateCoderStep, runReviewer } from './agents.js';
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

/** Patterns we always grep when mission mentions embed/Discord/branding (so Planner sees the real pattern). */
const MISSION_GREP_PATTERNS = ['createSplitEmbeds', 'EmbedBuilder', 'message.reply', 'SUMMARY_DISCLAIMER'];

/**
 * Build grep context from mission: returns { grepText, grepPaths }.
 * grepPaths = set of file paths that matched, so we can include them in Planner file context.
 */
async function buildGrepContext(prompt) {
    const keywords = missionKeywords(prompt, 5);
    const patterns = [...keywords];
    const promptLower = (prompt || '').toLowerCase();
    if (promptLower.includes('embed') || promptLower.includes('discord') || promptLower.includes('branding') || promptLower.includes('!mu') || promptLower.includes('!mq') || promptLower.includes('!export')) {
        patterns.push(...MISSION_GREP_PATTERNS);
    }
    const seen = new Set();
    const allMatches = [];
    const pathSet = new Set();
    for (const kw of patterns) {
        if (!kw || seen.has(kw.toLowerCase())) continue;
        seen.add(kw.toLowerCase());
        const r = await callTool('grep_search', { pattern: kw, pathPrefix: 'src' });
        if (r.ok && Array.isArray(r.result)) {
            for (const m of r.result) {
                allMatches.push({ path: m.path, lineNumber: m.lineNumber, line: m.line });
                pathSet.add(m.path);
            }
        }
    }
    const byPath = new Map();
    for (const m of allMatches) {
        if (!byPath.has(m.path)) byPath.set(m.path, []);
        byPath.get(m.path).push(m);
    }
    const lines = [];
    const maxPerPath = 6;
    const maxTotal = 50;
    for (const [p, arr] of byPath.entries()) {
        if (lines.length >= maxTotal) break;
        for (let i = 0; i < Math.min(maxPerPath, arr.length) && lines.length < maxTotal; i++) {
            const m = arr[i];
            lines.push(`${p}:${m.lineNumber}: ${m.line}`);
        }
    }
    const grepText = lines.length ? lines.join('\n') : '';
    return { grepText, grepPaths: pathSet };
}

/** Parse file paths from task hints (comma/space separated); return paths that look like source files. */
function parseHintPaths(task) {
    const hints = task.hints ? String(task.hints).split(/[\s,]+/).map((s) => s.trim()).filter(Boolean) : [];
    return hints.filter((h) => /\.(js|ts|json|md|mjs|cjs|tsx|jsx|yml|yaml|html|css)$/i.test(h) || (h.includes('/') && h.length > 2));
}

/** Build run-wide allowed path set: grep paths + all task hints from flight plan. */
function buildAllowedPaths(flightPlan, grepPaths) {
    const pathSet = new Set(grepPaths || []);
    for (const task of flightPlan || []) {
        for (const p of parseHintPaths(task)) pathSet.add(p);
    }
    return pathSet;
}

/** Build file context for a task: hint paths + grep-matched paths (so key files like exportHandler are included). */
async function buildFileContextForTask(task, grepPaths, maxChars = 52000) {
    const hints = task.hints ? String(task.hints).split(/[\s,]+/).map((s) => s.trim()).filter(Boolean) : [];
    const fromHints = hints.filter((h) => /\.(js|ts|json|md|mjs|cjs|tsx|jsx|yml|yaml|html|css)$/i.test(h) || (h.includes('/') && h.length > 2));
    const pathSet = new Set(fromHints);
    if (grepPaths && grepPaths.size) {
        grepPaths.forEach((p) => pathSet.add(p));
    }
    const pathList = Array.from(pathSet).filter((p) => /\.(js|ts|json|mjs|cjs|tsx|jsx|yml|yaml|html|css)$/i.test(p));
    let total = 0;
    const perFileMax = 14000;
    const parts = [];
    for (const p of pathList) {
        if (total >= maxChars) break;
        const r = await callTool('read_file', { path: p });
        if (r.ok && typeof r.result === 'string') {
            const snippet = r.result.length > perFileMax ? r.result.slice(0, perFileMax) + '\n... (truncated)' : r.result;
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

        const { grepText: grepContext, grepPaths } = await buildGrepContext(prompt);
        const allowedPaths = buildAllowedPaths(flightPlan, grepPaths);

        const allEdits = []; // { path, content }[]
        const limitPlanners = pLimit(Math.max(1, Math.min(5, maxParallelPlanners)));
        const limitCoders = pLimit(Math.max(1, Math.min(10, maxParallelCoders)));

        if (checkCancelled(runId, log)) return;
        updateRun(runId, { status: 'planning' });
        const planResults = await Promise.all(
            flightPlan.map((task, i) =>
                limitPlanners(async () => {
                    log('system', 'planning', `Planner: ${task.title}\n`);
                    const fileContext = await buildFileContextForTask(task, grepPaths);
                    const planResult = await runPlanner(task, { fileContext, grepContext });
                    if (planResult.ok) {
                        const n = (planResult.steps && planResult.steps.length) || 0;
                        log('system', 'planning', `Planner: ${task.title} — ${n} step(s)\n`);
                    }
                    return { task, planResult, taskIndex: i };
                })
            )
        );

        for (const { task, planResult } of planResults) {
            if (!planResult.ok) {
                log('system', 'planning', `Planner: ${task.title} — failed: ${planResult.error}\n`);
            }
        }

        const allSteps = planResults.flatMap(({ task, planResult }) =>
            planResult.ok && planResult.steps && planResult.steps.length
                ? planResult.steps.map((step) => ({ step, task }))
                : []
        );
        if (allSteps.length === 0) {
            updateRun(runId, { status: 'error', error: 'No implementation steps could be parsed from any Planner.' });
            log('system', 'error', 'No implementation steps could be parsed from any Planner.\n');
            return;
        }

        if (checkCancelled(runId, log)) return;
        updateRun(runId, { status: 'coding' });
        const coderResults = await Promise.all(
            allSteps.map(({ step, task }, j) =>
                limitCoders(async () => {
                    log('system', 'coding', `Coder: ${step.what}\n`);
                    const fileContext = {};
                    for (const p of step.files || []) {
                        const r = await callTool('read_file', { path: p });
                        if (r.ok && typeof r.result === 'string') fileContext[p] = r.result;
                    }
                    if (Object.keys(fileContext).length === 0) {
                        for (const p of parseHintPaths(task)) {
                            const r = await callTool('read_file', { path: p });
                            if (r.ok && typeof r.result === 'string') fileContext[p] = r.result;
                        }
                    }
                    const coderResult = await runCoder(step, fileContext, {});
                    return { step, task, coderResult, stepIndex: j };
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
            const validation = await validateCoderStep(step, prompt, coderResult.edits || [], { allowedPaths });
            stepResults.push({
                step,
                status: validation.status,
                edits: validation.status === 'done' ? coderResult.edits : undefined,
                reason: validation.reason,
            });
            if (validation.status === 'done') {
                const allowed = (coderResult.edits || []).filter((e) => e.path && allowedPaths.has(e.path));
                const n = allowed.length;
                log('system', 'coding', `Coder: ${step.what} — done (${n} edit(s))\n`);
                allEdits.push(...allowed);
            } else {
                log('system', 'coding', `Coder: ${step.what} — failed${validation.reason ? ': ' + validation.reason : ''}\n`);
            }
        }

        const run = getRun(runId);
        if (run) run.stepResults = stepResults;

        // Aggregate edits by path.
        // Patch edits ({path, search, replace}) accumulate as a list.
        // Full-content edits ({path, content}) override everything for that path.
        const byPathPatches = new Map(); // path -> [{search, replace}]
        const byPathContent = new Map(); // path -> string (full content, takes precedence)
        for (const e of allEdits) {
            if (!e.path) continue;
            if (e.search !== undefined) {
                if (!byPathPatches.has(e.path)) byPathPatches.set(e.path, []);
                byPathPatches.get(e.path).push({ search: e.search, replace: e.replace ?? '' });
            } else {
                byPathContent.set(e.path, e.content ?? '');
            }
        }

        // Resolve patch edits: read current file, apply search/replace, produce full content.
        const resolvedPatches = [];
        for (const [filePath, patches] of byPathPatches.entries()) {
            if (byPathContent.has(filePath)) continue; // full-content edit takes precedence
            const readResult = await callTool('read_file', { path: filePath });
            if (!readResult.ok) {
                log('system', 'coding', `[patch] Could not read ${filePath} for patching: ${readResult.error}\n`);
                continue;
            }
            let content = readResult.result;
            for (const { search, replace } of patches) {
                if (search === '') {
                    // New file or full replace
                    content = replace;
                } else if (content.includes(search)) {
                    content = content.replace(search, replace);
                } else {
                    log('system', 'coding', `[patch] Search text not found in ${filePath} — patch skipped\n`);
                }
            }
            resolvedPatches.push({ path: filePath, content });
        }

        const aggregatedEdits = [
            ...Array.from(byPathContent.entries()).map(([path, content]) => ({ path, content })),
            ...resolvedPatches,
        ];

        if (run) run.edits = aggregatedEdits;

        if (aggregatedEdits.length === 0) {
            updateRun(runId, { status: 'done' });
            log('system', 'done', 'Run complete (no edits approved).\n');
            return;
        }

        const MAX_REVIEW_ROUNDS = 2;
        let reviewRound = 0;
        let editsToReview = [...aggregatedEdits];

        while (reviewRound < MAX_REVIEW_ROUNDS) {
            if (checkCancelled(runId, log)) return;
            updateRun(runId, { status: 'reviewing' });
            log('system', 'reviewing', reviewRound === 0 ? 'Running Reviewer…\n' : `Review round ${reviewRound + 1}…\n`);

            const reviewResult = await runReviewer(editsToReview, prompt, {});
            if (!reviewResult.ok) {
                log('system', 'reviewing', `Reviewer failed: ${reviewResult.error}\n`);
                break;
            }
            if (!reviewResult.feedback || !reviewResult.feedback.trim()) {
                break;
            }

            log('system', 'reviewing', `Reviewer requested changes: ${reviewResult.feedback}\n`);
            const paths = editsToReview.map((e) => e.path).filter(Boolean);
            const syntheticStep = {
                what: 'Address reviewer feedback',
                changeDescription: reviewResult.feedback,
                files: paths,
            };
            const fileContext = {};
            for (const e of editsToReview) {
                if (e.path && e.content != null) fileContext[e.path] = e.content;
            }
            const fixResult = await runCoder(syntheticStep, fileContext, { reviewFeedback: reviewResult.feedback });
            if (!fixResult.ok || !fixResult.edits?.length) {
                log('system', 'reviewing', `Coder fix pass failed or produced no edits: ${fixResult.error || 'no edits'}\n`);
                break;
            }
            const byPath = new Map(editsToReview.map((e) => [e.path, e.content]));
            for (const e of fixResult.edits) {
                if (e.path && allowedPaths.has(e.path)) byPath.set(e.path, e.content);
            }
            editsToReview = Array.from(byPath.entries()).map(([path, content]) => ({ path, content }));
            const runAfterReview = getRun(runId);
            if (runAfterReview) runAfterReview.edits = editsToReview;
            reviewRound++;
        }

        if (checkCancelled(runId, log)) return;
        updateRun(runId, { status: 'creating_pr' });
        log('system', 'creating_pr', `Collected ${editsToReview.length} file edit(s). Creating PR…\n`);

        const prResult = await createPrIfConfigured(runId, { prompt, edits: editsToReview });
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
