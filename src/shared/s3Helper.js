import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';

// Env names: prefer .env.example (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, S3_BUCKET_NAME)
const AWS_REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-west-1';
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME || process.env.BUCKET_NAME;
const ACCESS_KEY = process.env.AWS_ACCESS_KEY_ID || process.env.ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY;
const SECRET_KEY = process.env.AWS_SECRET_ACCESS_KEY || process.env.SECRET_ACCESS_KEY || process.env.AWS_SECRET_KEY;

const s3Client = new S3Client({
    region: AWS_REGION,
    credentials: {
        accessKeyId: ACCESS_KEY,
        secretAccessKey: SECRET_KEY
    }
});

export async function uploadToS3(filename, fileContent) {
    const command = new PutObjectCommand({
        Bucket: S3_BUCKET_NAME,
        Key: filename,
        Body: fileContent,
        ContentType: 'application/json'
    });
    
    await s3Client.send(command);
    const url = `https://${S3_BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/${filename}`;
    return url;
}

export async function fetchFromS3(filename) {
    const command = new GetObjectCommand({
        Bucket: S3_BUCKET_NAME,
        Key: filename
    });
    
    const response = await s3Client.send(command);
    const str = await response.Body.transformToString();
    return JSON.parse(str);
}

/** Fetch raw string from S3 (for prompts, CSV). Returns null if key not found. */
export async function fetchFromS3Raw(key) {
    try {
        const command = new GetObjectCommand({
            Bucket: S3_BUCKET_NAME,
            Key: key
        });
        const response = await s3Client.send(command);
        return await response.Body.transformToString();
    } catch (error) {
        if (error.name === 'NoSuchKey' || error.Code === 'NoSuchKey') return null;
        throw error;
    }
}

/** Returns true if the key exists in S3, false if not found or on error (e.g. no creds). */
export async function headS3Key(key) {
    try {
        await s3Client.send(new HeadObjectCommand({ Bucket: S3_BUCKET_NAME, Key: key }));
        return true;
    } catch (err) {
        if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return false;
        if (err.name === 'NoSuchKey' || err.Code === 'NoSuchKey') return false;
        throw err;
    }
}

/** Returns true if at least one key with the given prefix exists (MaxKeys 1). */
export async function hasS3KeysWithPrefix(prefix) {
    try {
        const res = await s3Client.send(new ListObjectsV2Command({
            Bucket: S3_BUCKET_NAME,
            Prefix: prefix,
            MaxKeys: 1
        }));
        return (res.KeyCount ?? 0) > 0;
    } catch (_) {
        return false;
    }
}

/** List keys with the given prefix. Returns array of { Key, LastModified, Size }. */
export async function listS3KeysWithPrefix(prefix, maxKeys = 100) {
    try {
        const res = await s3Client.send(new ListObjectsV2Command({
            Bucket: S3_BUCKET_NAME,
            Prefix: prefix,
            MaxKeys: maxKeys
        }));
        const contents = res.Contents ?? [];
        return contents.map((c) => ({
            Key: c.Key,
            LastModified: c.LastModified,
            Size: c.Size
        }));
    } catch (_) {
        return [];
    }
}

/** Delete one object by key. */
export async function deleteFromS3(key) {
    await s3Client.send(new DeleteObjectCommand({
        Bucket: S3_BUCKET_NAME,
        Key: key
    }));
}

/** Upload raw string to S3 (for admin prompts, CSV). Key is full path e.g. admin/prompts/mu_notes.txt */
export async function putToS3(key, body, contentType = 'text/plain') {
    const command = new PutObjectCommand({
        Bucket: S3_BUCKET_NAME,
        Key: key,
        Body: body,
        ContentType: contentType
    });
    await s3Client.send(command);
}

export function isModelOverloaded(error) {
    const status = error?.status || error?.statusCode || error?.response?.status;
    const message = `${error?.message || ''}`.toLowerCase();
    return status === 500 || message.includes('overloaded');
}

export async function fetchAllMessages(channel) {
    const messages = [];
    const replyCache = new Map();
    let lastMessageId;
    
    while (true) {
        const options = { limit: 100 };
        if (lastMessageId) options.before = lastMessageId;
        
        const fetched = await channel.messages.fetch(options);
        if (fetched.size === 0) break;
        
        for (const msg of fetched.values()) {
            const msgData = {
                author: msg.author.username,
                authorId: msg.author.id,
                content: msg.content,
                timestamp: msg.createdAt.toISOString()
            };
            
            // Add reply context if this message is replying to another
            if (msg.reference?.messageId) {
                try {
                    let repliedMessage = replyCache.get(msg.reference.messageId);
                    if (!repliedMessage) {
                        repliedMessage = await channel.messages.fetch(msg.reference.messageId);
                        replyCache.set(msg.reference.messageId, repliedMessage);
                    }
                    if (repliedMessage) {
                        msgData.replyingToAuthor = repliedMessage.author?.username || null;
                        msgData.replyingToAuthorId = repliedMessage.author?.id || null;
                        msgData.replyingToContent = repliedMessage.content || null;
                        msgData.replyingToTimestamp = repliedMessage.createdAt?.toISOString() || null;
                    }
                } catch (error) {
                    if (msg.mentions.repliedUser) {
                        msgData.replyingToAuthor = msg.mentions.repliedUser.username;
                        msgData.replyingToAuthorId = msg.mentions.repliedUser.id;
                    }
                }
            }
            
            messages.push(msgData);
        }
        
        lastMessageId = fetched.last().id;
    }
    
    return messages.reverse();
}
