/**
 * Orchestrator: runs Researcher -> Planners -> Coders, aggregates edits, then PR.
 * Uses tool registry for read_file and grep_search; passes fileContext and grepContext to Planner.
 */
import pLimit from 'p-limit';
import { setMaxListeners } from 'node:events';
import { EmbedBuilder } from 'discord.js';
import { getClient } from '../../shared/discordClient.js';
import { INFO_EMBED_COLOR } from '../../messages/faqAndAliasHandler.js';
import { appendLog, getRun, updateRun, isRunCancelled, notifyDocsUpdate, registerAbortController, unregisterAbortController } from './runStore.js';
import { persistRunToS3 } from './agentRunPersistence.js';
import { runResearcher, runPlanner, runCoder, validateCoderStep, runReviewer, runAuditor, runAsk, runTester } from './agents.js';
import { callTool } from './toolRegistry.js';
import { getFileTree } from './codebaseTools.js';
import { getBranchDiff, getDiffForPullRequest } from './repoBrowser.js';

/** Parse Quality (Tester) report recommendation. Returns 'merge' | 'request_changes' | 'reject' (or 'merge' if unclear). */
function parseQualityRecommendation(report) {
    if (!report || typeof report !== 'string') return 'merge';
    const s = report.toLowerCase();
    if (/\*\*reject\*\*|recommendation.*reject/i.test(report) || (s.includes('reject') && s.includes('recommendation'))) return 'reject';
    if (/\*\*request changes\*\*|recommendation.*request\s+changes/i.test(report) || (s.includes('request') && s.includes('change'))) return 'request_changes';
    if (/\*\*merge\*\*|recommendation.*merge/i.test(report)) return 'merge';
    return 'merge';
}

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

/**
 * Derive a short one-line title from the flightPlan for display in the run list and PR.
 * @param {Array<{ title?: string, id?: string }>} flightPlan
 * @returns {string}
 */
function deriveRunTitle(flightPlan) {
    if (!flightPlan || !flightPlan.length) return '';
    if (flightPlan.length === 1) return flightPlan[0].title || flightPlan[0].id || '';
    const first = flightPlan[0].title || flightPlan[0].id || '';
    const second = flightPlan[1].title || flightPlan[1].id || '';
    const rest = flightPlan.length - 2;
    const combined = rest > 0
        ? `${first}, ${second} (+${rest} more)`
        : `${first} and ${second}`;
    return combined.length > 90 ? combined.slice(0, 87) + '…' : combined;
}

/** Patterns we always grep when mission mentions embed/Discord/branding (so Planner sees the real pattern). */
const MISSION_GREP_PATTERNS = ['createSplitEmbeds', 'EmbedBuilder', 'message.reply', 'SUMMARY_DISCLAIMER'];

/**
 * Build grep context from mission: returns { grepText, grepPaths }.
 * grepPaths = set of file paths that matched, so we can include them in Planner file context.
 */
