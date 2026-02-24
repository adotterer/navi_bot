/**
 * Persist ban sessions in DynamoDB (pk = matchId).
 * Uses AUTH_DYNAMODB_* credentials; optional table DYNAMODB_BAN_SESSIONS_TABLE.
 */
import { PutCommand, GetCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { getDynamoClient } from '../shared/dynamoHelper.js';

const TABLE_NAME = process.env.DYNAMODB_BAN_SESSIONS_TABLE || 'navi-ban-sessions';
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * @param {string} matchId
 * @param {string} player1Id
 * @param {string} player2Id
 * @returns {Promise<object>} Created session object
 */
export async function createSession(matchId, player1Id, player2Id) {
  const session = {
    pk: matchId,
    matchId,
    player1Id,
    player2Id,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
    gameNumber: 1,
    coinFlipWinnerId: null,
    bannedStages: [],
    currentTurn: null,
    turnPhase: 'game1_ban_1',
    selectedStage: null,
  };

  const client = getDynamoClient();
  if (!client) {
    const err = new Error('DynamoDB not configured. Set AUTH_DYNAMODB_ID, AUTH_DYNAMODB_SECRET, and create the ban sessions table.');
    console.warn('[banSessionStore]', err.message);
    throw err;
  }

  try {
    await client.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: session,
    }));
    return session;
  } catch (err) {
    console.warn('[banSessionStore] createSession failed:', err?.message || err);
    throw err;
  }
}

/**
 * @param {string} matchId
 * @returns {Promise<object|null>}
 */
export async function getSession(matchId) {
  const client = getDynamoClient();
  if (!client) return null;

  try {
    const result = await client.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: matchId },
    }));
    const item = result.Item;
    if (!item || !item.matchId) return null;
    if (item.expiresAt && item.expiresAt < Date.now()) {
      await deleteSession(matchId);
      return null;
    }
    return item;
  } catch (err) {
    console.warn('[banSessionStore] getSession failed:', err?.message || err);
    return null;
  }
}

/**
 * @param {string} matchId
 * @param {object} updates - Fields to merge into the session
 * @returns {Promise<object|null>} Updated session
 */
export async function updateSession(matchId, updates) {
  const client = getDynamoClient();
  if (!client) return null;

  const existing = await getSession(matchId);
  if (!existing) return null;

  const merged = { ...existing, ...updates };
  merged.pk = matchId;
  merged.matchId = matchId;

  try {
    await client.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: merged,
    }));
    return merged;
  } catch (err) {
    console.warn('[banSessionStore] updateSession failed:', err?.message || err);
    throw err;
  }
}

/**
 * @param {string} matchId
 */
export async function deleteSession(matchId) {
  const client = getDynamoClient();
  if (!client) return;

  try {
    await client.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { pk: matchId },
    }));
  } catch (err) {
    console.warn('[banSessionStore] deleteSession failed:', err?.message || err);
  }
}

/**
 * Remove expired sessions. Call on startup and optionally on an interval.
 */
export async function cleanupExpiredSessions() {
  const client = getDynamoClient();
  if (!client) return;

  const now = Date.now();
  try {
    const result = await client.send(new ScanCommand({
      TableName: TABLE_NAME,
      ProjectionExpression: 'pk, expiresAt',
    }));

    const items = result.Items || [];
    for (const item of items) {
      if (item.expiresAt && item.expiresAt < now && item.pk) {
        await deleteSession(item.pk);
      }
    }
  } catch (err) {
    console.warn('[banSessionStore] cleanupExpiredSessions failed:', err?.message || err);
  }
}
