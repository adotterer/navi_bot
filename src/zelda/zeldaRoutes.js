import crypto from 'crypto';
import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { escapeHtml } from '../admin/layout.js';
import { zeldaPage, zeldaHeader } from './zeldaLayout.js';
import { requireSiteAuth, checkRecruiterPassword } from '../shared/siteAuth.js';
import { getAuthorizeUrl, exchangeCodeForToken, getDiscordUser } from '../shared/discordOAuth.js';
import { getGuildMemberRoles, getGuildRoleNameMap, hasAnyRoleName, getMatchupChannelMap, fetchAllChannelMessages, logToAuditChannel } from '../shared/discordRest.js';
import { channelNameToUrlSlug, channelNameToDisplayName, resolveUrlSlugToChannelName, getAllMatchupChannelNames } from './zeldaSlugs.js';
import { getCachedGuide, saveGuide } from './zeldaGuideStore.js';
import { renderGuideHtml } from './renderGuideHtml.js';
import { buildMatchupReferenceData } from '../shared/promptDataHelper.js';
import { getPrompt } from '../shared/promptLoader.js';
import { formatMessageForPrompt } from '../matchups/matchupHandler.js';
import { isModelOverloaded } from '../shared/s3Helper.js';

const COACHING_PASS_ROLE_NAME = process.env.COACHING_PASS_ROLE_NAME || 'Coaching Pass';
const MOD_ROLE_NAMES = ['Moderators', 'Legend'];
const DEMO_ALERT_DISCORD_ID = process.env.DEMO_ALERT_DISCORD_ID || '';

const genAI = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    defaultModel: process.env.GEMINI_MODEL || 'gemini-3-flash-preview',
});

export const zeldaRouter = express.Router();

function userLabel(req) {
    const user = req.session?.discordUser;
    return user ? user.username : null;
}

/** Display identity for audit-log lines: "Name (Company)" for demo sessions, Discord username otherwise. */
function auditIdentity(req) {
    const user = req.session?.discordUser;
    if (!user) return 'Unknown';
    return user.isDemo ? `${user.username} (${user.company})` : user.username;
}

/** Only demo sessions get the real-time ping — regular community logins would make this spam. */
function auditMentionIds(req) {
    return req.session?.discordUser?.isDemo && DEMO_ALERT_DISCORD_ID ? [DEMO_ALERT_DISCORD_ID] : [];
}

function auditMentionPrefix(req) {
    const ids = auditMentionIds(req);
    return ids.length ? ids.map((id) => `<@${id}>`).join(' ') + ' ' : '';
}

