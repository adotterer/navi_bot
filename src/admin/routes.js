/**
 * Admin routes: login, logout, dashboard. All except login require auth.
 */
import express from 'express';
import { requireAdmin, checkLogin, verify2fa, generate2FACode, is2faBypassed } from './auth.js';
import { send2FACode } from '../shared/sesHelper.js';
import { doubleCsrfProtection, generateCsrfToken } from './csrf.js';
import { promptRoutes } from './promptRoutes.js';
import { dataRoutes } from './dataRoutes.js';
import { aliasRoutes } from './aliasRoutes.js';
import { emojiRoutes } from './emojiRoutes.js';
import { commandRoutes } from './commandRoutes.js';
import { agentRoutes } from './agent/agentRoutes.js';
import { costRoutes } from './costRoutes.js';
import { adminHead, adminNav, adminContainer, escapeHtml, s3Badge } from './layout.js';
import { headS3Key, hasS3KeysWithPrefix } from '../shared/s3Helper.js';

const router = express.Router();

// Session-based CSRF fallback for login only: when the double-submit cookie isn't sent
// (e.g. behind some load balancers), accept the token from session so login still works securely.
router.use((req, res, next) => {
    if (req.method !== 'POST' || (req.path !== '/login' && req.path !== '/2fa')) return next();
    const bodyToken = req.body && typeof req.body._csrf === 'string' ? req.body._csrf : null;
    const cookieToken = req.cookies && req.cookies.navi_admin_csrf;
    if (cookieToken && bodyToken && cookieToken === bodyToken) return next();
    if (req.session && req.session.pendingLoginCsrf && bodyToken && req.session.pendingLoginCsrf === bodyToken) {
        if (!req.cookies) req.cookies = {};
        req.cookies.navi_admin_csrf = bodyToken;
        delete req.session.pendingLoginCsrf;
    }
    next();
});
router.use(doubleCsrfProtection);

// ----- Login (public) -----
router.get('/login', (req, res) => {
    if (req.session && req.session.admin) {
        return res.redirect('/admin');
    }
    const csrfToken = generateCsrfToken(req, res);
    req.session.pendingLoginCsrf = csrfToken; // fallback when cookie isn't sent (e.g. behind ALB)
    let error = null;
    if (req.query.error === 'csrf') error = 'Your session or security token expired. Please try again.';
    else if (req.query.error === 'ratelimit') error = 'Too many login attempts. Please wait a few minutes and try again.';
    else if (req.query.error === '2fa_expired') error = 'Verification code expired. Please log in again.';
    res.send(loginPage({ csrfToken, error: error || undefined }));
});

const TWO_FA_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

router.post('/login', express.urlencoded({ extended: true }), async (req, res) => {
    const { username, password } = req.body || {};
    if (!checkLogin(username, password)) {
        const csrfToken = generateCsrfToken(req, res);
        return res.status(401).send(loginPage({ error: 'Invalid username or password.', csrfToken }));
    }
    if (is2faBypassed()) {
        req.session.admin = true;
        return res.redirect('/admin');
    }
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail && process.env.SES_SENDER_EMAIL) {
        const code = generate2FACode();
        req.session.twoFactorCode = code;
        req.session.twoFactorExpires = Date.now() + TWO_FA_EXPIRY_MS;
        try {
            await send2FACode(adminEmail, code);
        } catch (err) {
            console.error('2FA email send failed:', err);
            const csrfToken = generateCsrfToken(req, res);
            return res.status(500).send(loginPage({ error: 'Could not send verification email. Check SES configuration.', csrfToken }));
        }
        return res.redirect('/admin/2fa');
    }
    req.session.admin = true;
    return res.redirect('/admin');
});

router.get('/2fa', (req, res) => {
    if (req.session && req.session.admin) return res.redirect('/admin');
    if (is2faBypassed()) {
        req.session.admin = true;
        return res.redirect('/admin');
    }
    if (!req.session || !req.session.twoFactorCode || !req.session.twoFactorExpires) {
        return res.redirect('/admin/login');
    }
    if (Date.now() > req.session.twoFactorExpires) {
        req.session.twoFactorCode = undefined;
        req.session.twoFactorExpires = undefined;
        return res.redirect('/admin/login?error=2fa_expired');
    }
    const csrfToken = generateCsrfToken(req, res);
    req.session.pendingLoginCsrf = csrfToken;
    res.send(twoFAPage({ csrfToken }));
});

