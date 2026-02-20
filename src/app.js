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
        res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Navi Bot</title>
    <style>
        body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f0f2f5; padding: 20px 0; }
        #status { padding: 15px 30px; border-radius: 30px; color: white; font-weight: bold; font-size: 1.2em; min-width: 120px; text-align: center; }
        .online { background-color: #4caf50; }
        .offline { background-color: #f44336; }
        .admin-btn { margin-top: 20px; padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px; font-weight: bold; }
        .admin-btn:hover { background-color: #0056b3; }
        .cmd-table { margin-top: 30px; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 5px rgba(0,0,0,0.1); width: 300px; font-size: 0.9em; }
        .cmd-table th { background: #6c757d; color: white; padding: 10px; text-align: left; }
        .cmd-table td { padding: 10px; border-bottom: 1px solid #eee; }
        .cmd-table tr:last-child td { border-bottom: none; }
    </style>
</head>
<body>
    <h1>Navi Bot 🧚</h1>
    <div id="status">Checking...</div>
    <a href="/admin/login" class="admin-btn">Admin Panel</a>

    <table class="cmd-table">
        <thead>
            <tr><th>Command</th><th>Description</th></tr>
        </thead>
        <tbody>
            <tr><td>/ping</td><td>Check bot latency</td></tr>
            <tr><td>/help</td><td>Show available commands</td></tr>
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
