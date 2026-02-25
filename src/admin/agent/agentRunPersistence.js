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
        auditReportImageKey: run.auditReportImageKey,
        askResponse: run.askResponse,
        askResponseImageKey: run.askResponseImageKey,
        reviewReport: run.reviewReport,
        reviewReportError: run.reviewReportError,
        diagramKeys: run.diagramKeys || [],
        prompt: run.prompt,
        model: run.model || '',
        title: run.title || '',
        inputTokens: run.inputTokens || 0,
        outputTokens: run.outputTokens || 0,
        cached_tokens: run.cached_tokens || 0,
        flightPlan: run.flightPlan,
        steps: run.steps,
        docs: run.docs,
        stepResults: run.stepResults,
        fileManifest: run.fileManifest || [],
        fileRegistry: run.fileRegistry || {},
        truncationWarnings: run.truncationWarnings || [],
        conflictWarnings: run.conflictWarnings || [],
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
 * @param {string} [bucket] - Optional bucket (e.g. AGENT_RUNS_READ_BUCKET); uses default when omitted.
 * @returns {Promise<object|null>}
 */
export async function loadRunFromS3(runId, bucket) {
    try {
        const key = S3_PREFIX + runId + '.json';
        const raw = bucket ? await fetchFromS3Raw(key, bucket) : await fetchFromS3Raw(key);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (err) {
        console.warn('[agentRunPersistence] load failed for', runId, err.message || err);
        return null;
    }
}

/**
 * Load lightweight metadata for run listing (including model and token counts for cost).
 * @param {string} runId
 * @param {string} [bucket] - Optional bucket; uses default when omitted.
 * @returns {Promise<{ runId: string, title?: string, prompt?: string, status?: string, createdAt?: number, runMode?: string, model?: string, inputTokens?: number, outputTokens?: number }|null>}
 */
export async function loadRunMetadataFromS3(runId, bucket) {
    try {
        const key = S3_PREFIX + runId + '.json';
        const raw = bucket ? await fetchFromS3Raw(key, bucket) : await fetchFromS3Raw(key);
        if (!raw) return null;
        const full = JSON.parse(raw);
        return {
            runId: full.runId || runId,
            title: full.title || '',
            prompt: full.prompt || '',
            status: full.status || '',
            createdAt: full.createdAt || 0,
            runMode: full.runMode || 'pr',
            model: full.model || '',
            inputTokens: full.inputTokens || 0,
            outputTokens: full.outputTokens || 0,
            cachedTokens: full.cached_tokens || 0,
        };
    } catch {
        return { runId };
    }
}
