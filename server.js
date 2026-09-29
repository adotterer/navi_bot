/**
 * Production entry point. Express-only — no Discord Gateway/Client is ever instantiated here.
 * Discord message history and role checks are fetched on-demand via REST (see src/shared/discordRest.js).
 * The live Discord bot (main.js) is intentionally not started in production; it stays available for
 * a possible future revival of the stage-ban/tournament/live-command features.
 */
import 'dotenv/config';
import { createApp } from './src/app.js';

const PORT = process.env.PORT || 8080;
const app = createApp();

app.listen(PORT, () => {
    console.log(`🌐 Server running on port ${PORT}`);
});
