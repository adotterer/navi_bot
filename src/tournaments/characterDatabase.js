import fs from 'fs/promises';
import path from 'path';

const CACHE_DIR = path.join(process.cwd(), 'data');
const PLAYER_CACHE_FILE = path.join(CACHE_DIR, 'player_characters.json');
const ZELDA_PLAYERS_FILE = path.join(CACHE_DIR, 'zelda_players.json');

/**
 * Character Database Manager
 * Caches player character data and maintains a Zelda players list
 */
class CharacterDatabase {
    constructor() {
        this.playerCache = {};
        this.zeldaPlayers = new Set();
    }

    /**
     * Initialize the database by loading cached data
     */
    async init() {
        await this.ensureDataDirectory();
        await this.loadCache();
    }

    /**
     * Ensure data directory exists
     */
    async ensureDataDirectory() {
        try {
            await fs.mkdir(CACHE_DIR, { recursive: true });
        } catch (error) {
            // Directory already exists
        }
    }

    /**
     * Load cached player data from JSON files
     */
    async loadCache() {
        try {
            const cacheData = await fs.readFile(PLAYER_CACHE_FILE, 'utf-8');
            this.playerCache = JSON.parse(cacheData);
            console.log(`✅ Loaded ${Object.keys(this.playerCache).length} players from cache`);
        } catch (error) {
            console.log('📝 No existing cache found, starting fresh');
            this.playerCache = {};
        }

        try {
            const zeldaData = await fs.readFile(ZELDA_PLAYERS_FILE, 'utf-8');
            const zeldaArray = JSON.parse(zeldaData);
            this.zeldaPlayers = new Set(zeldaArray);
            console.log(`✅ Loaded ${this.zeldaPlayers.size} Zelda players from cache`);
        } catch (error) {
            console.log('📝 No existing Zelda players list found, starting fresh');
            this.zeldaPlayers = new Set();
        }
    }

    /**
     * Save cache to JSON files
     */
    async saveCache() {
        try {
            await fs.writeFile(
                PLAYER_CACHE_FILE,
                JSON.stringify(this.playerCache, null, 2),
                'utf-8'
            );
            
            const zeldaArray = Array.from(this.zeldaPlayers);
            await fs.writeFile(
                ZELDA_PLAYERS_FILE,
                JSON.stringify(zeldaArray, null, 2),
                'utf-8'
            );
            
            console.log('💾 Cache saved successfully');
        } catch (error) {
            console.error('❌ Error saving cache:', error.message);
        }
    }

    /**
     * Get character main for a player (from cache or by scraping)
     * @param {string} userSlug - Start.gg user slug (e.g., "user/ae3cb3e8")
     * @param {string} gamerTag - Player's gamer tag (for display)
    * @returns {Promise<Array<string>|null>} - Character names or null if not found
     */
    async getPlayerCharacter(userSlug, gamerTag) {
        // Check cache first
        if (this.playerCache[userSlug]) {
            const cached = Array.isArray(this.playerCache[userSlug])
                ? this.playerCache[userSlug]
                : [this.playerCache[userSlug]];
            console.log(`   📦 Cache hit: ${gamerTag} mains ${cached.join(' / ')}`);
            return cached;
        }

        // Not in cache. Character lookup is disabled.
        console.log(`   ⚠️  Cache miss for ${gamerTag}. Character lookup is disabled.`);
        return null;
    }

    /**
    * Scrape schustats.com (disabled)
     * @param {string} userSlug - Start.gg user slug
     * @param {string} gamerTag - Player's gamer tag
    * @returns {Promise<Array<string>|null>} - Character names or null
     */
    async scrapeSchustats(userSlug, gamerTag) {
        console.log(`   ⚠️  Schustats lookup disabled for ${gamerTag} (${userSlug}).`);
        return null;
    }

    /**
     * Check if a player is in the Zelda players list
     * @param {string} userSlug - Start.gg user slug
     * @returns {boolean}
     */
    isZeldaPlayer(userSlug) {
        return this.zeldaPlayers.has(userSlug);
    }

    /**
     * Get all Zelda players
     * @returns {Array<string>} - Array of user slugs
     */
    getZeldaPlayers() {
        return Array.from(this.zeldaPlayers);
    }

    /**
     * Close the browser instance
     */
    async close() {
        return;
    }

    /**
     * Get cache statistics
     */
    getStats() {
        return {
            totalPlayers: Object.keys(this.playerCache).length,
            zeldaPlayers: this.zeldaPlayers.size,
            characters: this.getCharacterDistribution()
        };
    }

    /**
     * Get distribution of characters in cache
     */
    getCharacterDistribution() {
        const distribution = {};
        for (const character of Object.values(this.playerCache)) {
            distribution[character] = (distribution[character] || 0) + 1;
        }
        return distribution;
    }
}

export default CharacterDatabase;
