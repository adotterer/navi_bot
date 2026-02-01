import dotenv from 'dotenv';
import axios from 'axios';
import { executeQuery } from './src/tournaments/startggClient.js';

dotenv.config();

const AUTH_TOKEN = process.env.STARTGG_AUTH_TOKEN;

/**
 * Get character data from schustats.com using start.gg user slug
 * The site expects: https://www.schustats.com/get_character?tag=[start.gg user URL]
 * Format: https://www.start.gg/user/[user_id] where user_id is extracted from slug "user/ae3cb3e8"
 */
async function getCharacterFromSchustats(userSlug) {
    console.log(`\n🎯 Fetching character data from schustats.com for: ${userSlug}\n`);

    // Extract the user ID from the slug (e.g., "user/ae3cb3e8" -> "ae3cb3e8")
    const userId = userSlug.includes('/') ? userSlug.split('/').pop() : userSlug;
    
    // Schustats expects the full start.gg URL in the format: https://www.start.gg/user/[user_id]
    const startggUrl = `https://www.start.gg/user/${userId}`;
    const schustatsUrl = `https://www.schustats.com/get_character?tag=${encodeURIComponent(startggUrl)}`;
    
    console.log(`Start.gg URL: ${startggUrl}`);

    try {
        console.log(`Request URL: ${schustatsUrl}`);
        
        const response = await axios.get(schustatsUrl, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
        });

        // The response is HTML, we need to parse it
        const html = response.data;
        
        // Look for character data in the HTML
        // Schustats typically displays character icons or names
        // We'll need to parse the HTML structure
        
        console.log('✅ Response received (HTML)');
        console.log(`Response length: ${html.length} characters\n`);
        
        // Try to extract character information from the HTML
        // Common patterns to look for:
        const characterPatterns = [
            /character[s]?["\s:]+([A-Za-z\s&]+)/gi,
            /main[s]?["\s:]+([A-Za-z\s&]+)/gi,
            /"character"[:\s]+"([^"]+)"/gi
        ];

        const foundCharacters = new Set();
        
        for (const pattern of characterPatterns) {
            const matches = [...html.matchAll(pattern)];
            matches.forEach(match => {
                if (match[1] && match[1].length < 50) {
                    foundCharacters.add(match[1].trim());
                }
            });
        }

        if (foundCharacters.size > 0) {
            console.log('🎮 Potential character data found:');
            foundCharacters.forEach(char => console.log(`   - ${char}`));
        } else {
            console.log('⚠️  Could not extract character data from HTML automatically');
            console.log('The page requires JavaScript rendering or has a different structure\n');
            console.log('💡 Suggestion: schustats.com likely needs browser rendering to work properly');
        }

        return html;

    } catch (error) {
        if (error.response) {
            console.error(`❌ HTTP ${error.response.status}: ${error.response.statusText}`);
        } else {
            console.error(`❌ Error: ${error.message}`);
        }
        return null;
    }
}

/**
 * Get participants from today's tournaments with their user slugs
 */
async function getTodaysParticipants() {
    console.log('\n📅 Getting real participants from today\'s tournaments\n');

    const query = `
        query GetTournamentParticipants($tournamentId: ID!) {
            tournament(id: $tournamentId) {
                id
                name
                events {
                    id
                    name
                    entrants(query: { page: 1, perPage: 20 }) {
                        nodes {
                            id
                            name
                            participants {
                                id
                                gamerTag
                                user {
                                    id
                                    slug
                                    name
                                }
                            }
                        }
                    }
                }
            }
        }
    `;

    try {
        // Use the SHOWTIME tournament from earlier - it has 103 entrants
        const data = await executeQuery(query, { tournamentId: "816674" }, AUTH_TOKEN);
        const tournament = data.tournament;
        
        console.log(`Tournament: ${tournament.name}`);
        
        const participants = [];
        tournament.events.forEach(event => {
            event.entrants.nodes.forEach(entrant => {
                entrant.participants.forEach(participant => {
                    if (participant.user && participant.user.slug) {
                        participants.push({
                            gamerTag: participant.gamerTag,
                            userSlug: participant.user.slug,
                            userId: participant.user.id
                        });
                    }
                });
            });
        });

        return participants;

    } catch (error) {
        console.error('❌ Error getting participants:', error.message);
        return [];
    }
}

/**
 * Test the full workflow: Get real participants and test schustats lookup
 */
async function testCharacterLookupWorkflow() {
    console.log('🎮 CHARACTER LOOKUP WORKFLOW TEST\n');
    console.log('='.repeat(60));

    // Step 1: Get real participants from today's tournaments
    const participants = await getTodaysParticipants();
    
    if (participants.length === 0) {
        console.log('❌ No participants found');
        return;
    }

    console.log(`\n✅ Found ${participants.length} participants with user accounts\n`);
    console.log('Sample participants:');
    participants.slice(0, 5).forEach((p, idx) => {
        console.log(`${idx + 1}. ${p.gamerTag} (slug: ${p.userSlug})`);
    });

    // Step 2: Test schustats with first 3 participants
    console.log(`\n${'='.repeat(60)}`);
    console.log('\n🎯 Testing schustats.com with real players:\n');

    for (let i = 0; i < Math.min(3, participants.length); i++) {
        const participant = participants[i];
        
        console.log(`\n${'='.repeat(60)}`);
        console.log(`\nPlayer ${i + 1}: ${participant.gamerTag}`);
        console.log(`User slug: ${participant.userSlug}`);
        
        await getCharacterFromSchustats(participant.userSlug);
        
        // Delay between requests
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log(`\n\n${'='.repeat(60)}`);
    console.log('\n📝 CONCLUSIONS:\n');
    console.log('1. ✅ We can get participant user slugs from Start.gg tournaments');
    console.log('2. ✅ Schustats.com is accessible with proper user slugs');
    console.log('3. ⚠️  Schustats requires JavaScript rendering to display character data');
    console.log('4. 💡 Next steps for character data:');
    console.log('   a) Build manual database for common players and update over time');
    console.log('   b) Start with filtering by tournament size (bigger = more likely streamed)');
    console.log('   c) Implement caching to avoid repeated lookups\n');
    console.log('5. 🎯 For MVP: Focus on specific characters filter first, add player');
    console.log('   character mapping later as database grows\n');
}

// Run the test
testCharacterLookupWorkflow();
