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
        prompt: run.prompt,
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
