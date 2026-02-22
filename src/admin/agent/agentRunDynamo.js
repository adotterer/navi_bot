/**
 * DynamoDB operations for agent run metadata (lightweight listing index).
 * Full run snapshots (logs, edits, reports) stay in S3.
 * All functions are no-ops if DynamoDB is not configured.
 */
import { PutCommand, QueryCommand, DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { getDynamoClient, DYNAMO_TABLE } from '../../shared/dynamoHelper.js';

/**
 * Upsert run metadata to DynamoDB. Called on create and at each status change.
 * @param {object} run - Run object from runStore (only metadata fields are extracted).
 */
export async function upsertRunMeta(run) {
    const client = getDynamoClient();
    if (!client || !run?.runId) return;
    const createdIso = run.createdAt ? new Date(run.createdAt).toISOString() : new Date().toISOString();
    try {
        await client.send(new PutCommand({
            TableName: DYNAMO_TABLE,
            Item: {
                pk: `AGENT_RUN#${run.runId}`,
                sk: 'META',
                GSI1PK: 'AGENT_RUNS',
                GSI1SK: `${createdIso}#${run.runId}`,
                runId: run.runId,
                status: run.status || 'pending',
                runMode: run.runMode || 'pr',
                depth: run.depth || 'medium',
                createdAt: createdIso,
                updatedAt: new Date().toISOString(),
                prompt: run.prompt ? run.prompt.slice(0, 100) : '',
                title: run.title || '',
                model: run.model || '',
                inputTokens: run.inputTokens || 0,
                outputTokens: run.outputTokens || 0,
                prUrl: run.prUrl || '',
                error: run.error ? String(run.error).slice(0, 200) : '',
            },
        }));
    } catch (err) {
        console.warn('[agentRunDynamo] upsertRunMeta failed:', err.message || err);
    }
}

/**
 * List run metadata from DynamoDB, newest first.
 * @param {number} [limit=30]
 * @returns {Promise<Array<object>|null>} null if DynamoDB not configured
 */
export async function listRunsMeta(limit = 30) {
    const client = getDynamoClient();
    if (!client) return null;
    try {
        const result = await client.send(new QueryCommand({
            TableName: DYNAMO_TABLE,
            IndexName: 'GSI1',
            KeyConditionExpression: 'GSI1PK = :pk',
            ExpressionAttributeValues: { ':pk': 'AGENT_RUNS' },
            ScanIndexForward: false,
            Limit: limit,
        }));
        return (result.Items || []).map((item) => ({
            runId: item.runId,
            status: item.status || '',
            runMode: item.runMode || 'pr',
            createdAt: item.createdAt ? new Date(item.createdAt).getTime() : 0,
            prompt: item.prompt || '',
            title: item.title || '',
            model: item.model || '',
            inputTokens: item.inputTokens || 0,
            outputTokens: item.outputTokens || 0,
            prUrl: item.prUrl || '',
            error: item.error || '',
        }));
    } catch (err) {
        console.warn('[agentRunDynamo] listRunsMeta failed:', err.message || err);
        return null;
    }
}

/**
 * Delete run metadata from DynamoDB.
 * @param {string} runId
 */
export async function deleteRunMeta(runId) {
    const client = getDynamoClient();
    if (!client || !runId) return;
    try {
        await client.send(new DeleteCommand({
            TableName: DYNAMO_TABLE,
            Key: { pk: `AGENT_RUN#${runId}`, sk: 'META' },
        }));
    } catch (err) {
        console.warn('[agentRunDynamo] deleteRunMeta failed:', err.message || err);
    }
}

/**
 * Get run metadata by runId.
 * @param {string} runId
 * @returns {Promise<object|null>}
 */
export async function getRunMeta(runId) {
    const client = getDynamoClient();
    if (!client || !runId) return null;
    try {
        const result = await client.send(new GetCommand({
            TableName: DYNAMO_TABLE,
            Key: { pk: `AGENT_RUN#${runId}`, sk: 'META' },
        }));
        if (!result.Item) return null;
        const item = result.Item;
        return {
            runId: item.runId,
            status: item.status || '',
            runMode: item.runMode || 'pr',
            createdAt: item.createdAt ? new Date(item.createdAt).getTime() : 0,
            prompt: item.prompt || '',
            title: item.title || '',
            model: item.model || '',
            inputTokens: item.inputTokens || 0,
            outputTokens: item.outputTokens || 0,
            prUrl: item.prUrl || '',
            error: item.error || '',
        };
    } catch (err) {
        console.warn('[agentRunDynamo] getRunMeta failed:', err.message || err);
        return null;
    }
}