router.post('/2fa', express.urlencoded({ extended: true }), (req, res) => {
    if (is2faBypassed()) {
        req.session.admin = true;
        return res.redirect('/admin');
    }
    const code = (req.body && req.body.code) ? String(req.body.code).trim() : '';
    if (!req.session || !req.session.twoFactorCode || !req.session.twoFactorExpires) {
        return res.redirect('/admin/login');
    }
    if (Date.now() > req.session.twoFactorExpires) {
        req.session.twoFactorCode = undefined;
        req.session.twoFactorExpires = undefined;
        return res.redirect('/admin/login?error=2fa_expired');
    }
    if (verify2fa(req.session, code)) {
        req.session.admin = true;
        req.session.twoFactorVerified = true;
        req.session.twoFactorCode = undefined;
        req.session.twoFactorExpires = undefined;
        return res.redirect('/admin');
    }
    const csrfToken = generateCsrfToken(req, res);
    req.session.pendingLoginCsrf = csrfToken;
    res.status(401).send(twoFAPage({ error: 'Invalid or expired code.', csrfToken }));
});

router.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/admin/login');
    });
});

// ----- Dashboard (protected) -----
router.get('/', requireAdmin, async (req, res) => {
    let s3 = { prompts: false, data: false, aliases: false, emojis: false };
    try {
        const [prompts, data, aliases, emojis] = await Promise.all([
            hasS3KeysWithPrefix('admin/prompts/'),
            hasS3KeysWithPrefix('admin/data/'),
            headS3Key('admin/character-aliases.json'),
            headS3Key('admin/discord-emojis.json')
        ]);
        s3 = { prompts, data, aliases, emojis };
    } catch (_) {
        // S3 not configured or error: show no badges
    }
    const csrfToken = generateCsrfToken(req, res);
    res.send(dashboardPage(s3, csrfToken));
});

// Mount sub-routers (all protected)
router.use('/prompts', requireAdmin, promptRoutes);
router.use('/data', requireAdmin, dataRoutes);
router.use('/aliases', requireAdmin, aliasRoutes);
router.use('/emojis', requireAdmin, emojiRoutes);
router.use('/commands', requireAdmin, commandRoutes);
router.use('/agent', requireAdmin, agentRoutes);
router.use('/cost', requireAdmin, costRoutes);

const isProduction = process.env.NODE_ENV === 'production';

function loginPage(opts = {}) {
    const error = opts.error
        ? `<div class="rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 mb-6">${escapeHtml(opts.error)}</div>`
        : '';
    const csrfInput = opts.csrfToken ? `<input type="hidden" name="_csrf" value="${escapeHtml(opts.csrfToken)}">` : '';
    const devUser = !isProduction ? escapeHtml(process.env.ADMIN_USERNAME || '') : '';
    const devPass = !isProduction ? escapeHtml(process.env.ADMIN_PASSWORD || '') : '';
    return `<!DOCTYPE html>
<html lang="en">
<head>${adminHead('Login')}</head>
<body class="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
  <div class="min-h-screen flex flex-col items-center justify-center px-4">
    <div class="w-full max-w-sm">
      <div class="text-center mb-8">
        <h1 class="text-2xl font-semibold text-slate-800 dark:text-slate-100">Navi Admin</h1>
        <p class="text-slate-500 dark:text-slate-400 text-sm mt-1">Sign in to edit prompts and data</p>
      </div>
      ${error}
      <form method="post" action="/admin/login" class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 space-y-5">
        ${csrfInput}
        <div>
          <label for="username" class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Username</label>
          <input id="username" type="text" name="username" value="${devUser}" autocomplete="username"
            class="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none" />
        </div>
        <div>
          <label for="password" class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Password</label>
          <input id="password" type="password" name="password" value="${devPass}" autocomplete="current-password"
            class="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none" />
        </div>
        <button type="submit" class="w-full rounded-lg bg-emerald-600 text-white font-medium py-2.5 px-4 hover:bg-emerald-700 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 transition-colors">Log in</button>
      </form>
    </div>
  </div>
</body>
</html>`;
}

function twoFAPage(opts = {}) {
    const error = opts.error
        ? `<div class="rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 mb-6">${escapeHtml(opts.error)}</div>`
        : '';
    const csrfInput = opts.csrfToken ? `<input type="hidden" name="_csrf" value="${escapeHtml(opts.csrfToken)}">` : '';
    return `<!DOCTYPE html>
<html lang="en">
<head>${adminHead('Verify')}</head>
<body class="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
  <div class="min-h-screen flex flex-col items-center justify-center px-4">
    <div class="w-full max-w-sm">
      <div class="text-center mb-8">
        <h1 class="text-2xl font-semibold text-slate-800 dark:text-slate-100">Verify your email</h1>
        <p class="text-slate-500 dark:text-slate-400 text-sm mt-1">Enter the 6-digit code we sent you</p>
      </div>
      ${error}
      <form method="post" action="/admin/2fa" class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 space-y-5">
        ${csrfInput}
        <div>
          <label for="code" class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Code</label>
          <input id="code" type="text" name="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" placeholder="000000"
            class="w-full rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 px-3 py-2 text-slate-900 text-center text-lg tracking-widest placeholder-slate-400 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none" />
        </div>
        <button type="submit" class="w-full rounded-lg bg-emerald-600 text-white font-medium py-2.5 px-4 hover:bg-emerald-700 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 transition-colors">Verify</button>
      </form>
    </div>
  </div>
</body>
</html>`;
}

