/**
 * Discord OAuth2 login (identify scope only) — separate from discordRest.js, which uses the BOT
 * token. This module uses the *user's* OAuth token, and only long enough to identify who they are;
 * role membership is then checked server-side via the bot token (see discordRest.js), so no
 * guilds.members.read scope is needed here.
 */
import axios from 'axios';

const AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const TOKEN_URL = 'https://discord.com/api/v10/oauth2/token';
const USER_URL = 'https://discord.com/api/v10/users/@me';

export function getAuthorizeUrl(state) {
    const params = new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        redirect_uri: process.env.DISCORD_OAUTH_REDIRECT_URI,
        response_type: 'code',
        scope: 'identify',
        state,
    });
    return `${AUTHORIZE_URL}?${params}`;
}

export async function exchangeCodeForToken(code) {
    const body = new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.DISCORD_OAUTH_REDIRECT_URI,
    });
    const { data } = await axios.post(TOKEN_URL, body, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return data; // { access_token, token_type, expires_in, scope, ... }
}

export async function getDiscordUser(accessToken) {
    const { data } = await axios.get(USER_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    return data; // { id, username, avatar, ... }
}
