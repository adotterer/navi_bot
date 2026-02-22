/**
 * Admin routes for editing prompt templates. Uses promptLoader.
 */
import express from 'express';
import { getPromptTemplate, savePromptTemplate, getPromptMeta, listPromptIds, resetPromptToDefault, listPromptHistory, getPromptHistoryEntry, revertPromptToVersion } from '../shared/promptLoader.js';
import { getEmojiLibrary } from '../shared/emojiSync.js';
import { adminHead, adminNav, adminContainer, breadcrumb, escapeHtml, s3Badge, saveBarToggleButton, saveBarMinimizeScript } from './layout.js';
import { headS3Key } from '../shared/s3Helper.js';
import { PRISM_TAIL } from './prismTail.js';

const S3_PROMPTS_PREFIX = 'admin/prompts/';

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        const ids = listPromptIds();
        const s3Flags = await Promise.all(ids.map(id => headS3Key(S3_PROMPTS_PREFIX + id + '.txt').catch(() => false)));
        const list = ids.map((id, i) => {
            const meta = getPromptMeta(id);
            return { id, ...meta, s3InUse: s3Flags[i] };
        });
        res.send(promptsListPage(list));
    } catch (err) {
        console.error('Admin prompts list:', err);
        res.status(500).send('Error loading prompts.');
    }
});

router.get('/:id/history', async (req, res) => {
    const { id } = req.params;
    if (!getPromptMeta(id)) {
        return res.status(404).json({ error: 'Unknown prompt ID.' });
    }
    try {
        const list = await listPromptHistory(id);
        res.set('Content-Type', 'application/json').send(JSON.stringify(list));
    } catch (err) {
        console.error('Admin prompt history list:', err);
        res.status(500).json({ error: 'Failed to list history.' });
    }
});

router.get('/:id/history/:versionKey', async (req, res) => {
    const { id, versionKey } = req.params;
    if (!getPromptMeta(id)) {
        return res.status(404).send('Prompt not found.');
    }
    try {
        const decoded = decodeURIComponent(versionKey);
        const body = await getPromptHistoryEntry(id, decoded);
        if (body == null) {
            return res.status(404).send('Version not found.');
        }
        res.set('Content-Type', 'text/plain; charset=utf-8').send(body);
    } catch (err) {
        console.error('Admin prompt history get:', err);
        res.status(500).send('Error loading version.');
    }
});

router.post('/:id/revert', express.urlencoded({ extended: true }), async (req, res) => {
    const { id } = req.params;
    const versionKey = (req.body && req.body.versionKey) || req.query.versionKey;
    if (!getPromptMeta(id)) {
        return res.status(404).send('Unknown prompt ID.');
    }
    if (!versionKey || typeof versionKey !== 'string') {
        return res.redirect(`/admin/prompts/${id}?error=revert`);
    }
    try {
        await revertPromptToVersion(id, versionKey.trim());
        res.redirect(`/admin/prompts/${id}?saved=1`);
    } catch (err) {
        console.error('Admin prompt revert:', err);
        res.redirect(`/admin/prompts/${id}?error=revert`);
    }
});

router.get('/:id', async (req, res) => {
    const { id } = req.params;
    const meta = getPromptMeta(id);
    if (!meta) {
        return res.status(404).send('Unknown prompt ID.');
    }
    try {
        const [body, s3InUse] = await Promise.all([
            getPromptTemplate(id),
            headS3Key(S3_PROMPTS_PREFIX + id + '.txt').catch(() => false)
        ]);
        const saved = req.query.saved === '1';
        const reset = req.query.reset === '1';
        const emojiLibrary = getEmojiLibrary();
        res.send(promptEditPage(id, meta, body, { saved, reset, s3InUse, emojiLibrary, error: req.query.error, csrfToken: req.csrfToken() }));
    } catch (err) {
        console.error('Admin prompt get:', err);
        res.status(500).send('Error loading prompt.');
    }
});

router.post('/:id', express.urlencoded({ extended: true }), async (req, res) => {
    const { id } = req.params;
    const meta = getPromptMeta(id);
    if (!meta) {
        return res.status(404).send('Unknown prompt ID.');
    }
    const body = (req.body && req.body.body) || '';
    try {
        await savePromptTemplate(id, body);
        res.redirect(`/admin/prompts/${id}?saved=1`);
    } catch (err) {
        console.error('Admin prompt save:', err);
        const msg = (err && err.message) || '';
        const saveError = msg.toLowerCase().includes('credential')
            ? 'S3 credentials are missing or invalid. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env and restart the admin server.'
            : 'Could not save to S3. Check your .env (AWS_*, S3_BUCKET_NAME) and try again.';
        try {
            const emojiLibrary = getEmojiLibrary();
            res.status(200).send(promptEditPage(id, meta, body, { saveError, emojiLibrary, csrfToken: req.csrfToken() }));
        } catch (e) {
            res.status(500).send('Error saving prompt.');
        }
    }
});

router.post('/:id/reset', express.urlencoded({ extended: true }), async (req, res) => {
    const { id } = req.params;
    if (!getPromptMeta(id)) {
        return res.status(404).send('Unknown prompt ID.');
    }
    try {
        await resetPromptToDefault(id);
        res.redirect(`/admin/prompts/${id}?reset=1`);
    } catch (err) {
        console.error('Admin prompt reset:', err);
        res.status(500).send('Error resetting prompt.');
    }
});

