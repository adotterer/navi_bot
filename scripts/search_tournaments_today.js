import dotenv from 'dotenv';
import { executeQuery } from '../src/tournaments/startggClient.js';

dotenv.config();

const AUTH_TOKEN = process.env.STARTGG_AUTH_TOKEN;
const SSBU_VIDEOGAME_ID = 1386;

function getTodayRange() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return {
        start: Math.floor(today.getTime() / 1000),
        end: Math.floor(tomorrow.getTime() / 1000)
    };
}

async function fetchAllTournaments() {
    const { start, end } = getTodayRange();
    const all = [];
    let page = 1;
    const perPage = 50;

    while (true) {
        const query = `
            query GetTournaments($videogameId: ID!, $afterDate: Timestamp!, $page: Int!, $perPage: Int!) {
                tournaments(query: {
                    page: $page
                    perPage: $perPage
                    filter: {
                        upcoming: true
                        videogameIds: [$videogameId]
                        afterDate: $afterDate
                    }
                }) {
                    nodes {
                        id
                        name
                        slug
                        startAt
                    }
                    pageInfo {
                        totalPages
                        page
                    }
                }
            }
        `;

        const data = await executeQuery(query, {
            videogameId: SSBU_VIDEOGAME_ID,
            afterDate: start,
            page,
            perPage
        }, AUTH_TOKEN);

        const nodes = data?.tournaments?.nodes || [];
        if (nodes.length === 0) break;

        all.push(...nodes);

        const totalPages = data?.tournaments?.pageInfo?.totalPages || page;
        if (page >= totalPages) break;
        page += 1;
    }

    const todays = all.filter(t => t.startAt >= start && t.startAt < end);
    return { all, todays };
}

async function main() {
    console.log('\n🔎 Searching today\'s tournaments with pagination...\n');

    try {
        const { todays } = await fetchAllTournaments();
        console.log(`Found ${todays.length} tournaments today.`);

        const nepa = todays.filter(t => t.name.toLowerCase().includes('nepa'));
        const showtime = todays.filter(t => t.name.toLowerCase().includes('showtime'));
        const regional = todays.filter(t => t.name.toLowerCase().includes('regional'));

        if (nepa.length > 0) {
            console.log('\nNEPA matches:');
            nepa.forEach(t => console.log(`- ${t.name} (${t.slug})`));
        }

        if (showtime.length > 0) {
            console.log('\nSHOWTIME matches:');
            showtime.forEach(t => console.log(`- ${t.name} (${t.slug})`));
        }

        if (regional.length > 0) {
            console.log('\nREGIONAL matches:');
            regional.forEach(t => console.log(`- ${t.name} (${t.slug})`));
        }

        console.log('\nAll today\'s tournaments:');
        todays.forEach((t, idx) => {
            const startTime = new Date(t.startAt * 1000).toLocaleTimeString();
            console.log(`${idx + 1}. ${t.name} - ${startTime} - ${t.slug}`);
        });

    } catch (error) {
        console.error('❌ Error:', error.message);
    }

    process.exit(0);
}

main();
