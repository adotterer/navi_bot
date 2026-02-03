import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'us-west-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

export async function uploadToS3(filename, fileContent) {
    const command = new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: filename,
        Body: fileContent,
        ContentType: 'application/json'
    });
    
    await s3Client.send(command);
    const url = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${filename}`;
    return url;
}

export async function fetchFromS3(filename) {
    const command = new GetObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: filename
    });
    
    const response = await s3Client.send(command);
    const str = await response.Body.transformToString();
    return JSON.parse(str);
}

export function isModelOverloaded(error) {
    const status = error?.status || error?.statusCode || error?.response?.status;
    const message = `${error?.message || ''}`.toLowerCase();
    return status === 500 || message.includes('overloaded');
}

export async function fetchAllMessages(channel) {
    const messages = [];
    let lastMessageId;
    
    while (true) {
        const options = { limit: 100 };
        if (lastMessageId) options.before = lastMessageId;
        
        const fetched = await channel.messages.fetch(options);
        if (fetched.size === 0) break;
        
        fetched.forEach(msg => {
            const msgData = {
                author: msg.author.username,
                authorId: msg.author.id,
                content: msg.content,
                timestamp: msg.createdAt.toISOString(),
                messageId: msg.id
            };
            
            // Add reply context if this message is replying to another
            if (msg.reference) {
                msgData.replyingTo = {
                    messageId: msg.reference.messageId,
                    guildId: msg.reference.guildId,
                    channelId: msg.reference.channelId
                };
                
                // Try to fetch the original message for its content
                if (msg.mentions.repliedUser) {
                    msgData.replyingToAuthor = msg.mentions.repliedUser.username;
                }
            }
            
            messages.push(msgData);
        });
        
        lastMessageId = fetched.last().id;
    }
    
    return messages.reverse();
}