function promptsListPage(list) {
    const rows = list
        .map(
            ({ id, description, s3InUse }) => `
        <tr class="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50/80 dark:hover:bg-slate-800/50">
          <td class="py-3 px-4"><a href="/admin/prompts/${escapeHtml(id)}" class="font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400">${escapeHtml(id)}</a></td>
          <td class="py-3 text-slate-600 dark:text-slate-400 text-sm px-4">${escapeHtml(description)}</td>
          <td class="py-3 px-4">${s3InUse ? s3Badge() : ''}</td>
        </tr>`
        )
        .join('');
    const content = `
  ${adminNav('prompts')}
  ${adminContainer(`
    ${breadcrumb([{ href: '/admin', label: 'Dashboard' }, { label: 'Prompts' }])}
    <h1 class="text-2xl font-semibold text-slate-800 dark:text-slate-100 mb-2">Edit prompts</h1>
    <p class="text-slate-600 dark:text-slate-400 text-sm mb-6">Variables use <code class="font-mono text-xs bg-slate-100 dark:bg-slate-700 dark:text-slate-300 px-1.5 py-0.5 rounded">&#123;&#123;name&#125;&#125;</code>. Don't remove or rename variables.</p>
    <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden shadow-sm overflow-x-auto">
      <table class="w-full">
        <thead><tr class="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700"><th class="text-left py-3 px-4 text-sm font-semibold text-slate-700 dark:text-slate-300">Prompt ID</th><th class="text-left py-3 px-4 text-sm font-semibold text-slate-700 dark:text-slate-300">Description</th><th class="text-left py-3 px-4 text-sm font-semibold text-slate-700 dark:text-slate-300 w-16"></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `)}
`;
    return `<!DOCTYPE html>
<html lang="en">
<head>${adminHead('Prompts')}</head>
<body class="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">${content}</body>
</html>`;
}

