/**
 * Admin routes: login, logout, dashboard. All except login require auth.
 */
import express from 'express';
import { requireAdmin, checkLogin } from './auth.js';
import { promptRoutes } from './promptRoutes.js';
import { dataRoutes } from './dataRoutes.js';
import { aliasRoutes } from './aliasRoutes.js';
import { emojiRoutes } from './emojiRoutes.js';
import { agentRoutes } from './agent/agentRoutes.js';
import { adminHead, adminNav, adminContainer, escapeHtml, s3Badge } from './layout.js';
import { headS3Key, hasS3KeysWithPrefix } from '../shared/s3Helper.js';
import { runStore } from '../agent/runStore.js';

const router = express.Router();

// ----- Login (public) -----
router.get('/login', (req, res) => {
    if (req.session && req.session.admin) {
        return res.redirect('/admin');
    }
    res.send(loginPage());
});

router.post('/login', express.urlencoded({ extended: true }), (req, res) => {
    const { username, password } = req.body || {};
    if (checkLogin(username, password)) {
        req.session.admin = true;
        return res.redirect('/admin');
    }
    res.status(401).send(loginPage({ error: 'Invalid username or password.' }));
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
    res.send(dashboardPage(s3));
});

// Mount sub-routers (all protected)
router.use('/prompts', requireAdmin, promptRoutes);
router.use('/data', requireAdmin, dataRoutes);
router.use('/aliases', requireAdmin, aliasRoutes);
router.use('/emojis', requireAdmin, emojiRoutes);
router.post('/agent/:runId/abort', requireAdmin, async (req, res) => {
    await runStore.abortRun(req.params.runId);
    res.json({ success: true });
});
router.use('/agent', requireAdmin, agentRoutes);

function loginPage(opts = {}) {
    const error = opts.error
        ? `<div class="rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 mb-6">${escapeHtml(opts.error)}</div>`
        : '';
    return `<!DOCTYPE html>
<html lang="en">
<head>${adminHead('Login')}</head>
<body class="min-h-screen bg-slate-50 text-slate-900">
  <div class="min-h-screen flex flex-col items-center justify-center px-4">
    <div class="w-full max-w-sm">
      <div class="text-center mb-8">
        <h1 class="text-2xl font-semibold text-slate-800">Navi Admin</h1>
        <p class="text-slate-500 text-sm mt-1">Sign in to edit prompts and data</p>
      </div>
      ${error}
      <form method="post" action="/admin/login" class="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-5">
        <div>
          <label for="username" class="block text-sm font-medium text-slate-700 mb-1.5">Username</label>
          <input id="username" type="text" name="username" value="" autocomplete="username"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none" />
        </div>
        <div>
          <label for="password" class="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
          <input id="password" type="password" name="password" autocomplete="current-password"
            class="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none" />
        </div>
        <button type="submit" class="w-full rounded-lg bg-emerald-600 text-white font-medium py-2.5 px-4 hover:bg-emerald-700 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 transition-colors">Log in</button>
      </form>
    </div>
  </div>
</body>
</html>`;
}

function dashboardPage(s3 = {}) {
    const badge = (on) => (on ? s3Badge() : '');
    const content = `
  ${adminNav('dashboard')}
  ${adminContainer(`
    <div class="flex items-center justify-between mb-8">
      <h1 class="text-2xl font-semibold text-slate-800">Dashboard</h1>
      <form method="post" action="/admin/logout"><button type="submit" class="text-sm text-slate-500 hover:text-slate-700 font-medium">Log out</button></form>
    </div>
    <div class="grid gap-4 sm:grid-cols-2">
      <a href="/admin/prompts" class="block rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:border-emerald-200 hover:shadow-md transition-all group">
        <div class="flex items-center gap-2">
          <h2 class="text-lg font-semibold text-slate-800 group-hover:text-emerald-700">Edit prompts</h2>
          ${badge(s3.prompts)}
        </div>
        <p class="mt-2 text-sm text-slate-500">Gemini AI prompt templates for !mu, !mq, !q, and more.</p>
        <span class="mt-3 inline-block text-sm font-medium text-emerald-600 group-hover:text-emerald-700">Open →</span>
      </a>
      <a href="/admin/data" class="block rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:border-emerald-200 hover:shadow-md transition-all group">
        <div class="flex items-center gap-2">
          <h2 class="text-lg font-semibold text-slate-800 group-hover:text-emerald-700">Edit data</h2>
          ${badge(s3.data)}
        </div>
        <p class="mt-2 text-sm text-slate-500">Stats and framedata CSV files used by the bot.</p>
        <span class="mt-3 inline-block text-sm font-medium text-emerald-600 group-hover:text-emerald-700">Open →</span>
      </a>
      <a href="/admin/aliases" class="block rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:border-emerald-200 hover:shadow-md transition-all group">
        <div class="flex items-center gap-2">
          <h2 class="text-lg font-semibold text-slate-800 group-hover:text-emerald-700">Aliases</h2>
          ${badge(s3.aliases)}
        </div>
        <p class="mt-2 text-sm text-slate-500">Character nickname → canonical slug mapping for !mu, !fd, !aliases.</p>
        <span class="mt-3 inline-block text-sm font-medium text-emerald-600 group-hover:text-emerald-700">Open →</span>
      </a>
      <a href="/admin/emojis" class="block rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:border-emerald-200 hover:shadow-md transition-all group">
        <div class="flex items-center gap-2">
          <h2 class="text-lg font-semibold text-slate-800 group-hover:text-emerald-700">Emojis</h2>
          ${badge(s3.emojis)}
        </div>
        <p class="mt-2 text-sm text-slate-500">Discord custom emoji library for use in prompts (insert as images in the editor).</p>
        <span class="mt-3 inline-block text-sm font-medium text-emerald-600 group-hover:text-emerald-700">Open →</span>
      </a>
      <a href="/admin/agent" class="block rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:border-emerald-200 hover:shadow-md transition-all group">
        <div class="flex items-center gap-2">
          <h2 class="text-lg font-semibold text-slate-800 group-hover:text-emerald-700">Agent PR</h2>
        </div>
        <p class="mt-2 text-sm text-slate-500">Gemini agents (researcher, planners, coders) produce a flight plan and open a GitHub PR from your mission prompt.</p>
        <span class="mt-3 inline-block text-sm font-medium text-emerald-600 group-hover:text-emerald-700">Open →</span>
      </a>
    </div>
  `)}
`;
    return `<!DOCTYPE html>
<html lang="en">
<head>${adminHead('Dashboard')}</head>
<body class="min-h-screen bg-slate-50 text-slate-900">${content}</body>
</html>`;
}

export { router as adminRouter };
