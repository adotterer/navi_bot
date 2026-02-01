import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const STARTGG_AUTH_TOKEN = process.env.STARTGG_AUTH_TOKEN;
const STARTGG_API = 'https://api.start.gg/gql/alpha';

const query = `
  query GetUserBySlug($slug: String!) {
    user(slug: $slug) {
      id
      slug
      player {
        id
        gamerTag
      }
    }
  }
`;

axios.post(
  STARTGG_API,
  { query, variables: { slug: '4b56197c' } },
  {
    headers: {
      'Authorization': `Bearer ${STARTGG_AUTH_TOKEN}`,
      'Content-Type': 'application/json',
    }
  }
).then(r => {
  console.log(JSON.stringify(r.data, null, 2));
  if (r.data.data?.user?.player?.id) {
    console.log(`\nPlayer ID: ${r.data.data.user.player.id}`);
    console.log(`Player Tag: ${r.data.data.user.player.gamerTag}`);
  }
})
.catch(e => console.error(e.message));
