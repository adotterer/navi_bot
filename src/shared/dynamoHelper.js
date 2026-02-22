/**
 * Shared DynamoDB client singleton.
 * Uses AUTH_DYNAMODB_ID, AUTH_DYNAMODB_SECRET, AUTH_DYNAMODB_REGION env vars.
 * Returns null if credentials are not configured (DynamoDB is optional).
 */
import { DynamoDB } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb';

export const DYNAMO_TABLE = 'next-auth';

let _client = null;
let _checked = false;

export function getDynamoClient() {
    if (_checked) return _client;
    _checked = true;
    const accessKeyId = process.env.AUTH_DYNAMODB_ID;
    const secretAccessKey = process.env.AUTH_DYNAMODB_SECRET;
    const region = process.env.AUTH_DYNAMODB_REGION;
    if (!accessKeyId || !secretAccessKey) return null;
    _client = DynamoDBDocument.from(new DynamoDB({
        credentials: { accessKeyId, secretAccessKey },
        region: region || 'us-east-1',
    }), {
        marshallOptions: {
            convertEmptyValues: true,
            removeUndefinedValues: true,
            convertClassInstanceToMap: true,
        },
    });
    return _client;
}
