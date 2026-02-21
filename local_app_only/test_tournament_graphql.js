/**
 * Local test: fetch one or two tournaments from start.gg GraphQL and print full response.
 * Run from repo root: node local_app_only/test_tournament_graphql.js
 * Requires .env with STARTGG_AUTH_TOKEN.
 */
import dotenv from 'dotenv';
import { getTournament } from '../src/tournaments/startggClient.js';

dotenv.config();

const SLUGS = [
    'encore-smash-monthly-52-250-pot-bonus',
    'massachusetts-battle-of-top-academics-6'
];

async function main() {
    const token = process.env.STARTGG_AUTH_TOKEN;
    if (!token) {
        console.error('❌ STARTGG_AUTH_TOKEN not set in .env');
        process.exit(1);
    }

    for (const slug of SLUGS) {
        console.log('\n' + '='.repeat(60));
        console.log(`Tournament slug: ${slug}`);
        console.log('='.repeat(60));
        try {
            const data = await getTournament(slug, token);
            console.log(JSON.stringify(data, null, 2));
        } catch (e) {
            console.error('Error:', e.message);
        }
    }
    process.exit(0);
}

main();