function promptEditPage(id, meta, body, opts = {}) {
    const csrfToken = opts.csrfToken || '';
    const csrfInput = `<input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">`;
    const variables = meta.variables || [];
    const pillColors = ['#8b5cf6', 'coral', 'darkcyan', 'mediumseagreen', 'darkorange', 'mediumpurple', 'steelblue', 'indianred', 'teal', 'chocolate'];
    const varNames = variables.map((v) => (typeof v === 'string' ? v : v.name));
    const varPills = variables
        .map((v, i) => {
            const name = typeof v === 'string' ? v : v.name;
            const desc = typeof v === 'string' ? '' : (v.description || '');
            const color = pillColors[i % pillColors.length];
            return `<button type="button" class="insert-var rounded-lg border px-3 py-1.5 text-sm font-mono text-white transition-colors hover:opacity-90" style="background-color:${color};border-color:${color}" data-var="${escapeHtml(name)}" title="${escapeHtml(desc)}">&#123;&#123;${escapeHtml(name)}&#125;&#125;</button>`;
        })
        .join('');
    const varsSection =
        variables.length > 0
            ? `
    <div class="mb-6 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 p-4">
      <p class="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Insert variable at cursor</p>
      <div class="flex flex-wrap gap-2" id="var-pills">${varPills}</div>
    </div>`
            : '';
    const emojiLibrary = opts.emojiLibrary || [];
    const emojiCodeToUrl = (code) => {
        const m = code && code.match(/<(a?):([^:]+):(\d+)>/);
        return m ? `https://cdn.discordapp.com/emojis/${m[3]}.${m[1] === 'a' ? 'gif' : 'png'}` : null;
    };
    const emojiPills = emojiLibrary
        .map(({ label, code }) => {
            const url = emojiCodeToUrl(code);
            const img = url ? `<img src="${url}" alt="" class="insert-emoji-pill-img" loading="lazy">` : '';
            return `<button type="button" class="insert-emoji rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 hover:border-slate-300 dark:hover:border-slate-500 transition-colors inline-flex items-center gap-2" data-code="${escapeHtml(code)}" title="${escapeHtml(code)}">${img}<span>${escapeHtml(label)}</span></button>`;
        })
        .join('');
    const emojiSection =
        emojiLibrary.length > 0
            ? `
    <div class="mb-6 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 p-4">
      <p class="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Insert emoji at cursor</p>
      <div class="flex flex-wrap gap-2" id="emoji-pills">${emojiPills}</div>
      <p class="text-xs text-slate-500 dark:text-slate-400 mt-2">Emojis appear as images in the editor; the underlying code is saved. Manage library in <a href="/admin/emojis" class="text-emerald-600 hover:text-emerald-700 dark:text-emerald-400">Emojis</a>.</p>
    </div>`
            : '';
    const savedBanner = opts.saved
        ? '<div class="rounded-lg prompt-banner-saved text-sm px-4 py-3 mb-6">Saved. The bot will use this template on the next request.</div>'
        : '';
    const resetBanner = opts.reset
        ? '<div class="rounded-lg prompt-banner-reset text-sm px-4 py-3 mb-6">Reset to default. Template restored from built-in.</div>'
        : '';
    const saveErrorBanner = opts.saveError
        ? `<div class="rounded-lg prompt-banner-error text-sm px-4 py-3 mb-6">${escapeHtml(opts.saveError)}</div>`
        : '';
    const revertErrorBanner = opts.error === 'revert'
        ? '<div class="rounded-lg prompt-banner-error text-sm px-4 py-3 mb-6">Could not revert. Version may have been deleted or invalid.</div>'
        : '';
    const content = `
  ${adminNav('prompts')}
  ${adminContainer(`
    ${breadcrumb([{ href: '/admin', label: 'Dashboard' }, { href: '/admin/prompts', label: 'Prompts' }, { label: id }])}
    <div class="flex items-center gap-2 mb-1 flex-wrap">
      <h1 class="text-2xl font-semibold text-slate-800 dark:text-slate-100">${escapeHtml(id)}</h1>
      ${opts.s3InUse ? s3Badge() : ''}
      <button type="button" class="prompt-version-history-open prompt-header-btn text-slate-600 dark:text-slate-300 hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-slate-800 dark:hover:text-emerald-400 dark:hover:border-emerald-600">Version history</button>
    </div>
    <p class="text-slate-600 dark:text-slate-400 text-sm mb-6">${escapeHtml(meta.description)}</p>
    ${savedBanner}
    ${resetBanner}
    ${saveErrorBanner}
    ${revertErrorBanner}
    ${varsSection}
    ${emojiSection}
    <div class="admin-save-bar-spacer pb-24 w-full">
      <div id="prompt-split" class="prompt-split flex w-full gap-0 min-h-[280px] sm:min-h-[380px]">
        <div id="prompt-editor-column" class="prompt-editor-column flex flex-col min-w-0 flex-1 bg-white dark:bg-slate-800 rounded-tl-xl rounded-tr-xl sm:rounded-tr-none sm:rounded-bl-xl">
          <form id="prompt-form" method="post" action="/admin/prompts/${escapeHtml(id)}" class="flex flex-col flex-1 min-h-0 px-3">
            ${csrfInput}
            <div class="prompt-editor-header flex items-center justify-between gap-2 px-3 py-2.5">
              <label for="prompt-body" class="text-sm font-medium text-slate-700 dark:text-slate-300">Template body</label>
              <button type="button" id="prompt-show-preview-btn" class="prompt-header-btn hidden text-slate-600 dark:text-slate-300 hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-slate-800 dark:hover:text-emerald-400 dark:hover:border-emerald-600" title="Show preview panel">Show preview</button>
            </div>
            <div id="prompt-editor-wrap" class="prompt-editor-wrap rounded-xl border border-slate-300 dark:border-slate-600 flex-1 min-h-[280px] sm:min-h-[320px] focus-within:border-emerald-500 focus-within:ring-1 focus-within:ring-emerald-500">
              <div id="prompt-highlight" class="prompt-highlight" aria-hidden="true"></div>
              <textarea id="prompt-body" name="body" rows="28" class="prompt-textarea" placeholder="Prompt text with {{variables}}...">${escapeHtml(body)}</textarea>
            </div>
          </form>
        </div>
        <div id="prompt-split-handle" class="prompt-split-handle flex-shrink-0 w-2 cursor-col-resize bg-slate-200 dark:bg-slate-600 hover:bg-emerald-300 dark:hover:bg-emerald-600 transition-colors rounded" title="Drag to resize"></div>
        <div id="prompt-preview-column" class="prompt-preview-column flex flex-col min-w-0 sm:min-w-[200px] flex-1 min-h-0 rounded-bl-xl rounded-br-xl sm:rounded-bl-none sm:rounded-tr-xl overflow-hidden border border-t-0 sm:border-t sm:border-l-0 border-slate-700">
          <div class="prompt-preview-header flex items-center justify-between gap-2 px-3 py-2.5 bg-slate-800 border-b border-slate-600">
            <span class="text-sm font-semibold text-white">Preview (Discord)</span>
            <button type="button" id="prompt-minimize-preview-btn" class="prompt-header-btn text-slate-300 dark:text-slate-300 bg-slate-700 dark:bg-slate-700 border-slate-600 hover:bg-slate-600 dark:hover:bg-slate-600" title="Hide preview panel">Minimize</button>
          </div>
          <div id="prompt-preview" class="prompt-preview-panel flex-1 px-4 py-3 text-[15px] leading-[1.375] min-h-0 overflow-auto" style="background:#323339;"></div>
        </div>
      </div>
      <form method="post" action="/admin/prompts/${escapeHtml(id)}/reset" class="mt-6 pt-6 border-t border-slate-200 dark:border-slate-700">
        ${csrfInput}
        <button type="submit" class="text-sm text-slate-500 dark:text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 font-medium" onclick="return confirm('Restore the built-in default for this prompt?');">Reset to default</button>
      </form>
    </div>
    <div id="prompt-version-history-sidecar" class="prompt-history-sidecar" aria-hidden="true">
      <div class="prompt-history-sidecar-inner">
        <div class="prompt-history-sidecar-header">
          <span class="font-semibold text-slate-800 dark:text-slate-100">Version history</span>
          <button type="button" id="prompt-version-history-close" class="prompt-history-close-btn" aria-label="Close">×</button>
        </div>
        <div id="prompt-version-history-list" class="prompt-history-sidecar-body text-sm text-slate-600 dark:text-slate-400" data-prompt-id="${escapeHtml(id)}"></div>
      </div>
    </div>
    <style>
      #prompt-action-bar { position: fixed; bottom: 0; left: 0; right: 0; z-index: 50; }
      .prompt-editor-header,
      .prompt-preview-header { height: 67px; min-height: 67px; max-height: 67px; flex-shrink: 0; box-sizing: border-box; }
      .prompt-header-btn { display: inline-flex; align-items: center; justify-content: center; height: 2rem; padding: 0 1rem; font-size: 0.875rem; font-weight: 500; line-height: 1.25rem; border-radius: 0.5rem; border: 1px solid #cbd5e1; background: #fff; transition: color 0.15s, background-color 0.15s, border-color 0.15s; }
      .prompt-split { --editor-width: 50%; flex-direction: row; }
      .prompt-editor-column { flex: 0 0 var(--editor-width); transition: flex 0.25s ease; }
      .prompt-preview-column { flex: 1 1 0; min-width: 0; transition: flex 0.25s ease, opacity 0.25s ease; }
      @media (min-width: 640px) {
        .prompt-split { flex-direction: row; }
        .prompt-preview-column { min-width: 260px; }
      }
      .prompt-split-handle { transition: width 0.25s ease, opacity 0.25s ease, min-width 0.25s ease; }
      .prompt-split:not(.preview-minimized) #prompt-show-preview-btn { display: none !important; }
      .prompt-split.preview-minimized .prompt-editor-column { flex: 1 1 100%; }
      .prompt-split.preview-minimized .prompt-split-handle { width: 0; min-width: 0; opacity: 0; pointer-events: none; overflow: hidden; }
      .prompt-split.preview-minimized .prompt-preview-column { flex: 0 0 0; min-width: 0; overflow: hidden; opacity: 0; pointer-events: none; }
      .prompt-split.preview-minimized #prompt-show-preview-btn { display: inline-flex !important; }
      .prompt-split.preview-minimized #prompt-minimize-preview-btn { display: none; }
      .insert-emoji-pill-img { width: 24px; height: 24px; object-fit: contain; flex-shrink: 0; display: block; }
      .prompt-preview-panel { white-space: pre-wrap; word-wrap: break-word; background: #2C2D32 !important; color: #ffffff !important; border-radius: 0.5rem; margin-top: 0; margin-bottom: 0.5rem; }
      .prompt-preview-panel .preview-emoji-img { display: inline; vertical-align: middle; height: 22px; width: auto; max-width: 22px; object-fit: contain; }
      .prompt-preview-panel strong { font-weight: 600; color: #ffffff !important; }
      .prompt-preview-panel em { font-style: italic; color: #ffffff !important; }
      .prompt-preview-panel u { text-decoration: underline; color: #ffffff !important; }
      .prompt-preview-panel s { text-decoration: line-through; color: #ffffff !important; }
      .prompt-preview-panel code { background: #111; color: #ffffff !important; padding: 0.1em 0.3em; border-radius: 3px; font-size: 0.9em; border: 1px solid #333; }
      .prompt-preview-panel pre { background: #111; color: #ffffff !important; padding: 8px 12px; border-radius: 4px; overflow-x: auto; margin: 4px 0; font-size: 0.85em; white-space: pre-wrap; border: 1px solid #333; }
      .prompt-preview-panel .preview-h1, .prompt-preview-panel .preview-h2, .prompt-preview-panel .preview-h3 { color: #ffffff !important; }
      .prompt-preview-panel .preview-h1 { font-size: 1.25em; font-weight: 700; margin: 0.5em 0 0.25em; }
      .prompt-preview-panel .preview-h2 { font-size: 1.1em; font-weight: 600; margin: 0.5em 0 0.2em; }
      .prompt-preview-panel .preview-h3 { font-size: 1em; font-weight: 600; margin: 0.4em 0 0.15em; }
      .prompt-preview-panel .preview-bullet { margin: 0.2em 0; padding-left: 0.5em; border-left: 2px solid #444; color: #ffffff !important; }
      .prompt-preview-panel .preview-blockquote { margin: 0.25em 0; padding-left: 0.75em; border-left: 4px solid #6b7280; color: #ffffff !important; }
      .prompt-preview-panel .preview-blockquote-inline { display: inline-block; padding-left: 0.5em; border-left: 3px solid #6b7280; color: inherit; }
      .prompt-preview-panel .preview-line { margin: 0.15em 0; color: #ffffff !important; }
      .prompt-editor-wrap { display: grid; overflow: hidden; }
      .prompt-editor-wrap .prompt-highlight, .prompt-editor-wrap .prompt-textarea { grid-area: 1/1; min-height: 280px; font: inherit; font-family: ui-monospace, monospace; font-size: 0.875rem; line-height: 1.5; padding: 0.75rem 1rem; overflow: auto; white-space: pre-wrap; word-wrap: break-word; }
      .prompt-editor-wrap .prompt-highlight { z-index: 0; pointer-events: none; color: #0f172a; }
      .prompt-editor-wrap .prompt-textarea { z-index: 1; background: transparent; color: transparent; caret-color: #0f172a; resize: vertical; border: none; outline: none; }
      .prompt-editor-wrap .prompt-textarea::placeholder { color: #94a3b8; }
      .prompt-history-sidecar { position: fixed; top: 0; right: 0; bottom: 0; width: min(320px, 100vw); z-index: 40; pointer-events: none; }
      .prompt-history-sidecar .prompt-history-sidecar-inner { height: 100%; background: #fff; border-left: 1px solid #e2e8f0; box-shadow: -4px 0 16px rgba(0,0,0,0.08); transform: translateX(100%); transition: transform 0.2s ease; display: flex; flex-direction: column; pointer-events: auto; }
      .prompt-history-sidecar.open .prompt-history-sidecar-inner { transform: translateX(0); }
      .prompt-history-sidecar.open { pointer-events: auto; }
      .prompt-history-sidecar-header { flex-shrink: 0; padding: 1rem 1.25rem; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between; }
      .prompt-history-close-btn { width: 2rem; height: 2rem; padding: 0; border: none; background: transparent; font-size: 1.5rem; line-height: 1; color: #64748b; cursor: pointer; border-radius: 0.25rem; }
      .prompt-history-close-btn:hover { background: #f1f5f9; color: #475569; }
      .prompt-history-sidecar-body { flex: 1; overflow: auto; padding: 1rem 1.25rem; }
      .prompt-history-sidecar-body ul { list-style: none; padding: 0; margin: 0; }
      .prompt-history-sidecar-body li { padding: 0.5rem 0; border-bottom: 1px solid #f1f5f9; display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
      .prompt-history-sidecar-body li:last-child { border-bottom: none; }

      /* Banners */
      .prompt-banner-saved { background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; }
      .prompt-banner-reset { background: #fffbeb; border: 1px solid #fcd34d; color: #92400e; }
      .prompt-banner-error { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }

      /* Dark mode overrides for hardcoded values */
      .dark .prompt-header-btn { background: #1e293b; border-color: #475569; color: #94a3b8; }
      .dark .prompt-header-btn:hover { background: #1e293b; }
      .dark .prompt-editor-wrap { background: #1e293b; }
      .dark .prompt-editor-wrap .prompt-highlight { color: #e2e8f0; }
      .dark .prompt-editor-wrap .prompt-textarea { caret-color: #e2e8f0; }
      .dark .prompt-editor-wrap .prompt-textarea::placeholder { color: #475569; }
      .dark .prompt-history-sidecar .prompt-history-sidecar-inner { background: #1e293b; border-left-color: #334155; }
      .dark .prompt-history-sidecar-header { border-bottom-color: #334155; }
      .dark .prompt-history-close-btn { color: #94a3b8; }
      .dark .prompt-history-close-btn:hover { background: #334155; color: #cbd5e1; }
      .dark .prompt-history-sidecar-body li { border-bottom-color: #334155; }
      .dark .prompt-banner-saved { background: rgba(6,78,59,0.25); border-color: #065f46; color: #6ee7b7; }
      .dark .prompt-banner-reset { background: rgba(120,53,15,0.25); border-color: #92400e; color: #fcd34d; }
      .dark .prompt-banner-error { background: rgba(127,29,29,0.25); border-color: #991b1b; color: #fca5a5; }

      /* Prism in overlay: keep pre inline so textarea scroll sync stays accurate */
      .prompt-highlight pre { display: inline; margin: 0; padding: 0.05em 0.2em; border-radius: 3px; font: inherit; white-space: inherit; background: rgba(30,30,46,0.1); }
      .dark .prompt-highlight pre { background: rgba(30,30,46,0.45); }
      .prompt-highlight pre code { display: inline; background: transparent; font: inherit; padding: 0; border: none; }

      /* Prism token colors for both overlay (#prompt-highlight) and Discord preview (#prompt-preview) */
      #prompt-highlight .token.comment, #prompt-preview .token.comment { color: #a78bfa; }
      #prompt-highlight .token.punctuation, #prompt-preview .token.punctuation { color: #94a3b8; }
      #prompt-highlight .token.tag, #prompt-highlight .token.attr-name,
      #prompt-preview .token.tag, #prompt-preview .token.attr-name { color: #c084fc; }
      #prompt-highlight .token.function, #prompt-highlight .token.function-name,
      #prompt-preview .token.function, #prompt-preview .token.function-name { color: #60a5fa; }
      #prompt-highlight .token.boolean, #prompt-highlight .token.number,
      #prompt-preview .token.boolean, #prompt-preview .token.number { color: #fb923c; }
      #prompt-highlight .token.property, #prompt-highlight .token.class-name, #prompt-highlight .token.constant,
      #prompt-preview .token.property, #prompt-preview .token.class-name, #prompt-preview .token.constant { color: #facc15; }
      #prompt-highlight .token.keyword, #prompt-highlight .token.selector, #prompt-highlight .token.builtin,
      #prompt-preview .token.keyword, #prompt-preview .token.selector, #prompt-preview .token.builtin { color: #f87171; }
      #prompt-highlight .token.string, #prompt-highlight .token.attr-value, #prompt-highlight .token.regex, #prompt-highlight .token.variable,
      #prompt-preview .token.string, #prompt-preview .token.attr-value, #prompt-preview .token.regex, #prompt-preview .token.variable { color: #4ade80; }
      #prompt-highlight .token.operator, #prompt-highlight .token.entity,
      #prompt-preview .token.operator, #prompt-preview .token.entity { color: #22d3d4; }

      /* Prism code blocks in Discord preview */
      #prompt-preview pre.prism-block { background: #1e1e2e !important; border-radius: 4px; margin: 6px 0; padding: 10px 14px; border: 1px solid #334155; white-space: pre-wrap; font-size: 0.875em; overflow-x: auto; color: #e2e8f0 !important; }
      #prompt-preview pre.prism-block code { background: transparent !important; border: none !important; padding: 0 !important; color: inherit !important; font-size: 1em; white-space: inherit; }

      /* Mobile responsive */
      @media (max-width: 639px) {
        .prompt-split { flex-direction: column !important; min-height: auto !important; }
        .prompt-split-handle { display: none !important; }
        .prompt-editor-column { flex: 1 1 auto !important; min-height: 280px; }
        .prompt-preview-column { flex: 1 1 auto !important; min-width: 0 !important; min-height: 220px !important; }
        .prompt-split.preview-minimized .prompt-preview-column { flex: 0 0 0 !important; min-height: 0 !important; max-height: 0; overflow: hidden; opacity: 0; }
      }
    </style>
    <script>
      (function(){
        var ta = document.getElementById('prompt-body');
        var form = document.getElementById('prompt-form');
        var highlightEl = document.getElementById('prompt-highlight');
        var varNames = ${JSON.stringify(varNames)};
        var pillColors = ${JSON.stringify(pillColors)};

        function colorForVar(name) {
          var i = varNames.indexOf(name);
          return i >= 0 ? pillColors[i % pillColors.length] : '#64748b';
        }
        function escapeHtml(s) {
          var div = document.createElement('div');
          div.textContent = s;
          return div.innerHTML;
        }
        function prismLang(lang) {
          if (!lang) return 'plaintext';
          var l = lang.toLowerCase();
          var map = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash', shell: 'bash', yml: 'yaml', md: 'markdown', html: 'markup', xml: 'markup', htm: 'markup', jsx: 'javascript', tsx: 'typescript' };
          return map[l] || l || 'plaintext';
        }
        function highlightText(text) {
          if (!text) return '';
          var re = /\{\{([^}]*)\}\}/g;
          var out = '';
          var last = 0;
          var m;
          while ((m = re.exec(text)) !== null) {
            out += escapeHtml(text.slice(last, m.index));
            var name = m[1].trim();
            var color = colorForVar(name);
            out += '<span style="color:' + escapeHtml(color) + '">' + escapeHtml(m[0]) + '</span>';
            last = m.index + m[0].length;
          }
          out += escapeHtml(text.slice(last));
          return out;
        }
        function highlightWithCodeBlocks(text) {
          if (!text) return '';
          var t = String.fromCharCode(96);
          var fenceRe = new RegExp(t + t + t + '([^' + t + '\\n]*)\\n([\\s\\S]*?)' + t + t + t, 'g');
          var out = '';
          var last = 0;
          var m;
          while ((m = fenceRe.exec(text)) !== null) {
            if (m.index > last) {
              out += highlightText(text.slice(last, m.index));
            }
            var lang = prismLang((m[1] || '').trim());
            var code = m[2] || '';
            out += '<pre class="language-' + escapeHtml(lang) + '"><code class="language-' + escapeHtml(lang) + '">' + escapeHtml(code) + '</code></pre>';
            last = m.index + m[0].length;
          }
          if (last < text.length) {
            out += highlightText(text.slice(last));
          }
          return out;
        }
        function inlinePreviewInline(str) {
          if (!str) return '';
          var out = '';
          var pos = 0;
          var t = String.fromCharCode(96);
          var re = new RegExp('(' + t + '[^' + t + ']+' + t + ')|(\\\\*\\\\*[^*]+\\\\*\\\\*)|(\\\\*[^*]+\\\\*)|(__[^_]+__)|(~~[^~]+~~)|(<(a?):([^:]+):(\\\\d+)>)|({{([^}]+)}})', 'g');
          var m;
          while ((m = re.exec(str)) !== null) {
            out += escapeHtml(str.slice(pos, m.index));
            if (m[1]) {
              out += '<code>' + escapeHtml(m[1].slice(1, -1)) + '</code>';
            } else if (m[2]) {
              out += '<strong>' + escapeHtml(m[2].slice(2, -2)) + '</strong>';
            } else if (m[3]) {
              out += '<em>' + escapeHtml(m[3].slice(1, -1)) + '</em>';
            } else if (m[4]) {
              out += '<u>' + escapeHtml(m[4].slice(2, -2)) + '</u>';
            } else if (m[5]) {
              out += '<s>' + escapeHtml(m[5].slice(2, -2)) + '</s>';
            } else if (m[6]) {
              var animated = m[7] === 'a';
              var eid = m[9];
              var ext = animated ? 'gif' : 'png';
              var url = 'https://cdn.discordapp.com/emojis/' + eid + '.' + ext;
              out += '<img src="' + escapeHtml(url) + '" alt="" class="preview-emoji-img" title="' + escapeHtml(m[6]) + '">';
            } else if (m[10]) {
              var vname = m[11].trim();
              var vcolor = colorForVar(vname);
              out += '<span style="color:' + escapeHtml(vcolor) + '">' + escapeHtml(m[10]) + '</span>';
            }
            pos = m.index + m[0].length;
          }
          out += escapeHtml(str.slice(pos));
          return out;
        }
        function wrapLineContent(content) {
          if (content.slice(0, 2) === '> ') {
            return '<span class="preview-blockquote-inline">' + inlinePreviewInline(content.slice(2)) + '</span>';
          }
          return inlinePreviewInline(content);
        }
        function processLines(chunk, parts) {
          var lines = chunk.split('\\n');
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (line.slice(0, 4) === '### ') {
              parts.push('<h3 class="preview-h3">' + wrapLineContent(line.slice(4)) + '</h3>');
            } else if (line.slice(0, 3) === '## ') {
              parts.push('<h2 class="preview-h2">' + wrapLineContent(line.slice(3)) + '</h2>');
            } else if (line.slice(0, 2) === '# ') {
              parts.push('<h1 class="preview-h1">' + wrapLineContent(line.slice(2)) + '</h1>');
            } else if (line.slice(0, 3) === '-# ') {
              parts.push('<div class="preview-bullet">' + inlinePreviewInline(line.slice(3)) + '</div>');
            } else if (line.slice(0, 2) === '> ') {
              parts.push('<div class="preview-blockquote">' + inlinePreviewInline(line.slice(2)) + '</div>');
            } else {
              parts.push('<div class="preview-line">' + inlinePreviewInline(line) + '</div>');
            }
          }
        }
        function previewHtml(text) {
          if (!text) return '';
          var t = String.fromCharCode(96);
          var fenceRe = new RegExp(t + t + t + '([^' + t + '\\n]*)\\n([\\s\\S]*?)' + t + t + t, 'g');
          var parts = [];
          var lastIdx = 0;
          var m;
          while ((m = fenceRe.exec(text)) !== null) {
            if (m.index > lastIdx) {
              processLines(text.slice(lastIdx, m.index), parts);
            }
            var lang = prismLang((m[1] || '').trim());
            var code = (m[2] || '').replace(/\\n$/, '');
            parts.push('<pre class="prism-block language-' + escapeHtml(lang) + '"><code class="language-' + escapeHtml(lang) + '">' + escapeHtml(code) + '</code></pre>');
            lastIdx = m.index + m[0].length;
          }
          if (lastIdx < text.length) {
            processLines(text.slice(lastIdx), parts);
          }
          return parts.join('');
        }
        function updateHighlight() {
          if (!highlightEl || !ta) return;
          highlightEl.innerHTML = highlightWithCodeBlocks(ta.value);
          if (window.Prism) { try { Prism.highlightAllUnder(highlightEl); } catch(e) {} }
        }
        function updatePreview() {
          var el = document.getElementById('prompt-preview');
          if (!el || !ta) return;
          el.innerHTML = previewHtml(ta.value);
          if (window.Prism) { try { Prism.highlightAllUnder(el); } catch(e) {} }
        }
        function syncScroll() {
          if (highlightEl && ta) { highlightEl.scrollTop = ta.scrollTop; highlightEl.scrollLeft = ta.scrollLeft; }
        }
        if (!ta || !form) return;
        var split = document.getElementById('prompt-split');
        if (split) split.classList.remove('preview-minimized');
        updateHighlight();
        updatePreview();
        ta.addEventListener('input', function(){ updateHighlight(); updatePreview(); syncScroll(); });
        ta.addEventListener('blur', updatePreview);
        ta.addEventListener('scroll', syncScroll);
        var dirty = false;
        function markDirty() { dirty = true; }
        function clearDirty() { dirty = false; }
        ta.addEventListener('input', markDirty);
        ta.addEventListener('change', markDirty);
        form.addEventListener('submit', function() { clearDirty(); });
        document.addEventListener('keydown', function(e) {
          if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            if (typeof form.requestSubmit === 'function') form.requestSubmit();
            else form.submit();
          }
        });
        document.getElementById('var-pills') && document.getElementById('var-pills').addEventListener('click', function(e) {
          var btn = e.target.closest('.insert-var');
          if (!btn) return;
          var v = btn.getAttribute('data-var');
          if (!v) return;
          var insert = '{{' + v + '}}';
          var start = ta.selectionStart, end = ta.selectionEnd;
          ta.value = ta.value.slice(0, start) + insert + ta.value.slice(end);
          ta.selectionStart = ta.selectionEnd = start + insert.length;
          ta.focus();
          updateHighlight();
          updatePreview();
          syncScroll();
          markDirty();
        });
        document.getElementById('emoji-pills') && document.getElementById('emoji-pills').addEventListener('click', function(e) {
          var btn = e.target.closest('.insert-emoji');
          if (!btn) return;
          var code = btn.getAttribute('data-code');
          if (!code) return;
          var start = ta.selectionStart, end = ta.selectionEnd;
          ta.value = ta.value.slice(0, start) + code + ta.value.slice(end);
          ta.selectionStart = ta.selectionEnd = start + code.length;
          ta.focus();
          updateHighlight();
          updatePreview();
          syncScroll();
          markDirty();
        });
        var split = document.getElementById('prompt-split');
        var editorCol = document.getElementById('prompt-editor-column');
        var handle = document.getElementById('prompt-split-handle');
        var minimizeBtn = document.getElementById('prompt-minimize-preview-btn');
        var showPreviewBtn = document.getElementById('prompt-show-preview-btn');
        if (minimizeBtn && split) minimizeBtn.addEventListener('click', function() { split.classList.add('preview-minimized'); });
        if (showPreviewBtn && split) showPreviewBtn.addEventListener('click', function() { split.classList.remove('preview-minimized'); });
        if (handle && split && editorCol) {
          handle.addEventListener('mousedown', function(e) {
            e.preventDefault();
            var startX = e.clientX;
            var startWidth = split.offsetWidth;
            var startPct = (editorCol.offsetWidth / startWidth) * 100;
            function onMove(e2) {
              var dx = e2.clientX - startX;
              var pct = startPct + (dx / startWidth) * 100;
              pct = Math.max(20, Math.min(80, pct));
              split.style.setProperty('--editor-width', pct + '%');
            }
            function onUp() {
              document.removeEventListener('mousemove', onMove);
              document.removeEventListener('mouseup', onUp);
              document.body.style.cursor = '';
              document.body.style.userSelect = '';
            }
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
          });
        }
        // Preview is visible by default; user can click Minimize to hide. (Auto-minimize on narrow viewports removed so Preview (Discord) is always visible on load.)
      })();
    </script>
    <script>
    (function(){
      var sidecar = document.getElementById('prompt-version-history-sidecar');
      var listEl = document.getElementById('prompt-version-history-list');
      var openBtns = document.querySelectorAll('.prompt-version-history-open');
      var closeBtn = document.getElementById('prompt-version-history-close');
      if (!sidecar || !listEl || !openBtns.length) return;
      var id = listEl.getAttribute('data-prompt-id');
      if (!id) return;
      var loaded = false;
      var revertConfirmMsg = 'Replace current prompt with this version?';
      var csrfToken = ${JSON.stringify(csrfToken)};
      function esc(s) {
        var div = document.createElement('div');
        div.textContent = s == null ? '' : s;
        return div.innerHTML;
      }
      function loadHistory() {
        if (loaded) return;
        listEl.textContent = 'Loading\u2026';
        var timeout = setTimeout(function() {
          if (listEl.textContent === 'Loading\u2026') listEl.textContent = 'Could not load history.';
        }, 12000);
        var url = '/admin/prompts/' + encodeURIComponent(id) + '/history';
        fetch(url, { credentials: 'same-origin' })
          .then(function(r) {
            if (!r.ok) return [];
            return r.json();
          })
          .then(function(arr) {
            clearTimeout(timeout);
            loaded = true;
            if (!Array.isArray(arr) || arr.length === 0) {
              listEl.textContent = 'No previous versions.';
              return;
            }
            var html = '<ul>';
            for (var i = 0; i < arr.length; i++) {
              var item = arr[i];
              var date = item.lastModified ? new Date(item.lastModified).toLocaleString() : item.key;
              var viewUrl = '/admin/prompts/' + encodeURIComponent(id) + '/history/' + encodeURIComponent(item.key);
              html += '<li>';
              html += '<span class="text-slate-600 dark:text-slate-400">' + esc(date) + '</span>';
              html += '<a href="' + esc(viewUrl) + '" target="_blank" rel="noopener" class="text-emerald-600 hover:text-emerald-700 dark:text-emerald-400">View</a>';
              html += '<form method="post" action="/admin/prompts/' + encodeURIComponent(id) + '/revert" class="inline">';
              html += '<input type="hidden" name="_csrf" value="' + esc(csrfToken) + '">';
              html += '<input type="hidden" name="versionKey" value="' + esc(item.key) + '">';
              html += '<button type="submit" class="text-amber-600 hover:text-amber-700 dark:text-amber-400" onclick="return confirm(&quot;Replace current prompt with this version?&quot;);">Revert</button>';
              html += '</form>';
              html += '</li>';
            }
            html += '</ul>';
            listEl.innerHTML = html;
          })
          .catch(function() {
            clearTimeout(timeout);
            loaded = true;
            listEl.textContent = 'Could not load history.';
          });
      }
      function openSidecar() {
        sidecar.classList.add('open');
        sidecar.setAttribute('aria-hidden', 'false');
        loadHistory();
      }
      for (var i = 0; i < openBtns.length; i++) openBtns[i].addEventListener('click', openSidecar);
      if (closeBtn) closeBtn.addEventListener('click', function() {
        sidecar.classList.remove('open');
        sidecar.setAttribute('aria-hidden', 'true');
      });
    })();
    </script>
  `)}
  <div id="prompt-action-bar" class="save-bar border-t border-slate-200 dark:border-slate-700 shadow-[0_-4px_16px_rgba(0,0,0,0.08)]" data-save-bar-key="prompts">
    <div class="save-bar-inner max-w-4xl mx-auto px-4">
      <div class="save-bar-content">
        <div id="prompt-unsaved-placeholder" class="text-slate-400 text-sm"></div>
        <div class="flex flex-wrap items-center gap-2">
          <span class="save-bar-hint text-slate-400 text-xs hidden sm:inline">Ctrl+S to save</span>
          <button type="submit" form="prompt-form" class="rounded-lg bg-emerald-600 text-white font-medium py-2 px-4 text-sm hover:bg-emerald-700 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 transition-colors">Save to S3</button>
          <button type="button" class="prompt-version-history-open rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 font-medium py-2 px-4 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700">Version history</button>
          <a href="/admin/prompts" class="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 font-medium py-2 px-4 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 inline-block">Cancel</a>
        </div>
      </div>
      ${saveBarToggleButton()}
    </div>
  </div>
  ${saveBarMinimizeScript('prompt-action-bar', 'prompts')}
`;
    return `<!DOCTYPE html>
<html lang="en">
<head>${adminHead('Edit ' + id)}</head>
<body class="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">${content}${PRISM_TAIL}</body>
</html>`;
}

export { router as promptRoutes };
