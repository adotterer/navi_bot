import { normalizeCharacterText, buildCharacterAliasMap } from '../src/matchups/characterAliases.js';

// Mock S3 data for testing
const mockS3Data = {
    'pit|dark-pit.json': [
        { author: 'katyparry', content: 'Pit is tricky in neutral' },
        { author: 'user2', content: 'Watch out for the arrow spam' }
    ],
    'peach|daisy.json': [
        { author: 'katyparry', content: 'Peach turnips are annoying' },
        { author: 'user3', content: 'Practice your spacing' }
    ]
};

console.log('=== Testing normalizeCharacterText ===\n');

// Test different pipe characters
const testCases = [
    'pit | dark-pit',           // regular pipe
    'pit | dark-pit',           // regular space and pipe
    'pit︱dark-pit',              // Unicode vertical line (︱)
    'pit｜dark-pit',              // Unicode fullwidth vertical line (｜)
    'peach | daisy',            // regular pipe
];

testCases.forEach(text => {
    const normalized = normalizeCharacterText(text);
    console.log(`Input: "${text}"`);
    console.log(`Normalized: "${normalized}"`);
    console.log(`Contains pipe: ${normalized.includes('|')}`);
    console.log('---');
});

console.log('\n=== Testing buildCharacterAliasMap ===\n');

// Mock a guild object with pipe-separated channels
const mockGuild = {
    channels: {
        cache: {
            *[Symbol.iterator]() {
                yield {
                    parent: { name: 'Match Ups (B-L)' },
                    name: 'pit︱dark-pit'
                };
                yield {
                    parent: { name: 'Match Ups (M-Z)' },
                    name: 'peach|daisy'
                };
                yield {
                    parent: { name: 'Match Ups (M-Z)' },
                    name: 'falco'
                };
            },
            filter(fn) {
                const items = [];
                for (const item of this) {
                    if (fn(item)) items.push(item);
                }
                return {
                    *[Symbol.iterator]() {
                        for (const item of items) yield item;
                    },
                    values() {
                        return this[Symbol.iterator]();
                    }
                };
            }
        }
    }
};

const aliasMap = buildCharacterAliasMap(mockGuild);

console.log('Generated alias map (showing key character mappings):');
console.log('---');
['pit', 'dark-pit', 'dark pit', 'peach', 'daisy'].forEach(key => {
    const value = aliasMap.get(normalizeCharacterText(key));
    console.log(`"${key}" -> "${value || 'NOT FOUND'}"`);
});

console.log('\n=== Testing Mock S3 data ===\n');

// Test pit|dark-pit data
console.log('pit | dark-pit matchup:');
const pitData = mockS3Data['pit|dark-pit.json'];
if (pitData && pitData.length > 0) {
    console.log(`First message author: "${pitData[0].author}"`);
    console.log(`First message content: "${pitData[0].content}"`);
}
console.log('');

// Test peach|daisy data
console.log('peach | daisy matchup:');
const peachData = mockS3Data['peach|daisy.json'];
if (peachData && peachData.length > 0) {
    console.log(`First message author: "${peachData[0].author}"`);
    console.log(`First message content: "${peachData[0].content}"`);
}
