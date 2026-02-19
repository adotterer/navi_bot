/**
 * Admin routes for editing prompt templates. Uses promptLoader.
 */
import express from 'express';
import { getPromptTemplate, savePromptTemplate, getPromptMeta, listPromptIds, resetPromptToDefault } from '../shared/promptLoader.js';
import { adminHead, adminNav, adminContainer, breadcrumb, escapeHtml } from './layout.js';

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        const ids = listPromptIds();
        const list = ids.map(id => {
            const meta = getPromptMeta(id);
            return { id, ...meta };
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
        const body = await getPromptTemplate(id);
        const saved = req.query.saved === '1';
        const reset = req.query.reset === '1';
        res.send(promptEditPage(id, meta, body, { saved, reset }));
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
            ({ id, description }) => `
        <tr class="border-b border-slate-200 hover:bg-slate-50/80">
          <td class="py-3 pr-4"><a href="/admin/prompts/${escapeHtml(id)}" class="font-medium text-emerald-600 hover:text-emerald-700">${escapeHtml(id)}</a></td>
          <td class="py-3 text-slate-600 text-sm">${escapeHtml(description)}</td>
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
        <thead><tr class="bg-slate-50 border-b border-slate-200"><th class="text-left py-3 px-4 text-sm font-semibold text-slate-700">Prompt ID</th><th class="text-left py-3 px-4 text-sm font-semibold text-slate-700">Description</th></tr></thead>
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
    const varPills = variables
        .map((v) => {
            const name = typeof v === 'string' ? v : v.name;
            const desc = typeof v === 'string' ? '' : (v.description || '');
            return `<button type="button" class="insert-var rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-mono text-slate-700 hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-800 transition-colors" data-var="${escapeHtml(name)}" title="${escapeHtml(desc)}">&#123;&#123;${escapeHtml(name)}&#125;&#125;</button>`;
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
    <h1 class="text-2xl font-semibold text-slate-800 mb-1">${escapeHtml(id)}</h1>
    <p class="text-slate-600 text-sm mb-6">${escapeHtml(meta.description)}</p>
    ${savedBanner}
    ${resetBanner}
    ${saveErrorBanner}
    ${varsSection}
    <form method="post" action="/admin/prompts/${escapeHtml(id)}" class="space-y-4">
      <div>
        <label for="prompt-body" class="block text-sm font-medium text-slate-700 mb-2">Template body</label>
        <textarea id="prompt-body" name="body" rows="28" class="w-full font-mono text-sm rounded-xl border border-slate-300 px-4 py-3 text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none resize-y min-h-[320px]" placeholder="Prompt text with {{variables}}...">${escapeHtml(body)}</textarea>
      </div>
      <div class="flex flex-wrap gap-3">
        <button type="submit" class="rounded-lg bg-emerald-600 text-white font-medium py-2.5 px-5 hover:bg-emerald-700 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 transition-colors">Save to S3</button>
        <a href="/admin/prompts" class="rounded-lg border border-slate-300 bg-white font-medium py-2.5 px-5 text-slate-700 hover:bg-slate-50 focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 transition-colors inline-block">Cancel</a>
      </div>
    </form>
    <form method="post" action="/admin/prompts/${escapeHtml(id)}/reset" class="mt-6 pt-6 border-t border-slate-200">
      <button type="submit" class="text-sm text-slate-500 hover:text-amber-600 font-medium" onclick="return confirm('Restore the built-in default for this prompt?');">Reset to default</button>
    </form>
    <script>
      (function(){
        var ta = document.getElementById('prompt-body');
        if (!ta) return;
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
        });
      })();
    </script>
  `)}
`;
    return `<!DOCTYPE html>
<html lang="en">
<head>${adminHead('Edit ' + id)}</head>
<body class="min-h-screen bg-slate-50 text-slate-900">${content}</body>
</html>`;
}

export { router as promptRoutes };
