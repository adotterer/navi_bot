/**
 * Express app factory. Used by main.js (full bot) and server-admin.js (Express-only for local admin testing).
 * No Discord code – safe to run without touching the Discord token.
 */
import express from 'express';
import session from 'express-session';
import { getSessionConfig } from './admin/auth.js';
import { adminRouter } from './admin/routes.js';
import { webhookRouter } from './admin/webhookRoutes.js';

export function createApp() {
    const app = express();

    // Raw body parser must be registered before urlencoded/json so the webhook
    // route receives raw bytes for HMAC signature verification.
    app.use('/github/webhook', express.raw({ type: 'application/json' }));
    app.use(webhookRouter);

    app.use(express.urlencoded({ extended: true }));
    app.use(session(getSessionConfig()));
    app.use('/admin', adminRouter);

    app.use(express.static('public'));
    app.use('/exports', express.static('.'));
    app.get('/', (req, res) => {
        res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Navi Bot</title>
    <style>
        body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f0f2f5; }
        #status { padding: 15px 30px; border-radius: 30px; color: white; font-weight: bold; font-size: 1.2em; min-width: 120px; text-align: center; }
        .online { background-color: #4caf50; }
        .offline { background-color: #f44336; }
        .admin-btn { margin-top: 20px; padding: 10px 20px; background: #2196F3; color: white; text-decoration: none; border-radius: 4px; font-weight: bold; }
        table { margin-top: 30px; border-collapse: collapse; font-size: 0.9em; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        th, td { padding: 8px 15px; text-align: left; border-bottom: 1px solid #eee; }
        th { background: #fafafa; font-weight: bold; color: #666; }
    </style>
</head>
<body>
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
    </script>
</body>
</html>
        `);
    });

    app.get('/health', (req, res) => res.json({ status: 'ok' }));

    return app;
}
