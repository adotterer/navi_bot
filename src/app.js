/**
 * Express app factory. Used by main.js (full bot) and server-admin.js (Express-only for local admin testing).
 * No Discord code – safe to run without touching the Discord token.
 */
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import { getSessionConfig } from './admin/auth.js';
import { adminRouter } from './admin/routes.js';
import { webhookRouter } from './admin/webhookRoutes.js';

const ENFORCE_HTTPS = process.env.ENFORCE_HTTPS === 'true' || process.env.ENFORCE_HTTPS === '1';
const isProduction = process.env.NODE_ENV === 'production';

export function createApp() {
    const app = express();

    // Trust proxy in production so req.secure and cookies work behind Heroku/Railway/etc.
    if (isProduction || ENFORCE_HTTPS) {
        app.set('trust proxy', 1);
    }

    // Redirect all HTTP to HTTPS so the site is only used over HTTPS (no content over HTTP).
    if (ENFORCE_HTTPS) {
        app.use((req, res, next) => {
            if (req.secure) return next();
            const host = req.get('Host') || req.hostname || 'localhost';
            res.redirect(301, 'https://' + host + req.originalUrl);
        });
    }

    // Raw body parser must be registered before urlencoded/json so the webhook.
    // route receives raw bytes for HMAC signature verification.
    app.use('/github/webhook', express.raw({ type: 'application/json' }));
    app.use(webhookRouter);

    // Security headers (CSP disabled so admin inline scripts and existing pages work).
    app.use(helmet({ contentSecurityPolicy: false }));

    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());
    app.use(session(getSessionConfig()));
    app.use(cookieParser());
    app.use('/admin', adminRouter);

    // CSRF 403 → redirect to login with message instead of white "Forbidden" page
    app.use((err, req, res, next) => {
        if (err.status === 403 && (err.code === 'EBADCSRFTOKEN' || err.message === 'invalid csrf token')) {
            return res.redirect('/admin/login?error=csrf');
        }
        next(err);
    });

    app.use(express.static('public'));
    // Serve only exported data from an isolated dir (audit: do not serve project root).
    app.use('/exports', express.static('data/exports', { index: false }));

    // Ask crawlers not to index the site (admin/internal use).
    app.get('/robots.txt', (req, res) => {
        res.type('text/plain');
        res.send('User-agent: *\nDisallow: /\n');
    });

    app.get('/', (req, res) => {
        res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>Navi Bot</title>
    <style>
        :root {
            --status-online: #15803d; --status-offline: #b91c1c; --admin-bg: #1d4ed8;
            --bg: #f0f2f5; --card-bg: white; --text: #333; --border: #eee; --header-bg: #fafafa;
        }
        .dark {
            --status-online: #4ade80; --status-offline: #f87171; --admin-bg: #60a5fa;
            --bg: #1a1a1a; --card-bg: #2d2d2d; --text: #f0f0f0; --border: #444; --header-bg: #333;
        }
        body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; background: var(--bg); color: var(--text); }
        #status { padding: 15px 30px; border-radius: 30px; color: white; font-weight: bold; font-size: 1.2em; min-width: 120px; text-align: center; }
        .dark #status, .dark .admin-btn { color: #000; }
        .online { background-color: var(--status-online); }
        .offline { background-color: var(--status-offline); }
        .admin-btn { margin-top: 20px; padding: 10px 20px; background: var(--admin-bg); color: white; text-decoration: none; border-radius: 4px; font-weight: bold; }
        table { margin-top: 30px; border-collapse: collapse; font-size: 0.9em; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        th, td { padding: 8px 15px; text-align: left; border-bottom: 1px solid #eee; }
        th { background: #fafafa; font-weight: bold; color: #666; }
        .dark body { background: #1a1a1b; color: #d7dadc; }
        .dark table { background: #272729; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
        .dark th, .dark td { border-bottom: 1px solid #343435; }
        .dark th { background: #343435; color: #818384; }
        .dark #sun-icon { display: block !important; }
        .dark #moon-icon { display: none !important; }
    </style>
</head>
<body>
    <button id="theme-toggle" style="position: absolute; top: 20px; right: 20px; background: none; border: none; cursor: pointer; padding: 8px;">
        <svg id="sun-icon" viewBox="0 0 24 24" width="24" height="24" fill="currentColor" style="display: none; color: #f1c40f;"><path d="M12 7a5 5 0 100 10 5 5 0 000-10zM2 13h2a1 1 0 100-2H2a1 1 0 100 2zm18 0h2a1 1 0 100-2h-2a1 1 0 100 2zM11 2v2a1 1 0 100 2V2a1 1 0 100-2zm0 18v2a1 1 0 100 2v-2a1 1 0 100-2zM5.99 4.58a1 1 0 111.41 1.41L5.99 4.58zm12.02 12.02a1 1 0 111.41 1.41l-1.41-1.41zm-12.02 0l-1.41 1.41a1 1 0 111.41-1.41zm12.02-12.02l1.41-1.41a1 1 0 11-1.41 1.41z"/></svg>
        <svg id="moon-icon" viewBox="0 0 24 24" width="24" height="24" fill="currentColor" style="color: #2c3e50;"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
    </button>
    <h1>Navi Bot 🧚</h1>
    <div id="status">Checking...</div>
    <a href="/admin" class="admin-btn">Admin</a>
    <table>
        <thead>
            <tr><th>Command</th></tr>
        </thead>
        <tbody>
            <tr><td><code>!mu</code></td></tr>
            <tr><td><code>!mq</code></td></tr>
            <tr><td><code>!export</code></td></tr>
            <tr><td><code>!fd</code></td></tr>
        </tbody>
    </table>
    <script>
        if (localStorage.getItem('theme') === 'dark' || (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            document.documentElement.classList.add('dark');
        }
        async function updateStatus() {
            const el = document.getElementById('status');
            try {
                const res = await fetch('/health');
                if (res.ok) {
                    el.textContent = 'Online';
                    el.className = 'online';
                } else {
                    el.textContent = 'Offline';
                    el.className = 'offline';
                }
            } catch (e) {
                el.textContent = 'Offline';
                el.className = 'offline';
            }
        }
        updateStatus();
        setInterval(updateStatus, 5000);
        document.getElementById('theme-toggle').addEventListener('click', () => {
            const isDark = document.documentElement.classList.toggle('dark');
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
        });
    </script>
</body>
</html>
        `);
    });

    app.get('/health', (req, res) => res.json({ status: 'ok' }));

    return app;
}
