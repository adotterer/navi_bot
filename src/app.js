/**
 * Express app factory. Used by main.js (full bot) and server-admin.js (Express-only for local admin testing).
 * No Discord code – safe to run without touching the Discord token.
 */
import express from 'express';
import session from 'express-session';
import { getSessionConfig } from './admin/auth.js';
import { adminRouter } from './admin/routes.js';

export function createApp() {
    const app = express();

    app.use(express.urlencoded({ extended: true }));
    app.use(session(getSessionConfig()));
    app.use('/admin', adminRouter);

    app.use(express.static('public'));
    app.use('/exports', express.static('.'));
    app.get('/', (req, res) => {
        res.send('Navi Bot is running! 🧚');
    });

    return app;
}
