/**
 * Persist agent run state to S3 and load it back.
 * Key: admin/agent-runs/{runId}.json
 */
import { putToS3, fetchFromS3Raw } from '../../shared/s3Helper.js';
import { getRun } from './runStore.js';

const S3_PREFIX = 'admin/agent-runs/';

function runToSnapshot(run) {
    if (!run) return null;
    return {
        runId: run.runId,
        status: run.status,
        cancelled: !!run.cancelled,
        runMode: run.runMode || 'pr',
        auditReport: run.auditReport,
        askResponse: run.askResponse,
        reviewReport: run.reviewReport,
        prompt: run.prompt,
        model: run.model || '',
        title: run.title || '',
        inputTokens: run.inputTokens || 0,
        outputTokens: run.outputTokens || 0,
        flightPlan: run.flightPlan,
        steps: run.steps,
        docs: run.docs,
        stepResults: run.stepResults,
        logs: run.logs,
        edits: run.edits,
        prUrl: run.prUrl,
        error: run.error,
        createdAt: run.createdAt,
    };
}

/**
 * Persist the current run state to S3. Returns false if no run or S3 fails.
 * @param {string} runId
 * @returns {Promise<boolean>}
 */
export async function persistRunToS3(runId) {
    const run = getRun(runId);
    if (!run) return false;
    try {
        const snapshot = runToSnapshot(run);
        const key = S3_PREFIX + runId + '.json';
        await putToS3(key, JSON.stringify(snapshot, null, 0), 'application/json');
        return true;
    } catch (err) {
        console.warn('[agentRunPersistence] persist failed for', runId, err.message || err);
        return false;
    }
}

/**
 * Load run snapshot from S3. Returns plain object or null.
 * @param {string} runId
 * @returns {Promise<object|null>}
 */
export async function loadRunFromS3(runId) {
    try {
        const key = S3_PREFIX + runId + '.json';
        const raw = await fetchFromS3Raw(key);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (err) {
        console.warn('[agentRunPersistence] load failed for', runId, err.message || err);
        return null;
    }
}

/**
 * Load just lightweight metadata fields (title, prompt, status, createdAt) for run listing.
 * @param {string} runId
 * @returns {Promise<{ runId: string, title?: string, prompt?: string, status?: string, createdAt?: number }|null>}
 */
export async function loadRunMetadataFromS3(runId) {
    try {
        const key = S3_PREFIX + runId + '.json';
        const raw = await fetchFromS3Raw(key);
        if (!raw) return null;
        const full = JSON.parse(raw);
        return {
            runId: full.runId || runId,
            title: full.title || '',
            prompt: full.prompt || '',
            status: full.status || '',
            createdAt: full.createdAt || 0,
            runMode: full.runMode || 'pr',
        };
    } catch {
        return { runId };
    }
}
