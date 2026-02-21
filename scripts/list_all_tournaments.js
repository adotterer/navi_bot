import dotenv from 'dotenv';
import { getActiveTournaments } from '../src/tournaments/startggClient.js';

dotenv.config();

const AUTH_TOKEN = process.env.STARTGG_AUTH_TOKEN;

async function listAllTournaments() {
    console.log('\n📋 ALL ACTIVE SSBU TOURNAMENTS TODAY\n');
    console.log('='.repeat(70) + '\n');

    try {
        const SSBU_VIDEOGAME_ID = 1386;
        const tournaments = await getActiveTournaments(SSBU_VIDEOGAME_ID, AUTH_TOKEN);

        console.log(`Found ${tournaments.length} tournaments:\n`);

        tournaments.forEach((t, idx) => {
            const startTime = new Date(t.startAt * 1000).toLocaleTimeString();
            console.log(`${idx + 1}. ${t.name}`);
            console.log(`   🔗 ${t.slug}`);
            console.log(`   ⏰ ${startTime}`);
            console.log('');
        });

        const nepa = tournaments.filter(t => t.name.toLowerCase().includes('nepa'));
        const showtime = tournaments.filter(t => t.name.toLowerCase().includes('showtime'));
        const sd = tournaments.filter(t => t.name.toLowerCase().includes('sd sundays'));

        if (nepa.length > 0) {
            console.log('\n🔍 NEPA tournaments:');
            nepa.forEach(t => console.log(`   • ${t.name}`));
        }

        if (showtime.length > 0) {
            console.log('\n🔍 SHOWTIME tournaments:');
            showtime.forEach(t => console.log(`   • ${t.name}`));
        }

        if (sd.length > 0) {
            console.log('\n🔍 SD Sundays tournaments:');
            sd.forEach(t => console.log(`   • ${t.name}`));
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    }

    process.exit(0);
}

listAllTournaments();
