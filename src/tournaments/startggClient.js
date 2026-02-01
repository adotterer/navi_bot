import axios from 'axios';

const STARTGG_API_URL = 'https://api.start.gg/gql/alpha';

/**
 * Make a GraphQL query to Start.gg API
 * @param {string} query - GraphQL query string
 * @param {object} variables - Query variables
 * @param {string} authToken - Start.gg auth token
 * @returns {Promise<object>} - Query response data
 */
export async function executeQuery(query, variables = {}, authToken) {
    if (!authToken) {
        throw new Error('Start.gg auth token is required');
    }

    try {
        const response = await axios.post(
            STARTGG_API_URL,
            {
                query: query,
                variables: variables
            },
            {
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (response.data.errors) {
            throw new Error(`GraphQL Errors: ${JSON.stringify(response.data.errors)}`);
        }

        return response.data.data;
    } catch (error) {
        if (error.response) {
            throw new Error(`Start.gg API Error (${error.response.status}): ${JSON.stringify(error.response.data)}`);
        }
        throw error;
    }
}

/**
 * Get tournament details by slug
 * @param {string} slug - Tournament slug (e.g., "genesis-x")
 * @param {string} authToken - Start.gg auth token
 * @returns {Promise<object>} - Tournament data
 */
export async function getTournament(slug, authToken) {
    const query = `
        query GetTournament($slug: String!) {
            tournament(slug: $slug) {
                id
                name
                slug
                startAt
                endAt
                city
                countryCode
                venueAddress
                numAttendees
                events {
                    id
                    name
                    slug
                    videogame {
                        id
                        name
                    }
                }
                streams {
                    streamName
                    streamSource
                }
            }
        }
    `;

    const data = await executeQuery(query, { slug }, authToken);
    return data.tournament;
}

/**
 * Get active/upcoming tournaments for a specific game
 * @param {number} videogameId - Videogame ID (SSBU is typically 1386)
 * @param {string} authToken - Start.gg auth token
 * @returns {Promise<array>} - Array of tournaments
 */
export async function getActiveTournaments(videogameId, authToken) {
    const query = `
        query GetActiveTournaments($videogameId: ID!, $afterDate: Timestamp!) {
            tournaments(query: {
                perPage: 20
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
                    endAt
                    isOnline
                    numAttendees
                    streams {
                        streamName
                        streamSource
                    }
                    events {
                        id
                        name
                        videogame {
                            id
                            name
                        }
                    }
                }
            }
        }
    `;

    const afterDate = Math.floor(Date.now() / 1000); // Current timestamp
    const data = await executeQuery(query, { videogameId, afterDate }, authToken);
    return data.tournaments.nodes;
}

/**
 * Get player ID from a Start.gg user slug or profile URL
 * @param {string} userSlug - User slug (e.g., "39ce7d25") or full URL
 * @param {string} authToken - Start.gg auth token
 * @returns {Promise<number|null>} - Player ID or null if not found
 */
export async function getPlayerIdBySlug(userSlug, authToken) {
    if (!userSlug) {
        throw new Error('User slug is required');
    }

    const slug = normalizeUserSlug(userSlug);

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

    const data = await executeQuery(query, { slug }, authToken);
    return data?.user?.player?.id ?? null;
}

/**
 * Normalize a Start.gg user slug from URL or slug-like input
 * @param {string} userSlug - Slug or URL
 * @returns {string}
 */
export function normalizeUserSlug(userSlug) {
    let slug = String(userSlug).trim();

    // Allow full URLs like https://www.start.gg/user/39ce7d25
    if (slug.includes('start.gg')) {
        try {
            const url = new URL(slug);
            const parts = url.pathname.split('/').filter(Boolean);
            const userIndex = parts.indexOf('user');
            if (userIndex !== -1 && parts[userIndex + 1]) {
                slug = parts[userIndex + 1];
            }
        } catch {
            // Fall through to best-effort parsing below
        }
    }

    // Allow inputs like "user/39ce7d25"
    if (slug.includes('/')) {
        slug = slug.split('/').pop();
    }

    return slug;
}

/**
 * Get player info from a Start.gg user slug or URL
 * @param {string} userSlug - User slug or URL
 * @param {string} authToken - Start.gg auth token
 * @returns {Promise<{ playerId: number|null, gamerTag: string|null, slug: string }>} - Player info
 */
export async function getPlayerBySlug(userSlug, authToken) {
    const slug = normalizeUserSlug(userSlug);
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

    const data = await executeQuery(query, { slug }, authToken);
    return {
        playerId: data?.user?.player?.id ?? null,
        gamerTag: data?.user?.player?.gamerTag ?? null,
        slug
    };
}

/**
 * Get sets (matches) for a tournament event
 * @param {number} eventId - Event ID
 * @param {string} authToken - Start.gg auth token
 * @param {number} page - Page number for pagination
 * @returns {Promise<object>} - Sets data with pagination info
 */
export async function getEventSets(eventId, authToken, page = 1) {
    const query = `
        query GetEventSets($eventId: ID!, $page: Int!) {
            event(id: $eventId) {
                id
                name
                sets(
                    page: $page
                    perPage: 20
                    sortType: RECENT
                ) {
                    pageInfo {
                        total
                        totalPages
                    }
                    nodes {
                        id
                        fullRoundText
                        startedAt
                        completedAt
                        stream {
                            streamName
                            streamSource
                        }
                        slots {
                            entrant {
                                id
                                name
                                participants {
                                    gamerTag
                                    user {
                                        id
                                        slug
                                    }
                                }
                            }
                            standing {
                                placement
                                stats {
                                    score {
                                        value
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    `;

    const data = await executeQuery(query, { eventId, page }, authToken);
    return data.event.sets;
}

/**
 * Get player/entrant details
 * @param {number} entrantId - Entrant ID
 * @param {string} authToken - Start.gg auth token
 * @returns {Promise<object>} - Entrant data
 */
export async function getEntrant(entrantId, authToken) {
    const query = `
        query GetEntrant($entrantId: ID!) {
            entrant(id: $entrantId) {
                id
                name
                participants {
                    id
                    gamerTag
                    user {
                        id
                        slug
                        authorizations {
                            type
                            externalUsername
                        }
                    }
                }
            }
        }
    `;

    const data = await executeQuery(query, { entrantId }, authToken);
    return data.entrant;
}
