/**
 * Discord-aware message splitter that respects emoji boundaries, code blocks, and markdown formatting.
 * Splits messages intelligently at safe boundaries to avoid breaking Discord syntax.
 */

export const MAX_DISCORD_LENGTH = 1900; // Safe buffer below Discord's 2000 char limit
export const MAX_EMBED_DESCRIPTION_LENGTH = 4096; // Discord's embed description limit

/**
 * Splits a message into chunks that respect Discord's character limit while preserving:
 * - Discord custom emojis (<:name:id> and <a:name:id>)
 * - Code blocks (```language...```)
 * - Newlines and word boundaries
 * 
 * @param {string} text - The text to split
 * @param {number} maxLength - Maximum length per chunk (default: 1900)
 * @returns {string[]} - Array of message chunks
 */
export function splitMessage(text, maxLength = MAX_DISCORD_LENGTH) {
    if (!text) return [];
    if (text.length <= maxLength) return [text];

    const chunks = [];
    let remainingText = text;

    while (remainingText.length > 0) {
        if (remainingText.length <= maxLength) {
            chunks.push(remainingText);
            break;
        }

        // Find the best split point within maxLength
        let splitPoint = findSafeSplitPoint(remainingText, maxLength);
        
        chunks.push(remainingText.substring(0, splitPoint));
        remainingText = remainingText.substring(splitPoint);
    }

    return chunks;
}

/**
 * Finds a safe point to split text without breaking Discord syntax.
 * Priority: newline > space > force split at boundary
 * 
 * @param {string} text - Text to analyze
 * @param {number} maxLength - Maximum length for this chunk
 * @returns {number} - The index where text should be split
 */
function findSafeSplitPoint(text, maxLength) {
    // First, ensure we don't split in the middle of critical Discord syntax
    let candidatePoint = maxLength;

    // Check if we're inside a code block
    const codeBlockInfo = findCodeBlockBoundary(text, candidatePoint);
    if (codeBlockInfo.insideBlock) {
        // If we're inside a code block, split before it starts
        if (codeBlockInfo.blockStart > 0) {
            candidatePoint = codeBlockInfo.blockStart;
        } else {
            // Code block starts at beginning, try to split after it ends
            if (codeBlockInfo.blockEnd > 0 && codeBlockInfo.blockEnd <= maxLength) {
                candidatePoint = codeBlockInfo.blockEnd;
            }
        }
    }

    // Check if we're inside a Discord emoji
    const emojiInfo = findEmojiAtPosition(text, candidatePoint);
    if (emojiInfo.insideEmoji) {
        // Split before the emoji starts
        candidatePoint = emojiInfo.emojiStart;
    }

    // Now find the best natural break point at or before candidatePoint
    // Priority: newline > space > exact position

    // Try to find last newline
    const lastNewline = text.lastIndexOf('\n', candidatePoint - 1);
    if (lastNewline > candidatePoint * 0.5) { // Don't backtrack too far (more than 50%)
        return lastNewline + 1;
    }

    // Try to find last space
    const lastSpace = text.lastIndexOf(' ', candidatePoint - 1);
    if (lastSpace > candidatePoint * 0.7) { // Don't backtrack too far (more than 30%)
        return lastSpace + 1;
    }

    // No good break point found, use candidatePoint
    return Math.max(1, candidatePoint); // Ensure at least 1 character
}

/**
 * Checks if a position is inside a code block and returns boundary information.
 * 
 * @param {string} text - Text to analyze
 * @param {number} position - Position to check
 * @returns {{insideBlock: boolean, blockStart: number, blockEnd: number}}
 */
function findCodeBlockBoundary(text, position) {
    const codeBlockPattern = /```[\s\S]*?```/g;
    let match;
    
    while ((match = codeBlockPattern.exec(text)) !== null) {
        const start = match.index;
        const end = match.index + match[0].length;
        
        if (position > start && position < end) {
            return { insideBlock: true, blockStart: start, blockEnd: end };
        }
        
        // If position is past this block, continue searching
        if (position < start) {
            break;
        }
    }
    
    return { insideBlock: false, blockStart: -1, blockEnd: -1 };
}

