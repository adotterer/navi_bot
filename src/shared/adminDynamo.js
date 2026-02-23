/**
 * DynamoDB operations for admin accounts and invite tokens.
 * Uses same table as agent runs (next-auth) with pk/sk prefixes ADMIN# and ADMIN_INVITE#.
 * All functions no-op or return null/false if DynamoDB is not configured.
 */
import crypto from 'crypto';
import { PutCommand, GetCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getDynamoClient, DYNAMO_TABLE } from './dynamoHelper.js';

const SALT_LEN = 16;
const KEY_LEN = 64;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 };

function hashPassword(password) {
    const salt = crypto.randomBytes(SALT_LEN);
    const hash = crypto.scryptSync(password, salt, KEY_LEN, SCRYPT_OPTS);
    return { salt: salt.toString('base64'), hash: hash.toString('base64') };
}

function verifyPassword(password, saltB64, hashB64) {
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(password, salt, KEY_LEN, SCRYPT_OPTS);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/**
 * @param {string} password - Plain password.
 * @returns {{ salt: string, hash: string }} For storage.
 */
export function hashPasswordForStorage(password) {
    return hashPassword(password);
}

/**
 * @param {string} password - Plain password.
 * @param {string} saltB64 - Salt from DB.
 * @param {string} hashB64 - Hash from DB.
 */
export function verifyPasswordFromStorage(password, saltB64, hashB64) {
    if (!saltB64 || !hashB64) return false;
    try {
        return verifyPassword(password, saltB64, hashB64);
    } catch (_) {
        return false;
    }
}

const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Create a pending invite; store in DynamoDB.
 * @param {string} email - Invitee email.
 * @returns {{ token: string, expiresAt: string } | null}
 */
export async function createInvite(email) {
    const client = getDynamoClient();
    if (!client || !email || !String(email).trim()) return null;
    const normalized = String(email).trim().toLowerCase();
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITE_EXPIRY_MS).toISOString();
    try {
        await client.send(new PutCommand({
            TableName: DYNAMO_TABLE,
            Item: {
                pk: `ADMIN_INVITE#${token}`,
                sk: 'INVITE',
                email: normalized,
                expiresAt,
                createdAt: new Date().toISOString(),
            },
        }));
        return { token, expiresAt };
    } catch (err) {
        console.warn('[adminDynamo] createInvite failed:', err?.message || err);
        return null;
    }
}

/**
 * Get invite by token. Returns null if not found or expired.
 * @param {string} token
 * @returns {Promise<{ email: string, expiresAt: string } | null>}
 */
export async function getInviteByToken(token) {
    const client = getDynamoClient();
    if (!client || !token) return null;
    try {
        const result = await client.send(new GetCommand({
            TableName: DYNAMO_TABLE,
            Key: { pk: `ADMIN_INVITE#${token}`, sk: 'INVITE' },
        }));
        const item = result.Item;
        if (!item || !item.email) return null;
        if (new Date(item.expiresAt) < new Date()) return null;
        return { email: item.email, expiresAt: item.expiresAt };
    } catch (err) {
        console.warn('[adminDynamo] getInviteByToken failed:', err?.message || err);
        return null;
    }
}

/**
 * Delete invite after successful setup.
 * @param {string} token
 */
export async function deleteInvite(token) {
    const client = getDynamoClient();
    if (!client || !token) return;
    try {
        await client.send(new DeleteCommand({
            TableName: DYNAMO_TABLE,
            Key: { pk: `ADMIN_INVITE#${token}`, sk: 'INVITE' },
        }));
    } catch (err) {
        console.warn('[adminDynamo] deleteInvite failed:', err?.message || err);
    }
}

/**
 * Create or update admin profile (after set-password).
 * @param {string} email
 * @param {string} saltB64
 * @param {string} hashB64
 */
export async function putAdmin(email, saltB64, hashB64) {
    const client = getDynamoClient();
    if (!client || !email) return;
    const normalized = String(email).trim().toLowerCase();
    const now = new Date().toISOString();
    try {
        await client.send(new PutCommand({
            TableName: DYNAMO_TABLE,
            Item: {
                pk: `ADMIN#${normalized}`,
                sk: 'PROFILE',
                GSI1PK: 'ADMINS',
                GSI1SK: normalized,
                email: normalized,
                salt: saltB64,
                hash: hashB64,
                createdAt: now,
                updatedAt: now,
            },
        }));
    } catch (err) {
        console.warn('[adminDynamo] putAdmin failed:', err?.message || err);
    }
}

/**
 * Get admin by email (lowercase).
 * @param {string} email
 * @returns {Promise<{ email: string, salt: string, hash: string } | null>}
 */
export async function getAdminByEmail(email) {
    const client = getDynamoClient();
    if (!client || !email) return null;
    const normalized = String(email).trim().toLowerCase();
    try {
        const result = await client.send(new GetCommand({
            TableName: DYNAMO_TABLE,
            Key: { pk: `ADMIN#${normalized}`, sk: 'PROFILE' },
        }));
        const item = result.Item;
        if (!item || !item.email) return null;
        return {
            email: item.email,
            salt: item.salt,
            hash: item.hash,
        };
    } catch (err) {
        console.warn('[adminDynamo] getAdminByEmail failed:', err?.message || err);
        return null;
    }
}

/**
 * List all admin emails (for super-admin UI). Returns [] if DynamoDB not configured.
 * @returns {Promise<string[]>}
 */
export async function listAdminEmails() {
    const client = getDynamoClient();
    if (!client) return [];
    try {
        const result = await client.send(new QueryCommand({
            TableName: DYNAMO_TABLE,
            IndexName: 'GSI1',
            KeyConditionExpression: 'GSI1PK = :pk',
            ExpressionAttributeValues: { ':pk': 'ADMINS' },
            ProjectionExpression: 'email',
        }));
        return (result.Items || []).map((i) => i.email).filter(Boolean);
    } catch (err) {
        console.warn('[adminDynamo] listAdminEmails failed:', err?.message || err);
        return [];
    }
}
