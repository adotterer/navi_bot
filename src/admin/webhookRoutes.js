/**
 * GitHub webhook receiver. Listens for push events on main and posts a deploy
 * notification to the #audit-logs Discord channel.
 *
 * Mount this at the root level in src/app.js (not under /admin) so it is
 * reachable at POST /github/webhook without admin auth.
 *
 * Requires express.raw({ type: 'application/json' }) to be applied before this
 * router so the raw body bytes are available for HMAC verification.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import express from 'express';
import { EmbedBuilder } from 'discord.js';
import { getClient } from '../shared/discordClient.js';
import { INFO_EMBED_COLOR } from '../messages/faqAndAliasHandler.js';

export const webhookRouter = express.Router();

function verifySignature(rawBody, signatureHeader) {
    const secret = process.env.WEBHOOK_SECRET;
    if (!secret || !signatureHeader) return false;
    const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
    try {
        return timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
    } catch {
        return false;
    }
}

webhookRouter.post('/github/webhook', async (req, res) => {
    const sig = req.headers['x-hub-signature-256'];
    if (!verifySignature(req.body, sig)) {
        return res.status(401).json({ error: 'Invalid signature' });
    }

    let payload;
    try {
        payload = JSON.parse(req.body.toString('utf8'));
    } catch {
        return res.status(400).json({ error: 'Invalid JSON' });
    }

    // Only care about pushes to main
    if (payload.ref !== 'refs/heads/main') {
        return res.status(200).json({ ok: true, ignored: true });
    }

    const client = getClient();
    if (!client?.isReady()) {
        console.warn('[webhook] Discord client not ready — deploy notification skipped');
        return res.status(503).json({ error: 'Discord client not ready' });
    }

    const guild = client.guilds.cache.first();
    if (!guild) {
        return res.status(503).json({ error: 'No guild available' });
    }

    const auditLogsChannel = guild.channels.cache.find(
        (ch) => ch.isTextBased() && ch.name === 'audit-logs'
    );
    if (!auditLogsChannel) {
        console.warn('[webhook] #audit-logs channel not found');
        return res.status(503).json({ error: '#audit-logs not found' });
    }

    const commit = payload.head_commit || {};
    const sha = (commit.id || '').slice(0, 7);
    const msgLines = (commit.message || '').split('\n').map((l) => l.trim()).filter(Boolean);
    let commitMsg = payload.pull_request?.title || msgLines[0] || '';
    if (!payload.pull_request?.title && commitMsg.startsWith('Merge pull request') && msgLines[1]) {
        commitMsg = msgLines[1];
    }
    let author = commit.author?.name || commit.author?.username || payload.sender?.login || 'unknown';
    if (author === 'Andrew Dotterer' || author === 'adotterer') {
        author = 'Ticomaster';
    }
    const now = new Date().toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    });

    const embed = new EmbedBuilder()
        .setColor(INFO_EMBED_COLOR)
        .setDescription(
            `🚀 **Deployed to Elastic Beanstalk**\n` +
            `• **Commit:** \`${sha}\` — ${commitMsg}\n` +
            `• **Author:** ${author}\n` +
            `• **Branch:** main\n` +
            `• **Time:** ${now}`
        );

    try {
        await auditLogsChannel.send({ embeds: [embed] });
        console.log('[webhook] Deploy notification sent to #audit-logs');
        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error('[webhook] Failed to send Discord message:', err.message);
        return res.status(500).json({ error: 'Discord send failed' });
    }
});
