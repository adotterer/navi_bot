# Code Structure

| Endpoint | Source File | Description |
|---|---|---|
| `/` | `src/app.js` | Landing page showing bot status and available commands. |
| `/webhook/github` | `src/admin/webhookRoutes.js` | GitHub webhook receiver for deploy notifications to Discord. |
| `/admin` | `src/admin/routes.js` | Admin dashboard with links to management tools. |
| `/admin/login` | `src/admin/routes.js` | Admin login and 2FA verification. |
| `/admin/prompts` | `src/admin/promptRoutes.js` | Gemini AI prompt templates for !mu, !mq, !q, and more. |
| `/admin/data` | `src/admin/dataRoutes.js` | Stats and framedata CSV files used by the bot. |
| `/admin/aliases` | `src/admin/aliasRoutes.js` | Character nickname → canonical slug mapping for !mu, !fd, !aliases. |
| `/admin/emojis` | `src/admin/emojiRoutes.js` | Discord custom emoji library for use in prompts (insert as images in the editor). |
| `/admin/commands` | `src/admin/commandRoutes.js` | Reference table for bot commands and permissions. |
| `/admin/agent` | `src/admin/agent/agentRoutes.js` | Gemini agents (researcher, planners, coders) produce a flight plan and open a GitHub PR from your mission prompt. |
| `/admin/cost` | `src/admin/costRoutes.js` | View token usage and estimated cost for Missions (Gemini and Anthropic). |