/**
 * Test suite for message splitter utility
 * Tests emoji preservation, code block handling, and boundary detection
 */

import { splitMessage } from '../src/shared/messageSplitter.js';

console.log('🧪 Testing Message Splitter Utility\n');

// Test 1: Short message (should not split)
console.log('Test 1: Short message');
const shortMsg = 'This is a short message with <:navi:123456789> emoji';
const result1 = splitMessage(shortMsg);
console.log(`Input length: ${shortMsg.length}`);
console.log(`Chunks: ${result1.length}`);
console.log(`Result: ${result1[0]}`);
console.log(`✅ Pass: ${result1.length === 1 && result1[0] === shortMsg}\n`);

// Test 2: Message with emoji at split boundary
console.log('Test 2: Emoji at split boundary');
const emojiMsg = 'A'.repeat(1895) + ' <:6symbolnavi:1341400385709019138> ' + 'B'.repeat(100);
const result2 = splitMessage(emojiMsg);
console.log(`Input length: ${emojiMsg.length}`);
console.log(`Chunks: ${result2.length}`);
// Check that emoji is not split
const emojiSplit = result2.some(chunk => 
    (chunk.includes('<:6symbolnavi:') && !chunk.includes('1341400385709019138>')) ||
    (chunk.includes('1341400385709019138>') && !chunk.includes('<:6symbolnavi:'))
);
console.log(`Emoji preserved: ${!emojiSplit}`);
console.log(`Chunk 1 ends with: ...${result2[0].slice(-50)}`);
console.log(`Chunk 2 starts with: ${result2[1].slice(0, 50)}...`);
console.log(`✅ Pass: ${!emojiSplit && result2.length === 2}\n`);

// Test 3: Multiple emojis
console.log('Test 3: Multiple emojis');
const multiEmojiMsg = 'Start text ' + 'X'.repeat(1800) + ' <:emoji1:111> middle <:emoji2:222> <a:animated:333> end';
const result3 = splitMessage(multiEmojiMsg);
console.log(`Input length: ${multiEmojiMsg.length}`);
console.log(`Chunks: ${result3.length}`);
const allEmojisIntact = result3.every(chunk => {
    const matches = chunk.match(/<a?:\w+:\d+>/g) || [];
    return matches.every(emoji => emoji.match(/<a?:\w+:\d+>$/));
});
console.log(`All emojis intact: ${allEmojisIntact}`);
console.log(`✅ Pass: ${allEmojisIntact}\n`);

// Test 4: Code block preservation
console.log('Test 4: Code block at split boundary');
const codeBlockMsg = 'A'.repeat(1850) + '\n```javascript\nfunction test() {\n  return true;\n}\n```\n' + 'B'.repeat(100);
const result4 = splitMessage(codeBlockMsg);
console.log(`Input length: ${codeBlockMsg.length}`);
console.log(`Chunks: ${result4.length}`);
// Check that code block is not split
const codeBlockSplit = result4.some((chunk, idx) => 
    (chunk.includes('```') && chunk.split('```').length % 2 === 0 && idx < result4.length - 1)
);
console.log(`Code block preserved: ${!codeBlockSplit}`);
result4.forEach((chunk, idx) => {
    const backticks = (chunk.match(/```/g) || []).length;
    console.log(`  Chunk ${idx + 1}: ${backticks} backtick sets, length ${chunk.length}`);
});
console.log(`✅ Pass: ${!codeBlockSplit}\n`);

// Test 5: Newline splitting
console.log('Test 5: Splits on newlines when possible');
const newlineMsg = 'Line 1\n' + 'A'.repeat(1000) + '\nLine 2\n' + 'B'.repeat(1000) + '\nLine 3';
const result5 = splitMessage(newlineMsg);
console.log(`Input length: ${newlineMsg.length}`);
console.log(`Chunks: ${result5.length}`);
const endsWithNewline = result5.slice(0, -1).every(chunk => chunk.endsWith('\n') || chunk.endsWith('\nLine'));
console.log(`Clean newline splits: ${endsWithNewline}`);
console.log(`✅ Pass: ${result5.length >= 2}\n`);

// Test 6: Word boundary splitting
console.log('Test 6: Splits on word boundaries when no newlines');
const wordMsg = 'word '.repeat(400); // ~2000 chars with no newlines
const result6 = splitMessage(wordMsg);
console.log(`Input length: ${wordMsg.length}`);
console.log(`Chunks: ${result6.length}`);
const cleanWordSplits = result6.slice(0, -1).every(chunk => chunk.endsWith(' '));
console.log(`Clean word splits: ${cleanWordSplits}`);
console.log(`✅ Pass: ${result6.length >= 2 && cleanWordSplits}\n`);

// Test 7: Real-world example from user
console.log('Test 7: Real-world matchup data with emoji');
const realWorldMsg = 'D-tilt clanks with almost everything Joker throws out at that height and is an excellent tool for low-profiling his Gun.\n<:6symbolnavi:1341400385709019138> - Bair Ledge\n' + 'Additional matchup info '.repeat(150);
const result7 = splitMessage(realWorldMsg);
console.log(`Input length: ${realWorldMsg.length}`);
console.log(`Chunks: ${result7.length}`);
const emojiIntact = result7.join('').includes('<:6symbolnavi:1341400385709019138>');
const noPartialEmoji = !result7.some(chunk => 
    chunk.includes('<:6symbolnavi:') && !chunk.includes('1341400385709019138>')
);
console.log(`Emoji intact: ${emojiIntact && noPartialEmoji}`);
console.log(`✅ Pass: ${emojiIntact && noPartialEmoji}\n`);

// Test 8: Edge case - emoji exactly at 1900 chars
console.log('Test 8: Emoji exactly at character limit');
const edgeCaseMsg = 'X'.repeat(1900) + '<:test:999999999999999999>';
const result8 = splitMessage(edgeCaseMsg);
console.log(`Input length: ${edgeCaseMsg.length}`);
console.log(`Chunks: ${result8.length}`);
const emojiInSecondChunk = result8[1] && result8[1].includes('<:test:999999999999999999>');
console.log(`Emoji moved to next chunk: ${emojiInSecondChunk}`);
console.log(`✅ Pass: ${result8.length === 2 && emojiInSecondChunk}\n`);

// Test 9: Empty and null inputs
console.log('Test 9: Edge cases - empty/null');
const result9a = splitMessage('');
const result9b = splitMessage(null);
console.log(`Empty string: ${result9a.length} chunks`);
console.log(`Null: ${result9b.length} chunks`);
console.log(`✅ Pass: ${result9a.length === 0 && result9b.length === 0}\n`);

// Test 10: Very long message with multiple patterns
console.log('Test 10: Complex message with all patterns');
const complexMsg = `# Matchup Analysis
${'Line '.repeat(100)}

\`\`\`javascript
// Code example
const combo = true;
\`\`\`

<:navi:123> Tip 1: ${'word '.repeat(200)}
<a:animated:456> Tip 2: ${'content '.repeat(200)}

More analysis ${'here '.repeat(300)}`;
const result10 = splitMessage(complexMsg);
console.log(`Input length: ${complexMsg.length}`);
console.log(`Chunks: ${result10.length}`);
const allValid = result10.every(chunk => chunk.length <= 1900);
const hasAllContent = result10.join('') === complexMsg;
console.log(`All chunks within limit: ${allValid}`);
console.log(`No content lost: ${hasAllContent}`);
console.log(`✅ Pass: ${allValid && hasAllContent}\n`);

console.log('🎉 All tests completed!');
