/**
 * In-memory run store for Agent PR tool.
 * Tracks status, logs, flight plan, PR URL, and error per run.
 */

const RUN_STATUSES = ['pending', 'research', 'planning', 'coding', 'reviewing', 'creating_pr', 'done', 'error', 'cancelled'];
const MAX_RUNS_RETAINED = 50;

const DEFAULT_DOCS = { overview: '', requirements: '', architecture: '', decisions: '', notes: '' };

/** @type {Map<string, { runId: string, status: string, logs: Array<{ role: string, stage: string, message: string, timestamp: string }>, flightPlan?: any, steps?: Array<{ step: object, task: object }>, docs?: object, stepResults?: any[], edits?: any[], prUrl?: string, error?: string, createdAt: number, prompt?: string }>} */
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
        logs: [],
        flightPlan: undefined,
        steps: undefined,
        docs: { ...DEFAULT_DOCS },
        stepResults: [],
        edits: undefined,
        prUrl: undefined,
        error: undefined,
        createdAt: Date.now(),
        prompt: opts.prompt || '',
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
    if (updates.prUrl != null) run.prUrl = updates.prUrl;
    if (updates.error != null) run.error = updates.error;
    if (updates.flightPlan != null) run.flightPlan = updates.flightPlan;
    if (updates.steps != null) run.steps = updates.steps;
    if (updates.stepResults != null) run.stepResults = updates.stepResults;
    if (updates.edits != null) run.edits = updates.edits;
    if (updates.docs != null) {
        run.docs = run.docs || { ...DEFAULT_DOCS };
        const d = updates.docs;
        if (typeof d === 'object') {
            if (d.overview != null) run.docs.overview = String(d.overview);
            if (d.requirements != null) run.docs.requirements = String(d.requirements);
            if (d.architecture != null) run.docs.architecture = String(d.architecture);
            if (d.decisions != null) run.docs.decisions = String(d.decisions);
            if (d.notes != null) run.docs.notes = String(d.notes);
        }
    }
    if (updates.prompt != null) run.prompt = updates.prompt;
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

/**
 * Re-hydrate a run from a persisted snapshot (e.g. loaded from S3).
 * @param {string} runId
 * @param {object} snapshot - Plain object with runId, status, prompt, docs, flightPlan, steps, stepResults, logs, edits, prUrl, error, createdAt, cancelled
 */
function hydrateRun(runId, snapshot) {
    if (!snapshot || snapshot.runId !== runId) return;
    const run = {
        runId: snapshot.runId,
        status: snapshot.status || 'pending',
        cancelled: !!snapshot.cancelled,
        logs: Array.isArray(snapshot.logs) ? snapshot.logs : [],
        flightPlan: snapshot.flightPlan,
        steps: snapshot.steps,
        docs: snapshot.docs && typeof snapshot.docs === 'object'
            ? { ...DEFAULT_DOCS, ...snapshot.docs }
            : { ...DEFAULT_DOCS },
        stepResults: Array.isArray(snapshot.stepResults) ? snapshot.stepResults : [],
        edits: snapshot.edits,
        prUrl: snapshot.prUrl,
        error: snapshot.error,
        createdAt: snapshot.createdAt ?? Date.now(),
        prompt: snapshot.prompt ?? '',
    };
    runs.set(runId, run);
    if (!runOrder.includes(runId)) runOrder.push(runId);
}

export { createRun, appendLog, getRun, updateRun, hydrateRun, subscribe, listRuns, setRunCancelled, isRunCancelled, RUN_STATUSES, DEFAULT_DOCS };
