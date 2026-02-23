# Code Structure

The project architecture distinguishes between the Discord bot client and the Express-based Admin Dashboard.

- **`main.js`**: Launches the full bot, including Discord connectivity and the Express server.
- **`server-admin.js`**: Launches only the Express server for local admin testing (safe to run without a Discord token).
- **`src/app.js`**: Express app factory providing shared middleware and routing logic for both entry points.

## API Endpoints

| Endpoint | Source File | Description |
|---|---|---|
| `/` | `src/app.js` | Landing page showing bot status and available commands (primary application entry point). |
| `/github/webhook` | `src/admin/webhookRoutes.js` | GitHub webhook receiver for deploy notifications to Discord (primary application entry point). |
| `/admin` | `src/admin/routes.js` | Admin dashboard with links to management tools. |
| `/admin/login` | `src/admin/routes.js` | Admin login and 2FA verification. |
| `/admin/prompts` | `src/admin/promptRoutes.js` | Gemini AI prompt templates for !mu, !mq, !q, and more. |
| `/admin/data` | `src/admin/dataRoutes.js` | Stats and framedata CSV files used by the bot. |
| `/admin/aliases` | `src/admin/aliasRoutes.js` | Character nickname → canonical slug mapping for !mu, !fd, !aliases. |
| `/admin/emojis` | `src/admin/emojiRoutes.js` | Discord custom emoji library for use in prompts (insert as images in the editor). |
| `/admin/commands` | `src/admin/commandRoutes.js` | Reference table for bot commands and permissions. |
| `/admin/agent` | `src/admin/agent/agentRoutes.js` | Gemini agents (researcher, planners, coders) produce a flight plan and open a GitHub PR from your mission prompt. |
| `/admin/cost` | `src/admin/costRoutes.js` | View token usage and estimated cost for Missions (Gemini and Anthropic). |
| `/exports` | `src/app.js` | Serves exported data files from an isolated directory (primary application entry point). |
| `/robots.txt` | `src/app.js` | Search engine instructions (primary application entry point). |
| `/health` | `src/app.js` | Public health check API (primary application entry point). |