import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const STARTGG_AUTH_TOKEN = process.env.STARTGG_AUTH_TOKEN;
const STARTGG_API = 'https://api.start.gg/gql/alpha';

async function test() {
  const query = `{
    user(slug: "4b56197c") {
      id
      slug
      player {
        id
        gamerTag
      }
    }
  }`;

  try {
    const response = await axios.post(
      STARTGG_API,
      { query },
      {
        headers: {
          'Authorization': `Bearer ${STARTGG_AUTH_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: 5000
      }
    );
    
    console.log(JSON.stringify(response.data, null, 2));
  } catch (e) {
    console.error('Error:', e.message);
  }
  process.exit(0);
}

test();