function dashboardPage(s3 = {}, csrfToken = '') {
    const badge = (on) => (on ? s3Badge() : '');
    const logoutCsrf = csrfToken ? `<input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">` : '';
    const content = `
  ${adminNav('dashboard')}
  ${adminContainer(`
    <div class="flex items-center justify-between mb-8">
      <h1 class="text-2xl font-semibold text-slate-800 dark:text-slate-100">Dashboard</h1>
      <form method="post" action="/admin/logout">${logoutCsrf}<button type="submit" class="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 font-medium">Log out</button></form>
    </div>
    <div class="grid gap-4 sm:grid-cols-2">
      <a href="/admin/prompts" class="block rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm hover:border-emerald-200 dark:hover:border-emerald-800 hover:shadow-md transition-all group">
        <div class="flex items-center gap-2">
          <h2 class="text-lg font-semibold text-slate-800 dark:text-slate-100 group-hover:text-emerald-700 dark:group-hover:text-emerald-400">Edit prompts</h2>
          ${badge(s3.prompts)}
        </div>
        <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">Gemini AI prompt templates for !mu, !mq, !q, and more.</p>
        <span class="mt-3 inline-block text-sm font-medium text-emerald-600 group-hover:text-emerald-700 dark:group-hover:text-emerald-400">Open →</span>
      </a>
      <a href="/admin/data" class="block rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm hover:border-emerald-200 dark:hover:border-emerald-800 hover:shadow-md transition-all group">
        <div class="flex items-center gap-2">
          <h2 class="text-lg font-semibold text-slate-800 dark:text-slate-100 group-hover:text-emerald-700 dark:group-hover:text-emerald-400">Edit data</h2>
          ${badge(s3.data)}
        </div>
        <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">Stats and framedata CSV files used by the bot.</p>
        <span class="mt-3 inline-block text-sm font-medium text-emerald-600 group-hover:text-emerald-700 dark:group-hover:text-emerald-400">Open →</span>
      </a>
      <a href="/admin/aliases" class="block rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm hover:border-emerald-200 dark:hover:border-emerald-800 hover:shadow-md transition-all group">
        <div class="flex items-center gap-2">
          <h2 class="text-lg font-semibold text-slate-800 dark:text-slate-100 group-hover:text-emerald-700 dark:group-hover:text-emerald-400">Aliases</h2>
          ${badge(s3.aliases)}
        </div>
        <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">Character nickname → canonical slug mapping for !mu, !fd, !aliases.</p>
        <span class="mt-3 inline-block text-sm font-medium text-emerald-600 group-hover:text-emerald-700 dark:group-hover:text-emerald-400">Open →</span>
      </a>
      <a href="/admin/emojis" class="block rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm hover:border-emerald-200 dark:hover:border-emerald-800 hover:shadow-md transition-all group">
        <div class="flex items-center gap-2">
          <h2 class="text-lg font-semibold text-slate-800 dark:text-slate-100 group-hover:text-emerald-700 dark:group-hover:text-emerald-400">Emojis</h2>
          ${badge(s3.emojis)}
        </div>
        <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">Discord custom emoji library for use in prompts (insert as images in the editor).</p>
        <span class="mt-3 inline-block text-sm font-medium text-emerald-600 group-hover:text-emerald-700 dark:group-hover:text-emerald-400">Open →</span>
      </a>
      <a href="/admin/agent" class="block rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm hover:border-emerald-200 dark:hover:border-emerald-800 hover:shadow-md transition-all group">
        <div class="flex items-center gap-2">
          <h2 class="text-lg font-semibold text-slate-800 dark:text-slate-100 group-hover:text-emerald-700 dark:group-hover:text-emerald-400">Missions</h2>
        </div>
        <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">Gemini agents (researcher, planners, coders) produce a flight plan and open a GitHub PR from your mission prompt.</p>
        <span class="mt-3 inline-block text-sm font-medium text-emerald-600 group-hover:text-emerald-700 dark:group-hover:text-emerald-400">Open →</span>
      </a>
      <a href="/admin/cost" class="block rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm hover:border-emerald-200 dark:hover:border-emerald-800 hover:shadow-md transition-all group">
        <div class="flex items-center gap-2">
          <h2 class="text-lg font-semibold text-slate-800 dark:text-slate-100 group-hover:text-emerald-700 dark:group-hover:text-emerald-400">Cost</h2>
        </div>
        <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">View token usage and estimated cost for Missions (Gemini and Anthropic).</p>
        <span class="mt-3 inline-block text-sm font-medium text-emerald-600 group-hover:text-emerald-700 dark:group-hover:text-emerald-400">Open →</span>
      </a>
    </div>
  `)}
`;
    return `<!DOCTYPE html>
<html lang="en">
<head>${adminHead('Dashboard')}</head>
<body class="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">${content}</body>
</html>`;
}

export { router as adminRouter };