async function buildGrepContext(prompt) {
    const keywords = missionKeywords(prompt, 5);
    // Extract Discord !command tokens verbatim (e.g. !mu, !mq, !export) — missionKeywords strips the ! so we extract them separately
    const commandTokens = [...(prompt || '').matchAll(/![a-z][a-zA-Z0-9]*/g)].map((m) => m[0]);
    const patterns = [...new Set([...commandTokens, ...keywords])];
    const promptLower = (prompt || '').toLowerCase();
    if (promptLower.includes('embed') || promptLower.includes('discord') || promptLower.includes('branding') || commandTokens.length > 0) {
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

/** Max lines per file to include in entry-point context for Ask/Audit. */
const ENTRY_POINT_MAX_LINES = 120;

/** Paths to always include for Ask/Audit so the agent sees entry points and routes (e.g. health check). */
const ENTRY_POINT_PATHS = ['main.js', 'src/app.js', 'src/admin/routes.js'];

/**
 * Build a short "entry point" context string for Ask and Audit so they see main.js, app.js, and admin routes.
 * @returns {Promise<string>}
 */
async function getEntryPointContext() {
    const parts = [];
    for (const filePath of ENTRY_POINT_PATHS) {
        try {
            const r = await callTool('read_file', { path: filePath });
            if (!r.ok || typeof r.result !== 'string') continue;
            const lines = r.result.split('\n').slice(0, ENTRY_POINT_MAX_LINES);
            const excerpt = lines.join('\n');
            if (excerpt.trim()) parts.push(`=== ${filePath} ===\n${excerpt}`);
        } catch (_) {
            // skip missing or unreadable file
        }
    }
    return parts.length ? parts.join('\n\n') : '';
}

/** Parse file paths from task hints (comma/space separated); return paths that look like source files. */
function parseHintPaths(task) {
    const hints = task.hints ? String(task.hints).split(/[\s,]+/).map((s) => s.trim()).filter(Boolean) : [];
    return hints.filter((h) => /\.(js|ts|json|md|mjs|cjs|tsx|jsx|yml|yaml|html|css)$/i.test(h) || (h.includes('/') && h.length > 2));
}

/**
 * Scan aggregated edits for import statements that reference non-existent local modules.
 * Returns an array of warning strings (empty = all clear).
 * Only checks relative imports (starting with ./ or ../).
 */
async function validateImportPaths(aggregatedEdits) {
    const warnings = [];
    const editedPaths = new Set(aggregatedEdits.map((e) => e.path));
    const importRe = /(?:import\s.*?from\s+|require\s*\()\s*['"](\.[^'"]+)['"]/g;
    for (const edit of aggregatedEdits) {
        if (!edit.path || !edit.content) continue;
        const fileDir = edit.path.split('/').slice(0, -1).join('/');
        let m;
        importRe.lastIndex = 0;
        while ((m = importRe.exec(edit.content)) !== null) {
            const importSpec = m[1];
            // Resolve the import relative to the editing file's directory
            const segments = (fileDir ? fileDir + '/' + importSpec : importSpec).split('/');
            const resolved = [];
            for (const seg of segments) {
                if (seg === '..') resolved.pop();
                else if (seg !== '.') resolved.push(seg);
            }
            const resolvedPath = resolved.join('/');
            // Check with common JS extensions
            const candidates = [resolvedPath, resolvedPath + '.js', resolvedPath + '/index.js'];
            const inEdits = candidates.some((c) => editedPaths.has(c));
            if (inEdits) continue;
            // Check if the file exists on disk
            let found = false;
            for (const candidate of candidates) {
                const r = await callTool('read_file', { path: candidate });
                if (r.ok && r.result != null) { found = true; break; }
            }
            if (!found) {
                warnings.push(`${edit.path} imports '${importSpec}' → resolved to '${resolvedPath}' which does not exist`);
            }
        }
    }
    return warnings;
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
    const { maxParallelPlanners = 2, maxParallelCoders = 3 } = opts;
    const run = getRun(runId);
    const resume = !!opts.resume;
    const prompt = (opts.prompt ?? run?.prompt ?? '').trim();
    const model = opts.model ?? run?.model ?? '';
    const log = (role, stage, message) => appendLog(runId, { role, stage, message });

    const abortCtrl = new AbortController();
    setMaxListeners(50, abortCtrl.signal);
    const signal = abortCtrl.signal;
    registerAbortController(runId, abortCtrl);

    let flightPlan = run?.flightPlan;
    let allSteps = run?.steps;
    const existingStepResults = run?.stepResults || [];

    try {
        if (checkCancelled(runId, log)) return;

        const currentRunEarly = getRun(runId);
        if (currentRunEarly?.runMode === 'review') {
            let branchName = (prompt || '').trim()
                .replace(/^review\s+branch\s+/i, '')
                .replace(/^review\s+/i, '')
                .trim();
            if (branchName.includes('\n')) branchName = branchName.split('\n')[0].trim();
            if (!branchName) {
                updateRun(runId, { status: 'error', error: 'Branch name required. Enter a branch name (e.g. agent/run-xyz or feature/abc).' });
                log('system', 'error', 'No branch name in prompt.\n');
                return;
            }
            updateRun(runId, { status: 'planning' });
            log('system', 'planning', 'Getting diff…\n');
            const diffResult = await getBranchDiff(branchName, 'main');
            if (!diffResult.ok) {
                updateRun(runId, { status: 'error', error: diffResult.error || 'Branch not found or not accessible' });
                log('system', 'error', (diffResult.error || 'Branch not found') + '\n');
                return;
            }
            let diffText = diffResult.diffText || '';
            const MAX_DIFF_CHARS = 80 * 1024;
            if (diffText.length > MAX_DIFF_CHARS) {
                diffText = 'Diff truncated; first ' + MAX_DIFF_CHARS + ' chars shown.\n\n' + diffText.slice(0, MAX_DIFF_CHARS);
            }
            log('system', 'planning', 'Running Tester (review report)…\n');
            const testerResult = await runTester(branchName, {
                diffText,
                baseBranch: diffResult.baseBranch || 'main',
                headBranch: diffResult.headBranch || branchName,
                signal,
                model,
                runId,
            });
            if (!testerResult.ok) {
                updateRun(runId, { status: 'error', error: testerResult.error });
                log('system', 'error', 'Tester failed: ' + testerResult.error + '\n');
                return;
            }
            updateRun(runId, {
                status: 'done',
                reviewReport: testerResult.report,
                ...(testerResult.diagramKeys?.length && { diagramKeys: testerResult.diagramKeys }),
                inputTokens: (currentRunEarly.inputTokens || 0) + (testerResult.inputTokens || 0),
                outputTokens: (currentRunEarly.outputTokens || 0) + (testerResult.outputTokens || 0),
            });
            if (testerResult.warnings?.length) {
                for (const w of testerResult.warnings) log('system', 'error', w + '\n');
            }
            log('system', 'done', 'Review report ready.\n');
            await persistRunToS3(runId);
            return;
        }

        const shouldRunResearch = !resume || !flightPlan?.length;
        if (shouldRunResearch) {
            updateRun(runId, { status: 'research' });
            log('system', 'research', resume ? 'Resuming: re-running Researcher…\n' : 'Running Researcher…\n');

            const researchResult = await runResearcher(prompt, { docs: getRun(runId)?.docs, signal, model });
            if (!researchResult.ok) {
                updateRun(runId, { status: 'error', error: researchResult.error });
                log('system', 'error', 'Researcher failed: ' + researchResult.error + '\n');
                return;
            }

            flightPlan = researchResult.flightPlan;
            const overview = [prompt.trim()].concat(flightPlan.map((t) => `- ${t.title || t.id}`)).join('\n\nTasks:\n');
            const requirements = flightPlan.map((t) => (t.title ? `**${t.title}**: ` : '') + (t.description || '')).join('\n\n');
            const title = deriveRunTitle(flightPlan);
            updateRun(runId, { flightPlan, title, docs: { overview, requirements }, inputTokens: researchResult.inputTokens || 0, outputTokens: researchResult.outputTokens || 0 });
            notifyDocsUpdate(runId);
            log('system', 'research', `Flight plan: ${flightPlan.length} task(s).\n`);
            await persistRunToS3(runId);
        }

        if (checkCancelled(runId, log)) return;

        const currentRun = getRun(runId);
        if (currentRun?.runMode === 'audit') {
            updateRun(runId, { status: 'planning' });
            log('system', 'planning', 'Running Auditor (report only)…\n');
            const { grepText: grepFromMission } = await buildGrepContext(prompt);
            const entryPointContext = await getEntryPointContext();
            const grepContext = entryPointContext
                ? (entryPointContext + '\n\nRelevant snippets from mission:\n' + (grepFromMission || '(none)'))
                : grepFromMission;
            let treeContext = '';
            try {
                const treeResult = await getFileTree('', 3);
                if (treeResult.ok && treeResult.tree) {
                    treeContext = JSON.stringify(treeResult.tree, null, 2);
                }
            } catch (_) {}
            const flightPlanSummary = (flightPlan || []).map((t) => `- ${t.title || t.id}: ${t.description || ''}`).join('\n');
            const auditResult = await runAuditor(prompt, { grepContext, treeContext, flightPlanSummary, signal, model, runId });
            if (!auditResult.ok) {
                updateRun(runId, { status: 'error', error: auditResult.error });
                log('system', 'error', 'Auditor failed: ' + auditResult.error + '\n');
                return;
            }
            updateRun(runId, {
                status: 'done',
                auditReport: auditResult.report,
                ...(auditResult.diagramKeys?.length && { diagramKeys: auditResult.diagramKeys }),
                inputTokens: (currentRun.inputTokens || 0) + (auditResult.inputTokens || 0),
                outputTokens: (currentRun.outputTokens || 0) + (auditResult.outputTokens || 0),
            });
            if (auditResult.warnings?.length) {
                for (const w of auditResult.warnings) log('system', 'error', w + '\n');
            }
            log('system', 'done', 'Audit report ready.\n');
            await persistRunToS3(runId);
            return;
        }

        if (currentRun?.runMode === 'ask') {
            updateRun(runId, { status: 'planning' });
            log('system', 'planning', 'Answering question…\n');
            const { grepText: grepFromMission } = await buildGrepContext(prompt);
            const entryPointContext = await getEntryPointContext();
            const grepContext = entryPointContext
                ? (entryPointContext + '\n\nRelevant snippets from question:\n' + (grepFromMission || '(none)'))
                : grepFromMission;
            let treeContext = '';
            try {
                const treeResult = await getFileTree('', 3);
                if (treeResult.ok && treeResult.tree) {
                    treeContext = JSON.stringify(treeResult.tree, null, 2);
                }
            } catch (_) {}
            const flightPlanSummary = (flightPlan || []).map((t) => `- ${t.title || t.id}: ${t.description || ''}`).join('\n');
            const askResult = await runAsk(prompt, { grepContext, treeContext, flightPlanSummary, signal, model, runId });
            if (!askResult.ok) {
                updateRun(runId, { status: 'error', error: askResult.error });
                log('system', 'error', 'Ask failed: ' + askResult.error + '\n');
                return;
            }
            updateRun(runId, {
                status: 'done',
                askResponse: askResult.report,
                ...(askResult.diagramKeys?.length && { diagramKeys: askResult.diagramKeys }),
                inputTokens: (currentRun.inputTokens || 0) + (askResult.inputTokens || 0),
                outputTokens: (currentRun.outputTokens || 0) + (askResult.outputTokens || 0),
            });
            if (askResult.warnings?.length) {
                for (const w of askResult.warnings) log('system', 'error', w + '\n');
            }
            log('system', 'done', 'Answer ready.\n');
            await persistRunToS3(runId);
            return;
        }

        const { grepText: grepContext, grepPaths } = await buildGrepContext(prompt);
        const allowedPaths = buildAllowedPaths(flightPlan, grepPaths);
        // New Discord commands need main.js (routing); grep only searches src/ so add it when mission mentions a command.
        if (/![a-z][a-zA-Z0-9-]*|discord command|new command/i.test(prompt || '')) {
            allowedPaths.add('main.js');
        }
        // Missions control panel: main page HTML+script in agentPageContentInner.html; models API in agentRoutes.js.
        const AGENT_ROUTES_PATH = 'src/admin/agent/agentRoutes.js';
        const AGENT_PAGE_INNER_PATH = 'src/admin/agent/agentPageContentInner.html';
        if (/\/admin\/agent|missions control panel|model dropdown|model menu|agent page|model selector/i.test(prompt || '')) {
            allowedPaths.add(AGENT_ROUTES_PATH);
            allowedPaths.add(AGENT_PAGE_INNER_PATH);
        }

        const allEdits = [];
        const isClaude = typeof model === 'string' && model.trim().toLowerCase().startsWith('claude-');
        // Claude org limit 30k input tokens/min: run planners and coders one at a time to avoid 429s.
        const plannersConcurrency = isClaude ? 1 : Math.max(1, Math.min(5, maxParallelPlanners));
        const codersConcurrency = isClaude ? 1 : Math.max(1, Math.min(10, maxParallelCoders));
        const limitPlanners = pLimit(plannersConcurrency);
        const limitCoders = pLimit(codersConcurrency);

        const shouldRunPlanning = !resume || !allSteps?.length;
        if (shouldRunPlanning) {
            if (checkCancelled(runId, log)) return;
            updateRun(runId, { status: 'planning' });
            log('system', 'planning', resume ? 'Resuming: re-running Planners…\n' : 'Running Planners…\n');

            const planResults = await Promise.all(
                flightPlan.map((task, i) =>
                    limitPlanners(async () => {
                        log('system', 'planning', `Planner: ${task.title}\n`);
                        const fileContext = await buildFileContextForTask(task, grepPaths);
                        const planResult = await runPlanner(task, { fileContext, grepContext, docs: getRun(runId)?.docs, flightPlan, steps: getRun(runId)?.steps, signal, model });
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

            allSteps = planResults.flatMap(({ task, planResult }) =>
                planResult.ok && planResult.steps && planResult.steps.length
                    ? planResult.steps.map((step) => ({ step, task }))
                    : []
            );
            if (allSteps.length === 0) {
                updateRun(runId, { status: 'error', error: 'No implementation steps could be parsed from any Planner.' });
                log('system', 'error', 'No implementation steps could be parsed from any Planner.\n');
                return;
            }

            const planInputTokens = planResults.reduce((s, { planResult }) => s + (planResult.inputTokens || 0), 0);
            const planOutputTokens = planResults.reduce((s, { planResult }) => s + (planResult.outputTokens || 0), 0);
            updateRun(runId, { steps: allSteps, inputTokens: planInputTokens, outputTokens: planOutputTokens });
            const runAfterPlan = getRun(runId);
            const existingReqs = runAfterPlan?.docs?.requirements || '';
            const implSteps = allSteps.map(({ step }, i) => `${i + 1}. ${step.what || 'Step'}`).join('\n');
            const requirementsWithImpl = existingReqs + (implSteps ? '\n\nImplementation steps:\n' + implSteps : '');
            if (requirementsWithImpl !== existingReqs) {
                updateRun(runId, { docs: { requirements: requirementsWithImpl } });
                notifyDocsUpdate(runId);
            }
            await persistRunToS3(runId);
        }

        if (checkCancelled(runId, log)) return;
        updateRun(runId, { status: 'coding' });

        const stepsToRunIndices = allSteps.map((_, j) => j).filter((j) => {
            const existing = existingStepResults[j];
            return !existing || existing.status !== 'done';
        });

        const coderResults = await Promise.all(
            allSteps.map(({ step, task }, j) =>
                limitCoders(async () => {
                    if (!stepsToRunIndices.includes(j)) {
                        return { step, task, coderResult: null, stepIndex: j, useExisting: true, existing: existingStepResults[j] };
                    }
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
                    // If the step or mission references Discord commands, inject promptLoader.js and main.js
                    // so the Coder sees how commands are registered and can add PROMPT_META / routing.
                    const stepText = ((step.what || '') + ' ' + (step.changeDescription || '') + ' ' + prompt).toLowerCase();
                    const isDiscordCommandStep = /!mu|!mq|!export|!fd|!latest|![\w-]+|discord command|register.*command/i.test(stepText);
                    const PROMPT_LOADER_PATH = 'src/shared/promptLoader.js';
                    const MAIN_PATH = 'main.js';
                    if (isDiscordCommandStep) {
                        if (!fileContext[PROMPT_LOADER_PATH]) {
                            const r = await callTool('read_file', { path: PROMPT_LOADER_PATH });
                            if (r.ok && typeof r.result === 'string') fileContext[PROMPT_LOADER_PATH] = r.result;
                        }
                        if (!fileContext[MAIN_PATH]) {
                            const r = await callTool('read_file', { path: MAIN_PATH });
                            if (r.ok && typeof r.result === 'string') fileContext[MAIN_PATH] = r.result;
                        }
                    }
                    // Missions UI: main page form + script live in agentPageContentInner.html; model API in agentRoutes.js.
                    const isMissionsUiStep = /\/admin\/agent|missions control panel|model dropdown|model menu|agent page|model selector|modelmeta|model meta/i.test(stepText);
                    const isFormTextareaStep = /textarea|tip|help line|help text|mission prompt/i.test(stepText)
                        && !/model dropdown|model selector|model menu|modelmeta|model meta/i.test(stepText);
                    if (isMissionsUiStep && !fileContext[AGENT_PAGE_INNER_PATH]) {
                        const r = await callTool('read_file', { path: AGENT_PAGE_INNER_PATH });
                        if (r.ok && typeof r.result === 'string') {
                            let content = r.result;
                            const INNER_TRUNCATE_LINES = 280;
                            if (isFormTextareaStep && content.split('\n').length > INNER_TRUNCATE_LINES) {
                                const lines = content.split('\n');
                                content = lines.slice(0, INNER_TRUNCATE_LINES).join('\n')
                                    + `\n\n<!-- ... (file truncated; ${lines.length} lines total). Mission prompt textarea (id=prompt) and form are above. -->\n`;
                            }
                            fileContext[AGENT_PAGE_INNER_PATH] = content;
                        }
                    }
                    if (isMissionsUiStep && !fileContext[AGENT_ROUTES_PATH] && /model dropdown|model selector|modelmeta|model meta/i.test(stepText)) {
                        const r = await callTool('read_file', { path: AGENT_ROUTES_PATH });
                        if (r.ok && typeof r.result === 'string') fileContext[AGENT_ROUTES_PATH] = r.result;
                    }
                    const coderResult = await runCoder(step, fileContext, { signal, missionPrompt: prompt, model });
                    return { step, task, coderResult, stepIndex: j, useExisting: false };
                })
            )
        );

        const stepResults = [];
        for (const entry of coderResults) {
            const { step, stepIndex: j, useExisting, existing } = entry;
            const coderResult = entry.coderResult;

            if (useExisting) {
                stepResults.push(existing || { step, status: 'failed', reason: 'No existing result' });
                if (existing?.status === 'done' && existing.edits?.length) {
                    const allowed = existing.edits.filter((e) => e.path && allowedPaths.has(e.path));
                    allEdits.push(...allowed);
                }
                continue;
            }

            if (!coderResult?.ok) {
                stepResults.push({ step, status: 'failed', reason: coderResult?.error || 'No result' });
                log('system', 'coding', `Coder: ${step.what} — failed: ${coderResult?.error || 'No result'}\n`);
                continue;
            }
            const validation = await validateCoderStep(step, prompt, coderResult.edits || [], { allowedPaths, signal, model });
            updateRun(runId, {
                inputTokens: (coderResult.inputTokens || 0) + (validation.inputTokens || 0),
                outputTokens: (coderResult.outputTokens || 0) + (validation.outputTokens || 0),
            });
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

        const runRef = getRun(runId);
        if (runRef) runRef.stepResults = stepResults;

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
            let content = '';
            if (readResult.ok) {
                content = readResult.result;
            } else {
                // File doesn't exist yet — only valid if at least one patch creates it from scratch (search === '')
                const hasNewFileMarker = patches.some((p) => p.search === '');
                if (!hasNewFileMarker) {
                    log('system', 'coding', `[patch] Could not read ${filePath} for patching: ${readResult.error}\n`);
                    continue;
                }
            }
            for (const { search, replace } of patches) {
                if (search === '') {
                    content = replace ?? '';
                } else if (content.includes(search)) {
                    content = content.replace(search, replace ?? '');
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

        if (runRef) runRef.edits = aggregatedEdits;
        updateRun(runId, { stepResults, edits: aggregatedEdits });
        await persistRunToS3(runId);

        if (aggregatedEdits.length === 0) {
            updateRun(runId, { status: 'done' });
            log('system', 'done', 'Run complete (no edits approved).\n');
            await persistRunToS3(runId);
            return;
        }

        // Static import validation: catch broken relative imports before Reviewer sees them.
        const importWarnings = await validateImportPaths(aggregatedEdits);
        if (importWarnings.length > 0) {
            for (const w of importWarnings) {
                log('system', 'reviewing', `⚠️ Import path warning: ${w}\n`);
            }
        }

        const MAX_REVIEW_ROUNDS = 2;
        let reviewRound = 0;
        let editsToReview = [...aggregatedEdits];

        while (reviewRound < MAX_REVIEW_ROUNDS) {
            if (checkCancelled(runId, log)) return;
            updateRun(runId, { status: 'reviewing' });
            log('system', 'reviewing', reviewRound === 0 ? 'Running Reviewer…\n' : `Review round ${reviewRound + 1}…\n`);

            const reviewResult = await runReviewer(editsToReview, prompt, {
                model,
                importWarnings: reviewRound === 0 ? importWarnings : [],
                signal,
            });
            updateRun(runId, { inputTokens: reviewResult.inputTokens || 0, outputTokens: reviewResult.outputTokens || 0 });
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
            const fixResult = await runCoder(syntheticStep, fileContext, { reviewFeedback: reviewResult.feedback, signal, missionPrompt: prompt, model });
            updateRun(runId, { inputTokens: fixResult.inputTokens || 0, outputTokens: fixResult.outputTokens || 0 });
            if (!fixResult.ok || !fixResult.edits?.length) {
                log('system', 'reviewing', `Coder fix pass failed or produced no edits: ${fixResult.error || 'no edits'}\n`);
                break;
            }
            const byPath = new Map(editsToReview.map((e) => [e.path, e.content ?? '']));
            for (const e of fixResult.edits) {
                if (!e.path || !allowedPaths.has(e.path)) continue;
                if (e.search !== undefined) {
                    // Patch edit: apply search/replace to current content
                    const current = byPath.get(e.path) ?? '';
                    if (e.search === '') {
                        byPath.set(e.path, e.replace ?? '');
                    } else if (current.includes(e.search)) {
                        byPath.set(e.path, current.replace(e.search, e.replace ?? ''));
                    }
                } else if (e.content != null) {
                    byPath.set(e.path, e.content);
                }
            }
            editsToReview = Array.from(byPath.entries())
                .filter(([, content]) => content != null)
                .map(([path, content]) => ({ path, content }));
            const runAfterReview = getRun(runId);
            if (runAfterReview) runAfterReview.edits = editsToReview;
            reviewRound++;
        }

        await persistRunToS3(runId);

        if (checkCancelled(runId, log)) return;
        updateRun(runId, { status: 'creating_pr' });
        log('system', 'creating_pr', `Collected ${editsToReview.length} file edit(s). Creating PR…\n`);

        const prResult = await createPrIfConfigured(runId, { prompt, edits: editsToReview, title: getRun(runId)?.title || '' });
        if (prResult.ok && prResult.prUrl) {
            await notifyAuditLog(getRun(runId)?.title, prompt, prResult.prUrl, editsToReview.map((e) => e.path));
            if (checkCancelled(runId, log)) return;
            const branchName = 'agent/' + runId.replace(/[^a-z0-9-]/gi, '-').slice(0, 80);
            updateRun(runId, { status: 'tester' });
            log('system', 'tester', 'Running Tester (review)…\n');
            const currentRunForTester = getRun(runId);
            const testerModel = currentRunForTester?.model || model;
            const diffResult = await getDiffForPullRequest(prResult.prUrl);
            if (!diffResult.ok) {
                const errMsg = 'Diff unavailable: ' + (diffResult.error || 'unknown');
                log('system', 'tester', errMsg + '. Skipping review report.\n');
                updateRun(runId, { status: 'done', prUrl: prResult.prUrl, reviewReportError: errMsg });
                log('system', 'done', 'PR: ' + prResult.prUrl + '\n');
            } else {
                let diffText = diffResult.diffText || '';
                const MAX_DIFF_CHARS = 80 * 1024;
                if (diffText.length > MAX_DIFF_CHARS) {
                    diffText = 'Diff truncated; first ' + MAX_DIFF_CHARS + ' chars shown.\n\n' + diffText.slice(0, MAX_DIFF_CHARS);
                }
                const testerResult = await runTester(branchName, {
                    diffText,
                    baseBranch: diffResult.baseBranch || 'main',
                    headBranch: diffResult.headBranch || branchName,
                    signal,
                    model: testerModel,
                    runId,
                });
                if (!testerResult.ok) {
                    const errMsg = 'Tester failed: ' + (testerResult.error || 'unknown');
                    log('system', 'tester', errMsg + '. PR still created.\n');
                    updateRun(runId, { status: 'done', prUrl: prResult.prUrl, reviewReportError: errMsg });
                    log('system', 'done', 'PR: ' + prResult.prUrl + '\n');
                } else {
                    const recommendation = parseQualityRecommendation(testerResult.report);
                    updateRun(runId, {
                        prUrl: prResult.prUrl,
                        reviewReport: testerResult.report,
                        reviewReportError: undefined,
                        ...(testerResult.diagramKeys?.length && { diagramKeys: testerResult.diagramKeys }),
                        inputTokens: (currentRunForTester?.inputTokens || 0) + (testerResult.inputTokens || 0),
                        outputTokens: (currentRunForTester?.outputTokens || 0) + (testerResult.outputTokens || 0),
                    });

                    if (recommendation === 'reject') {
                        updateRun(runId, { status: 'quality_failed' });
                        log('system', 'quality_failed', 'Quality review rejected. Stopping.\n');
                    } else if (recommendation === 'merge') {
                        updateRun(runId, { status: 'done' });
                        log('system', 'done', 'PR: ' + prResult.prUrl + ' — Review report ready.\n');
                    } else {
                        // request_changes: one quality-fix round (Reviewer + Coder → push → re-run Tester)
                        if (checkCancelled(runId, log)) return;
                        updateRun(runId, { status: 'quality_fix' });
                        log('system', 'quality_fix', 'Quality requested changes. Reviewer assigning fixes to Coder…\n');

                        const reviewResult = await runReviewer(editsToReview, prompt, {
                            qualityReport: testerResult.report,
                            model: testerModel,
                            signal,
                        });
                        updateRun(runId, { inputTokens: (currentRunForTester?.inputTokens || 0) + (reviewResult.inputTokens || 0), outputTokens: (currentRunForTester?.outputTokens || 0) + (reviewResult.outputTokens || 0) });

                        if (!reviewResult.ok || !reviewResult.feedback?.trim()) {
                            updateRun(runId, { status: 'done' });
                            log('system', 'done', 'PR: ' + prResult.prUrl + ' — Review report ready (no fix round).\n');
                        } else {
                            log('system', 'quality_fix', `Reviewer: ${reviewResult.feedback}\n`);
                            const syntheticStep = {
                                what: 'Address quality review feedback',
                                changeDescription: reviewResult.feedback,
                                files: editsToReview.map((e) => e.path).filter(Boolean),
                            };
                            const fileContext = {};
                            for (const e of editsToReview) {
                                if (e.path && e.content != null) fileContext[e.path] = e.content;
                            }
                            const fixResult = await runCoder(syntheticStep, fileContext, { reviewFeedback: reviewResult.feedback, signal, missionPrompt: prompt, model: testerModel });
                            updateRun(runId, { inputTokens: (getRun(runId)?.inputTokens || 0) + (fixResult.inputTokens || 0), outputTokens: (getRun(runId)?.outputTokens || 0) + (fixResult.outputTokens || 0) });

                            if (!fixResult.ok || !fixResult.edits?.length) {
                                updateRun(runId, { status: 'quality_failed' });
                                log('system', 'quality_failed', `Coder fix pass failed or no edits: ${fixResult.error || 'no edits'}. Stopping.\n`);
                            } else {
                                const byPath = new Map(editsToReview.map((e) => [e.path, e.content ?? '']));
                                for (const e of fixResult.edits) {
                                    if (!e.path || !allowedPaths.has(e.path)) continue;
                                    if (e.search !== undefined) {
                                        const current = byPath.get(e.path) ?? '';
                                        if (e.search === '') {
                                            byPath.set(e.path, e.replace ?? '');
                                        } else if (current.includes(e.search)) {
                                            byPath.set(e.path, current.replace(e.search, e.replace ?? ''));
                                        }
                                    } else if (e.content != null) {
                                        byPath.set(e.path, e.content);
                                    }
                                }
                                const updatedEdits = Array.from(byPath.entries())
                                    .filter(([, content]) => content != null)
                                    .map(([path, content]) => ({ path, content }));
                                const runRef = getRun(runId);
                                if (runRef) runRef.edits = updatedEdits;
                                updateRun(runId, { edits: updatedEdits });

                                const pushResult = await pushToExistingBranchIfConfigured(runId, branchName, updatedEdits);
                                if (!pushResult.ok) {
                                    updateRun(runId, { status: 'quality_failed' });
                                    log('system', 'quality_failed', 'Failed to push fix to PR: ' + (pushResult.error || '') + '\n');
                                } else {
                                    log('system', 'quality_fix', 'Pushed fix. Re-running Quality…\n');
                                    const diffResult2 = await getDiffForPullRequest(prResult.prUrl);
                                    if (!diffResult2.ok) {
                                        updateRun(runId, { status: 'done' });
                                        log('system', 'done', 'PR: ' + prResult.prUrl + ' — Fix pushed; diff unavailable for second review.\n');
                                    } else {
                                        let diffText2 = diffResult2.diffText || '';
                                        if (diffText2.length > MAX_DIFF_CHARS) {
                                            diffText2 = 'Diff truncated; first ' + MAX_DIFF_CHARS + ' chars shown.\n\n' + diffText2.slice(0, MAX_DIFF_CHARS);
                                        }
                                        const testerResult2 = await runTester(branchName, {
                                            diffText: diffText2,
                                            baseBranch: diffResult2.baseBranch || 'main',
                                            headBranch: diffResult2.headBranch || branchName,
                                            signal,
                                            model: testerModel,
                                            runId,
                                        });
                                        const runAfterTester2 = getRun(runId);
                                        updateRun(runId, {
                                            reviewReport: testerResult2.ok ? testerResult2.report : (runAfterTester2?.reviewReport || ''),
                                            reviewReportError: testerResult2.ok ? undefined : (testerResult2.error || ''),
                                            ...(testerResult2.ok && testerResult2.diagramKeys?.length && { diagramKeys: testerResult2.diagramKeys }),
                                            inputTokens: (runAfterTester2?.inputTokens || 0) + (testerResult2.inputTokens || 0),
                                            outputTokens: (runAfterTester2?.outputTokens || 0) + (testerResult2.outputTokens || 0),
                                        });

                                        const recommendation2 = testerResult2.ok ? parseQualityRecommendation(testerResult2.report) : 'request_changes';
                                        if (recommendation2 === 'merge') {
                                            updateRun(runId, { status: 'done' });
                                            log('system', 'done', 'PR: ' + prResult.prUrl + ' — Review report ready after fix.\n');
                                        } else {
                                            updateRun(runId, { status: 'quality_failed' });
                                            log('system', 'quality_failed', 'Quality still requested changes or rejected after one fix round. Stopping.\n');
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } else if (prResult.error) {
            updateRun(runId, { status: 'error', error: prResult.error });
            log('system', 'error', 'PR failed: ' + prResult.error + '\n');
        } else {
            updateRun(runId, { status: 'done' });
            log('system', 'done', 'Run complete (PR not configured or dry run).\n');
        }
        await persistRunToS3(runId);
    } catch (err) {
        const isAbort = err?.name === 'AbortError' || isRunCancelled(runId);
        if (isAbort) {
            updateRun(runId, { status: 'cancelled' });
            appendLog(runId, { role: 'system', stage: 'cancelled', message: 'Run stopped by user.\n' });
        } else {
            updateRun(runId, { status: 'error', error: err.message || String(err) });
            appendLog(runId, { role: 'system', stage: 'error', message: (err.message || String(err)) + '\n' });
        }
    } finally {
        unregisterAbortController(runId);
        await persistRunToS3(runId).catch(() => {});
    }
}

/** Normalize channel name for matching (lowercase, spaces/underscores to hyphens). */
function normalizeChannelName(name) {
    if (!name || typeof name !== 'string') return '';
    return name.toLowerCase().replace(/\s+/g, '-').replace(/_/g, '-');
}

/** Post a Mission PR notification to Discord #audit-logs. Uses getClient() and same channel pattern as webhookRoutes. */
async function notifyAuditLog(title, prompt, prUrl, files) {
    try {
        const client = getClient();
        if (!client) {
            console.warn('[agent] Discord client not set — Mission PR notification skipped');
            return;
        }
        if (!client.isReady()) {
            console.warn('[agent] Discord client not ready — Mission PR notification skipped');
            return;
        }
        const guild = client.guilds.cache.first();
        if (!guild) {
            console.warn('[agent] No guild in cache — Mission PR notification skipped');
            return;
        }
        const want = 'audit-logs';
        const channel = guild.channels.cache.find(
            (ch) => ch.isTextBased() && normalizeChannelName(ch.name) === want
        );
        if (!channel) {
            const names = guild.channels.cache.filter((ch) => ch.isTextBased()).map((ch) => ch.name);
            console.warn('[agent] #audit-logs channel not found. Text channels:', names?.slice(0, 20) || []);
            return;
        }
        const fileList = Array.isArray(files) ? files : [];
        const filesValue = fileList.length
            ? fileList.slice(0, 15).join('\n') + (fileList.length > 15 ? `\n... (+${fileList.length - 15} more)` : '')
            : 'None';
        const embed = new EmbedBuilder()
            .setColor(INFO_EMBED_COLOR)
            .setTitle('Mission PR Created: ' + (title || 'Untitled'))
            .setURL(prUrl)
            .setDescription((prompt || '').slice(0, 3000))
            .addFields(
                { name: 'PR URL', value: prUrl },
                { name: 'Changed Files', value: filesValue.slice(0, 1024) }
            )
            .setTimestamp();
        await channel.send({ embeds: [embed] });
        console.log('[agent] Mission PR notification sent to #audit-logs');
    } catch (e) {
        console.error('[agent] Audit log notification failed', e);
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

async function pushToExistingBranchIfConfigured(runId, branchName, edits) {
    try {
        const pushFn = await import('./prCreator.js').then((m) => m.pushEditsToExistingBranch).catch(() => null);
        if (!pushFn) return { ok: true };
        return await pushFn(runId, branchName, edits);
    } catch (e) {
        return { ok: false, error: e.message || String(e) };
    }
}
