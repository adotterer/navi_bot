/**
 * Orchestrator: runs Researcher -> Planners -> Coders, aggregates edits, then PR (when implemented).
 */
import pLimit from 'p-limit';
import { appendLog, getRun, updateRun } from './runStore.js';
import { runResearcher, runPlanner, runCoder } from './agents.js';
import { readFile } from './codebaseTools.js';

/**
 * Run the full pipeline for a given runId.
 * @param {string} runId
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {number} [opts.maxParallelPlanners]
 * @param {number} [opts.maxParallelCoders]
 */
export async function runPipeline(runId, opts = {}) {
    const { prompt = '', maxParallelPlanners = 2, maxParallelCoders = 3 } = opts;
    const log = (role, stage, message) => appendLog(runId, { role, stage, message });

    try {
        updateRun(runId, { status: 'research' });
        log('system', 'research', 'Running Researcher…\n');

        const researchResult = await runResearcher(prompt, {
            onChunk: (chunk) => log('researcher', 'research', chunk),
        });
        if (!researchResult.ok) {
            updateRun(runId, { status: 'error', error: researchResult.error });
            log('system', 'error', 'Researcher failed: ' + researchResult.error + '\n');
            return;
        }

        const flightPlan = researchResult.flightPlan;
        updateRun(runId, { flightPlan });
        log('system', 'research', `Flight plan: ${flightPlan.length} task(s).\n`);

        const allEdits = []; // { path, content }[]
        const limitPlanners = pLimit(Math.max(1, Math.min(5, maxParallelPlanners)));
        const limitCoders = pLimit(Math.max(1, Math.min(10, maxParallelCoders)));

        updateRun(runId, { status: 'planning' });
        const planResults = await Promise.all(
            flightPlan.map((task, i) =>
                limitPlanners(async () => {
                    log('system', 'planning', `Planner: ${task.title}\n`);
                    const planResult = await runPlanner(task, {
                        onChunk: (chunk) => log('planner', 'planning', chunk),
                    });
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

        updateRun(runId, { status: 'coding' });
        const coderResults = await Promise.all(
            allSteps.map((step, j) =>
                limitCoders(async () => {
                    log('system', 'coding', `Coder: ${step.what}\n`);
                    const fileContext = {};
                    for (const p of step.files || []) {
                        const r = readFile(p);
                        if (r.ok) fileContext[p] = r.content;
                    }
                    const coderResult = await runCoder(step, fileContext, {
                        onChunk: (chunk) => log('coder', 'coding', chunk),
                    });
                    return { step, coderResult, stepIndex: j };
                })
            )
        );

        for (const { coderResult } of coderResults) {
            if (!coderResult.ok) {
                updateRun(runId, { status: 'error', error: coderResult.error });
                log('system', 'error', 'Coder failed: ' + coderResult.error + '\n');
                return;
            }
            allEdits.push(...coderResult.edits);
        }

        // Aggregate by path (last write wins)
        const byPath = new Map();
        for (const e of allEdits) {
            if (e.path) byPath.set(e.path, e.content);
        }
        const aggregatedEdits = Array.from(byPath.entries()).map(([path, content]) => ({ path, content }));

        const run = getRun(runId);
        if (run) run.edits = aggregatedEdits;

        updateRun(runId, { status: 'creating_pr' });
        log('system', 'creating_pr', `Collected ${aggregatedEdits.length} file edit(s). Creating PR…\n`);

        // PR creation will be wired in step 6; for now just mark done or call a stub
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