/**
 * Checks if a position is inside a Discord emoji and returns boundary information.
 * Discord emoji formats: <:name:id> or <a:name:id> (animated)
 * 
 * @param {string} text - Text to analyze
 * @param {number} position - Position to check
 * @returns {{insideEmoji: boolean, emojiStart: number, emojiEnd: number}}
 */
function findEmojiAtPosition(text, position) {
    // Discord emoji pattern: <:name:id> or <a:name:id>
    const emojiPattern = /<a?:\w+:\d+>/g;
    let match;
    
    while ((match = emojiPattern.exec(text)) !== null) {
        const start = match.index;
        const end = match.index + match[0].length;
        
        if (position > start && position < end) {
            return { insideEmoji: true, emojiStart: start, emojiEnd: end };
        }
        
        // If position is past this emoji, continue searching
        if (position < start) {
            break;
        }
    }
    
    return { insideEmoji: false, emojiStart: -1, emojiEnd: -1 };
}

/**
 * Sends a message or multiple chunks if it exceeds Discord's limit.
 * Handles both reply and regular send.
 * 
 * @param {Object} message - Discord message object
 * @param {string} text - Text to send
 * @param {boolean} useReply - Whether to reply to the original message (only for first chunk)
 * @returns {Promise<void>}
 */
export async function sendSplitMessage(message, text, useReply = false) {
    const chunks = splitMessage(text);
    
    for (let i = 0; i < chunks.length; i++) {
        if (i === 0 && useReply) {
            await message.reply(chunks[i]);
        } else {
            await message.channel.send(chunks[i]);
        }
    }
}

/**
 * Splits text for Discord embed descriptions (4096 character limit).
 * Uses the same safe-split logic as splitMessage to preserve Discord syntax.
 * 
 * @param {string} text - The text to split
 * @param {number} maxLength - Maximum length per chunk (default: 4096)
 * @returns {string[]} - Array of description chunks
 */
export function splitEmbedDescription(text, maxLength = MAX_EMBED_DESCRIPTION_LENGTH) {
    if (!text) return [];
    if (text.length <= maxLength) return [text];

    const chunks = [];
    let remainingText = text;

    while (remainingText.length > 0) {
        if (remainingText.length <= maxLength) {
            chunks.push(remainingText);
            break;
        }

        // Find the best split point within maxLength
        let splitPoint = findSafeSplitPoint(remainingText, maxLength);
        
        chunks.push(remainingText.substring(0, splitPoint));
        remainingText = remainingText.substring(splitPoint);
    }

    return chunks;
}

/**
 * Creates an array of EmbedBuilder objects with split descriptions.
 * Reuses the same safe-split logic as splitMessage and splitEmbedDescription.
 * Adds "Part X of Y" indicators if content spans multiple embeds.
 * Disclaimer field only appears on the final embed.
 * 
 * @param {Object} EmbedBuilder - Discord.js EmbedBuilder class
 * @param {string} description - The full description text
 * @param {string} color - Hex color code (e.g., "#36AAD4")
 * @param {string|null} disclaimerField - Optional disclaimer text (only added to final embed)
 * @returns {Array<EmbedBuilder>} - Array of configured EmbedBuilder objects
 */
export function createSplitEmbeds(EmbedBuilder, description, color, disclaimerField = null) {
    const chunks = splitEmbedDescription(description);
    
    return chunks.map((chunk, index) => {
        const embed = new EmbedBuilder().setColor(color);
        
        // Add "Part X of Y" indicator if multiple chunks
        if (chunks.length > 1) {
            const partIndicator = `**Part ${index + 1} of ${chunks.length}:**\n`;
            embed.setDescription(partIndicator + chunk);
        } else {
            embed.setDescription(chunk);
        }
        
        // Only add disclaimer field to the last embed
        if (index === chunks.length - 1 && disclaimerField) {
            embed.addFields({ name: '', value: disclaimerField });
        }
        
        return embed;
    });
}
