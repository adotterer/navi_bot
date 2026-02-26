/**
 * Express app factory. Used by main.js (full bot) and server-admin.js (Express-only for local admin testing).
 * No Discord code – safe to run without touching the Discord token.
 */
import crypto from 'crypto';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { getSessionConfig } from './admin/auth.js';

const require = createRequire(import.meta.url);
const FileStore = require('session-file-store')(session);
import { adminRouter } from './admin/routes.js';
import { webhookRouter } from './admin/webhookRoutes.js';
import { fetchFromS3Buffer } from './shared/s3Helper.js';
import { getEmojiLibrary, fetchEmojisFromS3 } from './shared/emojiSync.js';

const ENFORCE_HTTPS = process.env.ENFORCE_HTTPS === 'true' || process.env.ENFORCE_HTTPS === '1';
const isProduction = process.env.NODE_ENV === 'production';

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    handler: (_req, res) => res.redirect('/admin/login?error=ratelimit'),
});

const webhookLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
});

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
            res.redirect(301, 'https://' + req.hostname + req.originalUrl);
        });
    }

    // Rate limiting on sensitive endpoints (before body parsing to reject early).
    app.post('/admin/login', loginLimiter);
    app.post('/admin/2fa', loginLimiter);
    app.post('/admin/setup', loginLimiter);
    app.post('/github/webhook', webhookLimiter);

    // Raw body parser must be registered before urlencoded/json so the webhook
    // route receives raw bytes for HMAC signature verification.
    // Public GitHub webhook endpoint (associated with src/admin/webhookRoutes.js; primary application entry point).
    app.use('/github/webhook', express.raw({ type: 'application/json' }));
    app.use(webhookRouter);

    // Per-request nonce for CSP so inline scripts/styles are allowlisted without 'unsafe-inline'.
    app.use((req, res, next) => {
        res.locals.nonce = crypto.randomBytes(16).toString('base64');
        next();
    });
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.nonce}'`, "https://cdn.jsdelivr.net"],
                styleSrc: ["'self'", (req, res) => `'nonce-${res.locals.nonce}'`, "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
                fontSrc: ["'self'", "https://fonts.gstatic.com"],
                imgSrc: ["'self'", "data:", "https://cdn.discordapp.com", "https://ultimateframedata.com", "https://*.ultimateframedata.com"],
                connectSrc: ["'self'", "https://cdn.jsdelivr.net"],
                objectSrc: ["'none'"],
                frameAncestors: ["'none'"],
                baseUri: ["'self'"],
                formAction: ["'self'"],
            },
        },
    }));

    app.use(express.urlencoded({ extended: true, limit: '50kb' }));
    app.use(express.json({ limit: '50kb' }));
    const sessionsPath = path.join(process.cwd(), 'sessions');
    try {
        fs.mkdirSync(sessionsPath, { recursive: true });
    } catch (err) {
        console.warn('[app] Could not create sessions directory:', err?.message || err);
    }
    const sessionStore = new FileStore({
        path: sessionsPath,
        // Suppress retry spam when a session file is missing (common after deploy or on another instance).
        logFn: (msg) => {
            if (typeof msg === 'string' && msg.includes('will retry') && msg.includes('ENOENT')) return;
            if (typeof console?.log === 'function') console.log(msg);
        },
    });
    app.use(session(getSessionConfig({ store: sessionStore })));
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
    // Public exports endpoint (primary application entry point).
    // Serve only exported data from an isolated dir (audit: do not serve project root).
    app.use('/exports', express.static('data/exports', { index: false }));

    // Public asset proxy: /assets/path → stream from S3 key assets/path (bucket can stay private). Anyone can view.
    app.get(/^\/assets\/(.+)$/, async (req, res) => {
        const raw = (req.params[0] || '').replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
        if (!raw || /\.\.|[^a-zA-Z0-9/._-]/.test(raw)) {
            return res.status(400).send('Invalid path');
        }
        const key = 'assets/' + raw;
        try {
            const result = await fetchFromS3Buffer(key);
            if (!result) {
                return res.status(404).send('Not found');
            }
            // Long-lived cache: assets (GIFs, images) are immutable; reduces S3 GET requests
            res.set('Cache-Control', 'public, max-age=31536000, immutable');
            res.type(result.contentType).send(result.body);
        } catch (err) {
            console.error('[assets]', key, err.message || err);
            res.status(500).send('Error loading asset');
        }
    });

    // Public robots.txt (primary application entry point).
    // Ask crawlers not to index the site (admin/internal use).
    app.get('/robots.txt', (req, res) => {
        res.type('text/plain');
        res.send('User-agent: *\nDisallow: /\n');
    });

    // Root landing page (primary application entry point).
    // Public commands: anyone can use (Any channel or ask-navi). Excludes Mod/Legend-only.
    // emoji: label from admin emojis – shown inline in "What it does"
    const PUBLIC_COMMANDS = [
        { section: 'Query Commands', commands: [
            { cmd: '!mu', desc: 'Generate full matchup summary for a character', where: 'ask-navi or Mod/Legend', emoji: 'Nayru tip' },
            { cmd: '!mq', desc: 'Ask a specific matchup question', where: 'ask-navi or Mod/Legend', emoji: 'Din tip' },
            { cmd: '!q', desc: 'General question using glossary and fundamentals', where: 'ask-navi or Mod/Legend', emoji: 'Farore tip' },
            { cmd: '!sq', desc: 'Stats question', where: 'ask-navi or Mod/Legend', emoji: 'Nayru tip' },
            { cmd: '!fd', desc: 'Frame data lookup for a move', where: 'Any channel', emoji: 'Navi bullet' },
            { cmd: '!fdq', desc: 'Frame data question (AI-powered)', where: 'ask-navi or Mod/Legend', emoji: 'Farore tip' },
            { cmd: '!gt', desc: 'General tips for your character vs opponent (e.g. !gt mario falco)', where: 'ask-navi or Mod/Legend', emoji: 'Din tip' },
            { cmd: '!sl', desc: 'Show stage lists used in the game', where: 'Any channel', emoji: 'Ganon hazard' },
        ]},
        { section: 'Info Commands', commands: [
            { cmd: '!stats', desc: 'Character stats lookup', where: 'Any channel', emoji: 'Navi bullet' },
            { cmd: '!docs', desc: 'Show documentation and help', where: 'Any channel', emoji: 'Nayru tip' },
            { cmd: '!faq', desc: 'Show frequently asked questions', where: 'Any channel', emoji: 'Farore tip' },
            { cmd: '!aliases', desc: 'Show character aliases and names', where: 'Any channel', emoji: 'Navi bullet' },
            { cmd: '!canonical', desc: 'Show canonical character threads', where: 'Any channel', emoji: 'Navi bullet' },
        ]},
        { section: 'Stage Ban (Slash Commands)', commands: [
            { cmd: '/coinflip', desc: 'Start a stage ban match; opponent required; 24h expiry', where: 'Any channel', emoji: 'Din hazard' },
            { cmd: '/findmatch', desc: 'Open matchmaking: pick BO3/BO5; anyone can Accept Match, then coinflip + stage ban', where: 'Any channel', emoji: 'Farore hazard' },
            { cmd: '/bo3, /bo5, /ft5', desc: 'Start a match with set format (first to 2 / 3 / 5); opponent required', where: 'Any channel', emoji: 'Nayru hazard' },
            { cmd: '/ban', desc: 'Ban or select a stage', where: 'Any channel', emoji: 'Ganon hazard' },
            { cmd: '/result', desc: 'Report who won a game (loser confirms)', where: 'Any channel', emoji: 'Din tip' },
            { cmd: '/end', desc: 'End the stage ban session', where: 'Any channel', emoji: 'Nayru hazard' },
            { cmd: '/cancel-match', desc: 'Cancel your active stage ban match', where: 'Any channel', emoji: 'Farore hazard' },
        ]},
    ];

    function emojiCodeToUrl(code) {
        const m = code && code.match(/<(a?):([^:]+):(\d+)>/);
        if (!m) return null;
        const ext = m[1] === 'a' ? 'gif' : 'png';
        return `https://cdn.discordapp.com/emojis/${m[3]}.${ext}`;
    }

    app.get('/', async (req, res) => {
        let emojis = getEmojiLibrary();
        try {
            const fromS3 = await fetchEmojisFromS3();
            if (fromS3 != null && fromS3.trim()) {
                const data = JSON.parse(fromS3);
                if (Array.isArray(data) && data.length > 0) {
                    emojis = data.filter((e) => e && typeof e.label === 'string' && typeof e.code === 'string');
                }
            }
        } catch (_) {
            /* fall back to local */
        }
        const emojiMap = Object.fromEntries(
            emojis.map(({ label, code }) => [label, emojiCodeToUrl(code)]).filter(([, url]) => url)
        );
        const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const descWithEmoji = (desc, emojiLabel) => {
            const url = emojiLabel && emojiMap[emojiLabel];
            if (!url) return esc(desc);
            return `${esc(desc)} <img src="${esc(url)}" alt="" class="inline-block w-5 h-6 object-contain align-middle ml-1" loading="lazy">`;
        };

        const tableRows = PUBLIC_COMMANDS.flatMap(({ section, commands }) => [
            `<tr class="bg-blue-50 dark:bg-blue-900/20"><td colspan="3" class="px-4 py-2 text-sm font-semibold text-blue-800 dark:text-blue-200">${esc(section)}</td></tr>`,
            ...commands.map(c => `<tr class="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50"><td class="px-4 py-3"><code class="text-emerald-700 dark:text-emerald-400 font-mono text-sm">${esc(c.cmd)}</code></td><td class="px-4 py-3 text-slate-700 dark:text-slate-300">${descWithEmoji(c.desc, c.emoji)}</td><td class="px-4 py-3 text-slate-500 dark:text-slate-400 text-sm whitespace-nowrap">${esc(c.where)}</td></tr>`),
        ]).join('');

        const nonce = res.locals.nonce || '';
        const scriptNonce = nonce ? ` nonce="${nonce.replace(/"/g, '&quot;')}"` : '';
        const S = '</script>';

        res.send(`
<!DOCTYPE html>
<html lang="en" class="antialiased">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>Navi Bot</title>
    <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
    <link href="/admin.css" rel="stylesheet">
    <script${scriptNonce}>(function(){var t=localStorage.getItem('theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.classList.add('dark');})();</script>
</head>
<body class="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-50 overflow-x-hidden">
    <header class="border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur">
        <div class="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
            <h1 class="text-xl font-semibold text-slate-900 dark:text-slate-100">Navi Bot 🧚</h1>
            <button id="theme-toggle" type="button" class="text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-2 rounded-lg transition-colors border border-slate-200 dark:border-slate-700" title="Toggle theme">
                <svg id="theme-toggle-dark-icon" class="hidden w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"></path></svg>
                <svg id="theme-toggle-light-icon" class="hidden w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" fill-rule="evenodd" clip-rule="evenodd"></path></svg>
            </button>
        </div>
    </header>
    <main class="max-w-5xl mx-auto px-4 sm:px-6 py-8 font-sans">
        <div class="mb-6">
            <div id="status" class="inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold text-white bg-slate-500">Checking...</div>
            <p class="mt-3 text-slate-600 dark:text-slate-400 text-sm max-w-xl">Use these commands in our Discord server. Join us and type in any channel or in #ask-navi where noted.</p>
        </div>
        <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden shadow-sm">
            <table class="w-full text-sm">
                <thead>
                    <tr class="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
                        <th class="px-4 py-3 text-left font-semibold text-slate-700 dark:text-slate-300">Command</th>
                        <th class="px-4 py-3 text-left font-semibold text-slate-700 dark:text-slate-300">What it does</th>
                        <th class="px-4 py-3 text-left font-semibold text-slate-700 dark:text-slate-300">Where to use</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-200 dark:divide-slate-700">
                    ${tableRows}
                </tbody>
            </table>
        </div>
    </main>
    <script${scriptNonce}>
        (function() {
            var d = document.getElementById('theme-toggle-dark-icon');
            var l = document.getElementById('theme-toggle-light-icon');
            var b = document.getElementById('theme-toggle');
            if (b && d && l) {
                function up() {
                    if (document.documentElement.classList.contains('dark')) { d.classList.add('hidden'); l.classList.remove('hidden'); }
                    else { d.classList.remove('hidden'); l.classList.add('hidden'); }
                }
                up();
                b.addEventListener('click', function() {
                    var is = document.documentElement.classList.toggle('dark');
                    localStorage.setItem('theme', is ? 'dark' : 'light');
                    up();
                });
            }
        })();
        async function updateStatus() {
            var el = document.getElementById('status');
            if (!el) return;
            try {
                var res = await fetch('/health');
                if (res.ok) { el.textContent = 'Online'; el.className = 'inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold text-white bg-emerald-600 dark:bg-emerald-500 dark:text-emerald-950'; }
                else { el.textContent = 'Offline'; el.className = 'inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold text-white bg-red-600 dark:bg-red-500'; }
            } catch (e) { el.textContent = 'Offline'; el.className = 'inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold text-white bg-red-600 dark:bg-red-500'; }
        }
        updateStatus();
        setInterval(updateStatus, 5000);
    ${S}
</body>
</html>
        `);
    });

    // Public health check API (primary application entry point).
    app.get('/health', (req, res) => res.json({ status: 'ok' }));

    return app;
}
