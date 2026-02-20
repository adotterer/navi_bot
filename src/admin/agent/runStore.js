/**
 * In-memory run store for Agent PR tool.
 * Tracks status, logs, flight plan, PR URL, and error per run.
 */

const RUN_STATUSES = ['pending', 'research', 'planning', 'coding', 'reviewing', 'creating_pr', 'done', 'error', 'cancelled'];
const MAX_RUNS_RETAINED = 50;

/** @type {Map<string, { runId: string, status: string, logs: Array<{ role: string, stage: string, message: string, timestamp: string }>, flightPlan?: any, prUrl?: string, error?: string, createdAt: number, aborted?: boolean }>} */
const runs = new Map();
/** @type {string[]} */
const runOrder = [];

/** @type {Set<(runId: string, entry: object) => void>} */
const listeners = new Set();

/**
 * Generate a short unique run ID.
 * @returns {string}
 */
function generateRunId() {
    return 'run-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/**
 * Create a new run and return its ID.
 * @param {object} [opts]
 * @param {string} [opts.prompt]
 * @returns {string} runId
 */
function createRun(opts = {}) {
    const runId = generateRunId();
    const run = {
        runId,
        status: 'pending',
        cancelled: false,
        aborted: false,
        logs: [],
        flightPlan: undefined,
        stepResults: [],
        prUrl: undefined,
        error: undefined,
        createdAt: Date.now(),
        prompt: opts.prompt || '',
        usage: { inputTokens: 0, outputTokens: 0, totalCost: 0 },
    };
    runs.set(runId, run);
    runOrder.push(runId);
    while (runOrder.length > MAX_RUNS_RETAINED) {
        const old = runOrder.shift();
        runs.delete(old);
    }
    return runId;
}

/**
 * Append a log entry to a run and notify listeners.
 * @param {string} runId
 * @param {object} entry
 * @param {string} [entry.role]
 * @param {string} [entry.stage]
 * @param {string} [entry.message]
 */
function appendLog(runId, entry) {
    const run = runs.get(runId);
    if (!run) return;
    const full = {
        role: entry.role ?? 'system',
        stage: entry.stage ?? run.status,
        message: entry.message ?? '',
        timestamp: new Date().toISOString(),
    };
    run.logs.push(full);
    listeners.forEach((fn) => {
        try {
            fn(runId, full);
        } catch (e) {
            console.error('runStore listener error:', e);
        }
    });
}

/**
 * Get run by ID.
 * @param {string} runId
 * @returns {object|undefined}
 */
function getRun(runId) {
    return runs.get(runId);
}

/**
 * Update run status and optional fields.
 * @param {string} runId
 * @param {object} updates
 * @param {string} [updates.status]
 * @param {string} [updates.prUrl]
 * @param {string} [updates.error]
 * @param {any} [updates.flightPlan]
 */
function updateRun(runId, updates) {
    const run = runs.get(runId);
    if (!run) return;
    if (updates.status != null && RUN_STATUSES.includes(updates.status)) {
        run.status = updates.status;
    }
    if (updates.cancelled != null) run.cancelled = updates.cancelled;
    if (updates.aborted != null) run.aborted = updates.aborted;
    if (updates.prUrl != null) run.prUrl = updates.prUrl;
    if (updates.error != null) run.error = updates.error;
    if (updates.flightPlan != null) run.flightPlan = updates.flightPlan;
    if (updates.stepResults != null) run.stepResults = updates.stepResults;
}

/**
 * Update token usage for a run (accumulates).
 * @param {string} runId
 * @param {object} usageUpdates
 * @param {number} [usageUpdates.inputTokens]
 * @param {number} [usageUpdates.outputTokens]
 * @param {number} [usageUpdates.totalCost]
 */
function updateUsage(runId, usageUpdates) {
    const run = runs.get(runId);
    if (!run) return;
    if (!run.usage) {
        run.usage = { inputTokens: 0, outputTokens: 0, totalCost: 0 };
    }
    if (usageUpdates.inputTokens != null) run.usage.inputTokens += usageUpdates.inputTokens;
    if (usageUpdates.outputTokens != null) run.usage.outputTokens += usageUpdates.outputTokens;
    if (usageUpdates.totalCost != null) run.usage.totalCost += usageUpdates.totalCost;
}

function setRunCancelled(runId) {
    const run = runs.get(runId);
    if (!run) return;
    run.cancelled = true;
}

function isRunCancelled(runId) {
    const run = runs.get(runId);
    return run ? !!run.cancelled : false;
}

function abortRun(runId) {
    const run = runs.get(runId);
    if (!run) return;
    run.aborted = true;
}

function isRunAborted(runId) {
    const run = runs.get(runId);
    return run ? !!run.aborted : false;
}

/**
 * Subscribe to new log entries (for SSE). Call the returned function to unsubscribe.
 * @param {(runId: string, entry: object) => void} fn
 * @returns {() => void}
 */
function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/**
 * List recent runs (newest first), for admin run list.
 * @param {number} [limit]
 * @returns {Array<{ runId: string, status: string, createdAt: number, prompt?: string }>}
 */
function listRuns(limit = 20) {
    const ids = [...runOrder].reverse().slice(0, limit);
    return ids.map((id) => {
        const run = runs.get(id);
        if (!run) return null;
        return {
            runId: run.runId,
            status: run.status,
            createdAt: run.createdAt,
            prompt: run.prompt ? run.prompt.slice(0, 100) : undefined,
        };
    }).filter(Boolean);
}

export { createRun, appendLog, getRun, updateRun, subscribe, listRuns, setRunCancelled, isRunCancelled, abortRun, isRunAborted, RUN_STATUSES };
