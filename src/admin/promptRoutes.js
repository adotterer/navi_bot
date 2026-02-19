/**
 * Admin routes for editing prompt templates. Uses promptLoader.
 */
import express from 'express';
import { getPromptTemplate, savePromptTemplate, getPromptMeta, listPromptIds, resetPromptToDefault } from '../shared/promptLoader.js';
import { adminHead, adminNav, adminContainer, breadcrumb, escapeHtml, s3Badge } from './layout.js';
import { headS3Key } from '../shared/s3Helper.js';

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
        res.send(promptEditPage(id, meta, body, { saved, reset, s3InUse }));
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
            res.status(200).send(promptEditPage(id, meta, body, { saveError }));
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
        <tr class="border-b border-slate-200 hover:bg-slate-50/80">
          <td class="py-3 px-4"><a href="/admin/prompts/${escapeHtml(id)}" class="font-medium text-emerald-600 hover:text-emerald-700">${escapeHtml(id)}</a></td>
          <td class="py-3 text-slate-600 text-sm px-4">${escapeHtml(description)}</td>
          <td class="py-3 px-4">${s3InUse ? s3Badge() : ''}</td>
        </tr>`
        )
        .join('');
    const content = `
  ${adminNav('prompts')}
  ${adminContainer(`
    ${breadcrumb([{ href: '/admin', label: 'Dashboard' }, { label: 'Prompts' }])}
    <h1 class="text-2xl font-semibold text-slate-800 mb-2">Edit prompts</h1>
    <p class="text-slate-600 text-sm mb-6">Variables use <code class="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">&#123;&#123;name&#125;&#125;</code>. Don't remove or rename variables.</p>
    <div class="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
      <table class="w-full">
        <thead><tr class="bg-slate-50 border-b border-slate-200"><th class="text-left py-3 px-4 text-sm font-semibold text-slate-700">Prompt ID</th><th class="text-left py-3 px-4 text-sm font-semibold text-slate-700">Description</th><th class="text-left py-3 px-4 text-sm font-semibold text-slate-700 w-16"></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `)}
`;
    return `<!DOCTYPE html>
<html lang="en">
<head>${adminHead('Prompts')}</head>
<body class="min-h-screen bg-slate-50 text-slate-900">${content}</body>
</html>`;
}

function promptEditPage(id, meta, body, opts = {}) {
    const variables = meta.variables || [];
    const pillColors = ['rebeccapurple', 'coral', 'darkcyan', 'mediumseagreen', 'darkorange', 'mediumpurple', 'steelblue', 'indianred', 'teal', 'chocolate'];
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
    <div class="mb-6 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
      <p class="text-sm font-medium text-slate-700 mb-2">Insert variable at cursor</p>
      <div class="flex flex-wrap gap-2" id="var-pills">${varPills}</div>
    </div>`
            : '';
    const savedBanner = opts.saved
        ? '<div class="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm px-4 py-3 mb-6">Saved. The bot will use this template on the next request.</div>'
        : '';
    const resetBanner = opts.reset
        ? '<div class="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-3 mb-6">Reset to default. Template restored from built-in.</div>'
        : '';
    const saveErrorBanner = opts.saveError
        ? `<div class="rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 mb-6">${escapeHtml(opts.saveError)}</div>`
        : '';
    const content = `
  ${adminNav('prompts')}
  ${adminContainer(`
    ${breadcrumb([{ href: '/admin', label: 'Dashboard' }, { href: '/admin/prompts', label: 'Prompts' }, { label: id }])}
    <div class="flex items-center gap-2 mb-1">
      <h1 class="text-2xl font-semibold text-slate-800">${escapeHtml(id)}</h1>
      ${opts.s3InUse ? s3Badge() : ''}
    </div>
    <p class="text-slate-600 text-sm mb-6">${escapeHtml(meta.description)}</p>
    ${savedBanner}
    ${resetBanner}
    ${saveErrorBanner}
    ${varsSection}
    <div class="pb-20">
      <form id="prompt-form" method="post" action="/admin/prompts/${escapeHtml(id)}" class="space-y-4">
        <div>
          <label for="prompt-body" class="block text-sm font-medium text-slate-700 mb-2">Template body</label>
          <textarea id="prompt-body" name="body" rows="28" class="w-full font-mono text-sm rounded-xl border border-slate-300 px-4 py-3 text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none resize-y min-h-[320px]" placeholder="Prompt text with {{variables}}...">${escapeHtml(body)}</textarea>
        </div>
      </form>
      <form method="post" action="/admin/prompts/${escapeHtml(id)}/reset" class="mt-6 pt-6 border-t border-slate-200">
        <button type="submit" class="text-sm text-slate-500 hover:text-amber-600 font-medium" onclick="return confirm('Restore the built-in default for this prompt?');">Reset to default</button>
      </form>
    </div>
    <style>
      #prompt-action-bar { position: fixed; bottom: 0; left: 0; right: 0; z-index: 50; }
    </style>
    <script>
      (function(){
        var ta = document.getElementById('prompt-body');
        var form = document.getElementById('prompt-form');
        if (!ta || !form) return;
        var unsavedReminder = document.getElementById('prompt-unsaved-reminder');
        var dirty = false;
        function markDirty() { dirty = true; if (unsavedReminder) unsavedReminder.classList.remove('hidden'); }
        function clearDirty() { dirty = false; if (unsavedReminder) unsavedReminder.classList.add('hidden'); }
        function showReminder() { if (dirty && unsavedReminder) unsavedReminder.classList.remove('hidden'); }
        ta.addEventListener('input', markDirty);
        ta.addEventListener('change', markDirty);
        ta.addEventListener('blur', showReminder);
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
          markDirty();
        });
      })();
    </script>
  `)}
  <div id="prompt-action-bar" class="bg-white border-t border-slate-200 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] pb-[env(safe-area-inset-bottom)]">
    <div class="max-w-4xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
      <div id="prompt-unsaved-reminder" class="text-amber-700 text-sm font-medium hidden">Unsaved changes</div>
      <div id="prompt-unsaved-placeholder" class="text-slate-400 text-sm"></div>
      <div class="flex flex-wrap items-center gap-3">
        <span class="text-slate-400 text-xs hidden sm:inline">Ctrl+S to save</span>
        <button type="submit" form="prompt-form" class="rounded-lg bg-emerald-600 text-white font-medium py-2.5 px-5 hover:bg-emerald-700 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 transition-colors">Save to S3</button>
        <a href="/admin/prompts" class="rounded-lg border border-slate-300 bg-white font-medium py-2.5 px-5 text-slate-700 hover:bg-slate-50 inline-block">Cancel</a>
      </div>
    </div>
  </div>
`;
    return `<!DOCTYPE html>
<html lang="en">
<head>${adminHead('Edit ' + id)}</head>
<body class="min-h-screen bg-slate-50 text-slate-900">${content}</body>
</html>`;
}

export { router as promptRoutes };