zeldaRouter.get('/login', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthState = state;
    const authorizeUrl = getAuthorizeUrl(state);
    const error = req.query.error;
    const nonce = res.locals.nonce || '';

    const body = `
${zeldaHeader(null)}
<main class="max-w-md mx-auto px-4 sm:px-6 py-16">
    <h1 class="text-2xl font-semibold mb-2">Zelda MU Guides</h1>
    <p class="text-slate-600 dark:text-slate-400 mb-6">Available to members with the <strong>${escapeHtml(COACHING_PASS_ROLE_NAME)}</strong> role on our Discord.</p>
    ${error === 'ratelimit' ? '<p class="text-red-600 mb-4">Too many attempts. Try again shortly.</p>' : ''}
    ${error === 'no-access' ? `<p class="text-red-600 mb-4">Your Discord account doesn't have the ${escapeHtml(COACHING_PASS_ROLE_NAME)} role.</p>` : ''}
    <a href="${authorizeUrl}" class="block text-center w-full rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-4 py-3 mb-8">Log in with Discord</a>
    <details class="text-sm text-slate-500 dark:text-slate-400"${error === 'demo-invalid' || error === 'demo-missing-info' ? ' open' : ''}>
        <summary class="cursor-pointer">Demo login</summary>
        ${error === 'demo-invalid' ? '<p class="text-red-600 mt-2">Incorrect demo access code.</p>' : ''}
        ${error === 'demo-missing-info' ? '<p class="text-red-600 mt-2">Name, company, and access code are all required.</p>' : ''}
        <form method="POST" action="/zelda/login/demo" class="mt-3 space-y-2">
            <input type="text" name="name" placeholder="Your name" class="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm" required>
            <input type="text" name="company" placeholder="Company" class="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm" required>
            <div class="flex gap-2">
                <input type="password" name="password" placeholder="Demo access code" class="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm" required>
                <button type="submit" class="rounded-lg bg-slate-700 hover:bg-slate-800 text-white text-sm px-4 py-2">Enter</button>
            </div>
        </form>
    </details>
</main>`;
    res.send(zeldaPage({ title: 'Log in', nonce, body }));
});

zeldaRouter.post('/login/demo', express.urlencoded({ extended: true }), async (req, res) => {
    const name = (req.body.name || '').trim().slice(0, 80);
    const company = (req.body.company || '').trim().slice(0, 80);
    if (!name || !company) {
        return res.redirect('/zelda/login?error=demo-missing-info');
    }
    if (!checkRecruiterPassword(req.body.password)) {
        return res.redirect('/zelda/login?error=demo-invalid');
    }
    req.session.hasCoachingPass = true;
    req.session.isModOrLegend = true;
    req.session.discordUser = { id: null, username: name, company, isDemo: true };

    await logToAuditChannel(
        process.env.GUILD_ID,
        `${auditMentionPrefix(req)}🔐 **${auditIdentity(req)}** logged in via demo access.`,
        auditMentionIds(req)
    );

    res.redirect('/zelda');
});

zeldaRouter.get('/oauth/callback', async (req, res) => {
    const { code, state } = req.query;
    if (!code || !state || state !== req.session.oauthState) {
        return res.redirect('/zelda/login?error=no-access');
    }
    delete req.session.oauthState;

    try {
        const { access_token } = await exchangeCodeForToken(code);
        const discordUser = await getDiscordUser(access_token);
        const guildId = process.env.GUILD_ID;

        const roleIds = await getGuildMemberRoles(guildId, discordUser.id);
        if (!roleIds) {
            return res.redirect('/zelda/login?error=no-access');
        }
        const roleNameMap = await getGuildRoleNameMap(guildId);
        const hasCoachingPass = hasAnyRoleName(roleIds, roleNameMap, [COACHING_PASS_ROLE_NAME]);
        if (!hasCoachingPass) {
            return res.redirect('/zelda/login?error=no-access');
        }

        req.session.discordUser = { id: discordUser.id, username: discordUser.username };
        req.session.hasCoachingPass = true;
        req.session.isModOrLegend = hasAnyRoleName(roleIds, roleNameMap, MOD_ROLE_NAMES);

        const modNote = req.session.isModOrLegend ? ' (Moderator/Legend)' : '';
        await logToAuditChannel(guildId, `🔐 **${discordUser.username}**${modNote} logged in to the Zelda MU site via Discord OAuth.`);

        res.redirect(req.query.next || '/zelda');
    } catch (err) {
        console.error('[zelda oauth]', err?.response?.data || err.message || err);
        res.redirect('/zelda/login?error=no-access');
    }
});

zeldaRouter.post('/logout', express.urlencoded({ extended: true }), (req, res) => {
    req.session.hasCoachingPass = false;
    req.session.isModOrLegend = false;
    req.session.discordUser = null;
    res.redirect('/zelda/login');
});

zeldaRouter.get('/', requireSiteAuth, async (req, res) => {
    const channelNames = await getAllMatchupChannelNames();
    const entries = await Promise.all(
        channelNames.map(async (name) => {
            const guide = await getCachedGuide(name).catch(() => null);
            return { name, slug: channelNameToUrlSlug(name), guide };
        })
    );
    entries.sort((a, b) => channelNameToDisplayName(a.name).localeCompare(channelNameToDisplayName(b.name)));

    const rows = entries
        .map(
            (e) => `<li class="flex items-center justify-between py-2 border-b border-slate-200 dark:border-slate-800">
        <a href="/zelda/${e.slug}" class="font-medium hover:underline">${escapeHtml(channelNameToDisplayName(e.name))}</a>
        <span class="text-xs text-slate-400">${e.guide ? 'Generated ' + new Date(e.guide.generatedAt).toLocaleDateString() : 'Not generated yet'}</span>
    </li>`
        )
        .join('');

    const nonce = res.locals.nonce || '';
    const scriptNonce = nonce ? ` nonce="${nonce.replace(/"/g, '&quot;')}"` : '';

    const body = `
${zeldaHeader(userLabel(req))}
<main class="max-w-3xl mx-auto px-4 sm:px-6 py-8">
    <div id="a2hs-banner" class="hidden mb-4 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 px-4 py-3 text-sm flex items-center justify-between gap-3 lg:hidden">
        <span id="a2hs-text">Add this to your home screen for quick access during tournaments.</span>
        <div class="flex items-center gap-2 shrink-0">
            <button id="a2hs-install-btn" class="hidden rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium px-3 py-1.5">Add to Home Screen</button>
            <button id="a2hs-dismiss-btn" class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg leading-none" aria-label="Dismiss">&times;</button>
        </div>
    </div>
    <h1 class="text-xl font-semibold mb-4">All matchups</h1>
    <ul>${rows}</ul>
</main>
<script${scriptNonce}>
(function() {
    var KEY = 'a2hsDismissed';
    try { if (localStorage.getItem(KEY) === '1') return; } catch (e) {}
    var isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    if (isStandalone) return;

    var banner = document.getElementById('a2hs-banner');
    var text = document.getElementById('a2hs-text');
    var installBtn = document.getElementById('a2hs-install-btn');
    var dismissBtn = document.getElementById('a2hs-dismiss-btn');
    if (!banner || !text || !installBtn || !dismissBtn) return;

    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    var deferredPrompt = null;

    if (isIOS) {
        text.textContent = 'Add this to your home screen: tap the Share icon, then "Add to Home Screen".';
        banner.classList.remove('hidden');
    } else {
        window.addEventListener('beforeinstallprompt', function(e) {
            e.preventDefault();
            deferredPrompt = e;
            installBtn.classList.remove('hidden');
            banner.classList.remove('hidden');
        });
    }

    installBtn.addEventListener('click', function() {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        deferredPrompt.userChoice.finally(function() {
            deferredPrompt = null;
            banner.classList.add('hidden');
        });
    });

    dismissBtn.addEventListener('click', function() {
        banner.classList.add('hidden');
        try { localStorage.setItem(KEY, '1'); } catch (e) {}
    });
})();
</script>`;
    res.send(zeldaPage({ title: 'All matchups', nonce, body }));
});

