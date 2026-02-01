import dotenv from 'dotenv';
import { executeQuery } from './src/tournaments/startggClient.js';
import CharacterDatabase from './src/tournaments/characterDatabase.js';

dotenv.config();

const AUTH_TOKEN = process.env.STARTGG_AUTH_TOKEN;

/**
 * Get participants from a tournament
 */
async function getTournamentParticipants(tournamentId) {
    const query = `
        query GetTournamentParticipants($tournamentId: ID!) {
            tournament(id: $tournamentId) {
                id
                name
                events {
                    id
                    name
                    entrants(query: { page: 1, perPage: 50 }) {
                        nodes {
                            id
                            name
                            participants {
                                id
                                gamerTag
                                user {
                                    id
                                    slug
                                }
                            }
                        }
                    }
                }
            }
        }
    `;

    try {
        const data = await executeQuery(query, { tournamentId }, AUTH_TOKEN);
        const tournament = data.tournament;
        
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

        return { tournament, participants };

    } catch (error) {
        console.error('❌ Error getting participants:', error.message);
        return null;
    }
}

/**
 * Main test function
 */
async function testCharacterDatabase() {
    console.log('🎮 CHARACTER DATABASE TEST WITH CACHING\n');
    console.log('='.repeat(60));

    // Initialize character database
    const db = new CharacterDatabase();
    await db.init();

    console.log('\n' + '='.repeat(60));
    console.log('\n📊 Current Database Stats:');
    const initialStats = db.getStats();
    console.log(`   Total Players: ${initialStats.totalPlayers}`);
    console.log(`   Zelda Players: ${initialStats.zeldaPlayers}`);
    
    if (Object.keys(initialStats.characters).length > 0) {
        console.log('\n   Character Distribution:');
        Object.entries(initialStats.characters)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .forEach(([char, count]) => {
                console.log(`      ${char}: ${count}`);
            });
    }

    console.log('\n' + '='.repeat(60));
    console.log('\n📅 Fetching today\'s tournament participants...\n');

    // Get tournament participants (SHOWTIME - NEPA SMASH REGIONAL 2026)
    const result = await getTournamentParticipants("816674");
    
    if (!result) {
        console.log('❌ Failed to get tournament data');
        await db.close();
        return;
    }

    const { tournament, participants } = result;
    console.log(`Tournament: ${tournament.name}`);
    console.log(`Found ${participants.length} participants\n`);

    console.log('='.repeat(60));
    console.log('\n🔍 Looking up character mains (checking cache first)...\n');

    // Look up character data for first 10 participants
    const lookupCount = Math.min(5, participants.length);
    
    for (let i = 0; i < lookupCount; i++) {
        const participant = participants[i];
        console.log(`\n${i + 1}/${lookupCount}. ${participant.gamerTag} (${participant.userSlug})`);
        
        const character = await db.getPlayerCharacter(participant.userSlug, participant.gamerTag);
        
        if (character && character.length > 0) {
            console.log(`   ✅ Main(s): ${character.join(' / ')}`);
        } else {
            console.log(`   ⚠️  Could not determine main character`);
        }

        // Small delay between scrapes to be polite
        if (i < lookupCount - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log('\n📊 Updated Database Stats:');
    const finalStats = db.getStats();
    console.log(`   Total Players: ${finalStats.totalPlayers} (+${finalStats.totalPlayers - initialStats.totalPlayers})`);
    console.log(`   Zelda Players: ${finalStats.zeldaPlayers} (+${finalStats.zeldaPlayers - initialStats.zeldaPlayers})`);
    
    if (finalStats.zeldaPlayers > 0) {
        console.log('\n   🎯 Zelda Players Found:');
        const zeldaPlayers = db.getZeldaPlayers();
        zeldaPlayers.forEach((slug, idx) => {
            const gamerTag = participants.find(p => p.userSlug === slug)?.gamerTag || slug;
            console.log(`      ${idx + 1}. ${gamerTag}`);
        });
    }

    if (Object.keys(finalStats.characters).length > 0) {
        console.log('\n   Character Distribution:');
        Object.entries(finalStats.characters)
            .sort(([, a], [, b]) => b - a)
            .forEach(([char, count]) => {
                console.log(`      ${char}: ${count}`);
            });
    }

    console.log('\n' + '='.repeat(60));
    console.log('\n💡 Next Steps:');
    console.log('1. Run this script periodically to build up the database');
    console.log('2. The cache files are stored in ./data/ directory');
    console.log('3. Zelda players are automatically tracked in zelda_players.json');
    console.log('4. Future lookups will use cache first (instant!)');
    console.log('5. Use db.isZeldaPlayer(userSlug) to filter players\n');

    // Cleanup
    await db.close();
}

// Run the test
testCharacterDatabase();
