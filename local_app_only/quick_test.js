import dotenv from 'dotenv';
import { executeQuery } from './src/tournaments/startggClient.js';

dotenv.config();

const AUTH_TOKEN = process.env.STARTGG_AUTH_TOKEN;

async function quickTest() {
    try {
        console.log('Testing API...\n');
        
        const query = `
            query {
                tournament(slug: "tournament/showtime-nepa-smash-regional-2026") {
                    name
                    startAt
                }
            }
        `;

        const result = await executeQuery(query, {}, AUTH_TOKEN);
        console.log('Tournament:', result.tournament.name);
        console.log('Date:', new Date(result.tournament.startAt * 1000).toLocaleDateString());
        
    } catch (error) {
        console.error('Error:', error.message);
    }
    
    process.exit(0);
}

quickTest();