zeldaRouter.get('/:slug', requireSiteAuth, async (req, res) => {
    const channelName = await resolveUrlSlugToChannelName(req.params.slug);
    if (!channelName) return res.status(404).send('Character not found.');

    const guide = await getCachedGuide(channelName);
    const displayName = channelNameToDisplayName(channelName);

    logToAuditChannel(
        process.env.GUILD_ID,
        `${auditMentionPrefix(req)}👀 **${auditIdentity(req)}** viewed the **${displayName}** matchup guide.`,
        auditMentionIds(req)
    );

    const nonce = res.locals.nonce || '';
    const scriptNonce = nonce ? ` nonce="${nonce.replace(/"/g, '&quot;')}"` : '';

    const body = `
${zeldaHeader(userLabel(req))}
<main class="max-w-3xl mx-auto px-4 sm:px-6 py-8">
    <a href="/zelda" class="text-sm text-slate-500 hover:underline">&larr; All matchups</a>
    <h1 class="text-2xl font-semibold mt-2 mb-1">Zelda vs ${escapeHtml(displayName)}</h1>
    <p class="text-sm text-slate-400 mb-6">${guide ? 'Last generated ' + new Date(guide.generatedAt).toLocaleString() + ' (' + guide.sourceMessageCount + ' messages)' : 'Not generated yet.'}</p>
    <form id="regenerate-form" method="POST" action="/zelda/${req.params.slug}/regenerate" class="mb-6">
        <button id="regenerate-btn" type="submit" class="inline-flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2">
            <svg id="regenerate-spinner" class="hidden animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <span id="regenerate-label">Fetch latest &amp; regenerate</span>
        </button>
        <p id="regenerate-hint" class="hidden text-xs text-slate-400 mt-2">Pulling fresh Discord messages and generating a new summary.</p>
    </form>
    <div class="prose dark:prose-invert max-w-none">
        ${guide ? renderGuideHtml(guide.summary) : '<p class="text-slate-500">No guide generated yet.</p>'}
    </div>
</main>
<script${scriptNonce}>
(function() {
    var form = document.getElementById('regenerate-form');
    var btn = document.getElementById('regenerate-btn');
    var spinner = document.getElementById('regenerate-spinner');
    var label = document.getElementById('regenerate-label');
    var hint = document.getElementById('regenerate-hint');
    // Only form/btn/spinner/label are required — hint is a nice-to-have and must never gate the
    // whole feature off if a future markup edit drops it (that's exactly what broke this before).
    if (!form || !btn || !spinner || !label) return;
    form.addEventListener('submit', function() {
        if (btn.disabled) return;
        btn.disabled = true;
        spinner.classList.remove('hidden');
        label.textContent = 'Fetching & regenerating…';
        if (hint) hint.classList.remove('hidden');
    });
})();
</script>`;
    res.send(zeldaPage({ title: displayName, nonce, body }));
});

