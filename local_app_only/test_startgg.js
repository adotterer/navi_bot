import dotenv from 'dotenv';
import axios from 'axios';

// Load environment variables
dotenv.config();

const STARTGG_API_URL = 'https://api.start.gg/gql/alpha';
const AUTH_TOKEN = process.env.STARTGG_AUTH_TOKEN;

/**
 * Test Start.gg API connection by querying current user info
 */
async function testStartGGConnection() {
    console.log('Testing Start.gg API connection...\n');

    if (!AUTH_TOKEN) {
        console.error('❌ ERROR: STARTGG_AUTH_TOKEN not found in .env file');
        process.exit(1);
    }

    // Simple GraphQL query to get current user info
    const query = `
        query {
            currentUser {
                id
                slug
                bio
                name
                player {
                    gamerTag
                }
            }
        }
    `;

    try {
        const response = await axios.post(
            STARTGG_API_URL,
            {
                query: query
            },
            {
                headers: {
                    'Authorization': `Bearer ${AUTH_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (response.data.errors) {
            console.error('❌ GraphQL Errors:', JSON.stringify(response.data.errors, null, 2));
            return;
        }

        console.log('✅ Successfully connected to Start.gg API!\n');
        console.log('📊 Response data:');
        console.log(JSON.stringify(response.data.data, null, 2));

    } catch (error) {
        if (error.response) {
            console.error('❌ API Error Response:', error.response.status);
            console.error('Error details:', error.response.data);
        } else if (error.request) {
            console.error('❌ No response received from API');
            console.error('Error:', error.message);
        } else {
            console.error('❌ Error setting up request:', error.message);
        }
    }
}

// Run the test
testStartGGConnection();
