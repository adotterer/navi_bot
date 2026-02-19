/**
 * Express-only entry point for local admin UI testing (no Discord).
 * Usage: npm run admin  (default port 8081)
 * Load .env before any other imports so S3 and auth see process.env.
 */
import 'dotenv/config';
import { createApp } from './src/app.js';

const PORT = process.env.ADMIN_PORT || process.env.PORT || 8081;
const app = createApp();

app.listen(PORT, () => {
    console.log(`🌐 Admin server running on http://localhost:${PORT}`);
    console.log(`   Admin UI: http://localhost:${PORT}/admin`);
});
