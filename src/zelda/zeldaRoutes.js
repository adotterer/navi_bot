import crypto from 'crypto';
import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { escapeHtml } from '../admin/layout.js';
import { zeldaPage, zeldaHeader } from './zeldaLayout.js';
import { requireSiteAuth, requireModOrLegend, checkRecruiterPassword } from '../shared/siteAuth.js';
import { getAuthorizeUrl, exchangeCodeForToken, getDiscordUser } from '../shared/discordOAuth.js';
import { getGuildMemberRoles, getGuildRoleNameMap, hasAnyRoleName, getMatchupChannelMap, fetchAllChannelMessages } from '../shared/discordRest.js';
import { channelNameToUrlSlug, channelNameToDisplayName, resolveUrlSlugToChannelName, getAllMatchupChannelNames } from './zeldaSlugs.js';
import { getCachedGuide, saveGuide } from './zeldaGuideStore.js';
import { renderGuideHtml } from './renderGuideHtml.js';
import { buildMatchupReferenceData } from '../shared/promptDataHelper.js';
import { getPrompt } from '../shared/promptLoader.js';
import { formatMessageForPrompt } from '../matchups/matchupHandler.js';
import { isModelOverloaded } from '../shared/s3Helper.js';

const COACHING_PASS_ROLE_NAME = process.env.COACHING_PASS_ROLE_NAME || 'Coaching Pass';
const MOD_ROLE_NAMES = ['Moderators', 'Legend'];

const genAI = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    defaultModel: process.env.GEMINI_MODEL || 'gemini-3-flash-preview',
});

export const zeldaRouter = express.Router();

function userLabel(req) {
    const user = req.session?.discordUser;
    return user ? user.username : null;
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
    <details class="text-sm text-slate-500 dark:text-slate-400">
        <summary class="cursor-pointer">Reviewing this for a job or interview?</summary>
        <form method="POST" action="/zelda/login/demo" class="mt-3 flex gap-2">
            <input type="password" name="password" placeholder="Demo access code" class="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm" required>
            <button type="submit" class="rounded-lg bg-slate-700 hover:bg-slate-800 text-white text-sm px-4 py-2">Enter</button>
        </form>
    </details>
</main>`;
    res.send(zeldaPage({ title: 'Log in', nonce, body }));
});

zeldaRouter.post('/login/demo', express.urlencoded({ extended: true }), (req, res) => {
    if (!checkRecruiterPassword(req.body.password)) {
        return res.redirect('/zelda/login?error=no-access');
    }
    req.session.hasCoachingPass = true;
    req.session.isModOrLegend = true;
    req.session.discordUser = { id: null, username: 'Demo Access' };
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

    const body = `
${zeldaHeader(userLabel(req))}
<main class="max-w-3xl mx-auto px-4 sm:px-6 py-8">
    <h1 class="text-xl font-semibold mb-4">All matchups</h1>
    <ul>${rows}</ul>
</main>`;
    res.send(zeldaPage({ title: 'All matchups', nonce: res.locals.nonce, body }));
});

zeldaRouter.get('/:slug', requireSiteAuth, async (req, res) => {
    const channelName = await resolveUrlSlugToChannelName(req.params.slug);
    if (!channelName) return res.status(404).send('Character not found.');

    const guide = await getCachedGuide(channelName);
    const displayName = channelNameToDisplayName(channelName);
    const canFetch = !!req.session.isModOrLegend;

    const body = `
${zeldaHeader(userLabel(req))}
<main class="max-w-3xl mx-auto px-4 sm:px-6 py-8">
    <a href="/zelda" class="text-sm text-slate-500 hover:underline">&larr; All matchups</a>
    <h1 class="text-2xl font-semibold mt-2 mb-1">Zelda vs ${escapeHtml(displayName)}</h1>
    <p class="text-sm text-slate-400 mb-6">${guide ? 'Last generated ' + new Date(guide.generatedAt).toLocaleString() + ' (' + guide.sourceMessageCount + ' messages)' : 'Not generated yet.'}</p>
    ${canFetch ? `<form method="POST" action="/zelda/${req.params.slug}/regenerate" class="mb-6"><button type="submit" class="rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2">Fetch latest &amp; regenerate</button></form>` : ''}
    <div class="prose dark:prose-invert max-w-none">
        ${guide ? renderGuideHtml(guide.summary) : '<p class="text-slate-500">No guide generated yet.</p>'}
    </div>
</main>`;
    res.send(zeldaPage({ title: displayName, nonce: res.locals.nonce, body }));
});

zeldaRouter.post('/:slug/regenerate', requireSiteAuth, requireModOrLegend, async (req, res) => {
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
        res.redirect(`/zelda/${req.params.slug}`);
    } catch (err) {
        console.error('[zelda regenerate]', channelName, err);
        const message = isModelOverloaded(err)
            ? 'The AI model is overloaded right now — try again shortly.'
            : 'Error generating guide: ' + (err.message || err);
        res.status(500).send(message);
    }
});