zeldaRouter.post('/:slug/regenerate', requireSiteAuth, async (req, res) => {
    const channelName = await resolveUrlSlugToChannelName(req.params.slug);
    if (!channelName) return res.status(404).send('Character not found.');

    try {
        const guildId = process.env.GUILD_ID;
        const channelMap = await getMatchupChannelMap(guildId);
        const channelId = channelMap.get(channelName);
        if (!channelId) return res.status(404).send('Discord channel not found for this character.');

        const messages = await fetchAllChannelMessages(channelId);
        const displayName = channelNameToDisplayName(channelName);

        const katyparryMessages = messages.filter((msg) => msg.author === 'katyparry');
        const otherMessages = messages.filter((msg) => msg.author !== 'katyparry');
        const referenceData = await buildMatchupReferenceData({
            opponentSlug: channelName,
            opponentAlias: channelName,
            messages,
            question: null,
        });

        const prompt = await getPrompt('mu_notes', {
            displayName,
            priorityMessages: katyparryMessages.map(formatMessageForPrompt).join('\n\n'),
            otherMessages: otherMessages.map(formatMessageForPrompt).join('\n\n'),
            referenceData: referenceData || 'None found',
        });

        const response = await genAI.models.generateContent({
            model: process.env.GEMINI_MODEL || 'gemini-3-flash-preview',
            contents: prompt,
        });

        await saveGuide(channelName, { summary: response.text, sourceMessageCount: messages.length });
        await logToAuditChannel(
            guildId,
            `${auditMentionPrefix(req)}🔄 **${auditIdentity(req)}** fetched a new summary for **${displayName}** (${messages.length} messages).`,
            auditMentionIds(req)
        );
        res.redirect(`/zelda/${req.params.slug}`);
    } catch (err) {
        console.error('[zelda regenerate]', channelName, err);
        const message = isModelOverloaded(err)
            ? 'The AI model is overloaded right now — try again shortly.'
            : 'Error generating guide: ' + (err.message || err);
        res.status(500).send(message);
    }
});
