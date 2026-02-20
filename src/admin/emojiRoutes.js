/**
 * Admin routes for Discord emoji library. State in S3 (admin/discord-emojis.json) and local data/discord-emojis.json.
 */
import express from 'express';
import {
    getEmojiLibrary,
    saveEmojiLibrary,
    EMOJIS_PATH,
    fetchEmojisFromS3,
    putEmojisToS3
} from '../shared/emojiSync.js';
import fs from 'fs';
import { adminHead, adminNav, adminContainer, breadcrumb, escapeHtml, s3Badge } from './layout.js';

const router = express.Router();

function emojiCodeToUrl(code) {
    const m = code && code.match(/<(a?):([^:]+):(\d+)>/);
    if (!m) return null;
    const ext = m[1] === 'a' ? 'gif' : 'png';
    return `https://cdn.discordapp.com/emojis/${m[3]}.${ext}`;
}

router.get('/', async (req, res) => {
    let list = getEmojiLibrary();
    let s3InUse = false;
    try {
        const fromS3 = await fetchEmojisFromS3();
        if (fromS3 != null && fromS3.trim()) {
            const data = JSON.parse(fromS3);
            if (Array.isArray(data) && data.length > 0) {
                list = data.filter((e) => e && typeof e.label === 'string' && typeof e.code === 'string');
                fs.writeFileSync(EMOJIS_PATH, JSON.stringify(list, null, 2), 'utf8');
                s3InUse = true;
            }
        }
    } catch (_) {
        // fall back to local
    }
    const saved = req.query.saved === '1';
    const rowsHtml = list
        .map(({ label, code }) => {
            const url = emojiCodeToUrl(code);
            const img = url
                ? `<img src="${escapeHtml(url)}" alt="" class="inline-block h-6 w-6 object-contain rounded" loading="lazy">`
                : '';
            return `
        <tr class="emoji-row border-b border-slate-200 hover:bg-slate-50/50">
          <td class="py-2 px-3 w-10 align-middle">${img}</td>
          <td class="py-2 px-3"><input type="text" class="label-input w-full rounded border border-slate-300 px-2 py-1.5 text-sm" value="${escapeHtml(label)}" placeholder="e.g. Navi bullet" /></td>
          <td class="py-2 px-3"><input type="text" class="code-input w-full rounded border border-slate-300 px-2 py-1.5 text-sm font-mono" value="${escapeHtml(code)}" placeholder="<:name:id>" /></td>
          <td class="py-2 px-3 w-20"><button type="button" class="delete-emoji-row text-sm text-slate-500 hover:text-red-600 font-medium">Remove</button></td>
        </tr>`;
        })
        .join('');
    const content = `
  ${adminNav('emojis')}
  ${adminContainer(`
    ${breadcrumb([{ href: '/admin', label: 'Dashboard' }, { label: 'Emojis' }])}
    <div class="flex items-center gap-2 mb-2">
      <h1 class="text-2xl font-semibold text-slate-800">Discord emoji library</h1>
      ${s3InUse ? s3Badge() : ''}
    </div>
    <p class="text-slate-600 text-sm mb-6">Custom emojis you can insert in prompts (e.g. <code class="font-mono text-xs bg-slate-100 px-1 rounded">&lt;:6symbolnavi:1341400385709019138&gt;</code>). Used in the prompt editor. Save to S3 to persist.</p>
    ${saved ? '<div class="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm px-4 py-3 mb-6">Saved to S3.</div>' : ''}
    <form id="emojis-form" method="post" action="/admin/emojis" class="space-y-6">
      <textarea id="emojis-body" name="body" class="hidden" aria-hidden="true"></textarea>
      <div class="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <table class="w-full text-sm">
          <thead><tr class="bg-slate-50 border-b border-slate-200"><th class="text-left py-3 px-3 w-10"></th><th class="text-left py-3 px-3 font-semibold text-slate-700">Label</th><th class="text-left py-3 px-3 font-semibold text-slate-700">Code</th><th class="w-20"></th></tr></thead>
          <tbody id="emojis-tbody">${rowsHtml}</tbody>
        </table>
      </div>
      <div class="flex flex-wrap items-end gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50/50">
        <div>
          <label for="new-label" class="block text-sm font-medium text-slate-700 mb-1">New label</label>
          <input type="text" id="new-label" class="rounded border border-slate-300 px-3 py-2 text-sm w-40" placeholder="e.g. Navi bullet" />
        </div>
        <div>
          <label for="new-code" class="block text-sm font-medium text-slate-700 mb-1">Code</label>
          <input type="text" id="new-code" class="rounded border border-slate-300 px-3 py-2 text-sm w-72 font-mono" placeholder="<:name:id> or <a:name:id>" />
        </div>
        <button type="button" id="add-emoji-row-btn" class="rounded-lg border border-slate-300 bg-white font-medium py-2 px-4 text-sm text-slate-700 hover:bg-slate-100">Add row</button>
      </div>
      <div class="flex flex-wrap gap-3">
        <button type="submit" class="rounded-lg bg-emerald-600 text-white font-medium py-2.5 px-5 hover:bg-emerald-700 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 transition-colors">Save to S3</button>
        <a href="/admin" class="rounded-lg border border-slate-300 bg-white font-medium py-2.5 px-5 text-slate-700 hover:bg-slate-50 inline-block">Back to dashboard</a>
      </div>
    </form>
    <script>
(function(){
  var form = document.getElementById('emojis-form');
  var tbody = document.getElementById('emojis-tbody');
  var bodyInput = document.getElementById('emojis-body');
  var newLabel = document.getElementById('new-label');
  var newCode = document.getElementById('new-code');
  var addBtn = document.getElementById('add-emoji-row-btn');
  function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function codeToUrl(code) {
    var m = (code || '').match(/<(a?):([^:]+):(\\d+)>/);
    return m ? 'https://cdn.discordapp.com/emojis/' + m[3] + '.' + (m[1] === 'a' ? 'gif' : 'png') : null;
  }
  function addRow(label, code) {
    var url = codeToUrl(code);
    var img = url ? '<img src="' + esc(url) + '" alt="" class="inline-block h-6 w-6 object-contain rounded" loading="lazy">' : '';
    var tr = document.createElement('tr');
    tr.className = 'emoji-row border-b border-slate-200 hover:bg-slate-50/50';
    tr.innerHTML = '<td class="py-2 px-3 w-10 align-middle">' + img + '</td><td class="py-2 px-3"><input type="text" class="label-input w-full rounded border border-slate-300 px-2 py-1.5 text-sm" value="' + esc(label) + '" placeholder="e.g. Navi bullet" /></td><td class="py-2 px-3"><input type="text" class="code-input w-full rounded border border-slate-300 px-2 py-1.5 text-sm font-mono" value="' + esc(code) + '" placeholder="<:name:id>" /></td><td class="py-2 px-3 w-20"><button type="button" class="delete-emoji-row text-sm text-slate-500 hover:text-red-600 font-medium">Remove</button></td>';
    tbody.appendChild(tr);
    tr.querySelector('.delete-emoji-row').addEventListener('click', function() { tr.remove(); });
  }
  addBtn.addEventListener('click', function() {
    var label = (newLabel.value || '').trim();
    var code = (newCode.value || '').trim();
    if (!label || !code) return;
    addRow(label, code);
    newLabel.value = '';
    newCode.value = '';
    newLabel.focus();
  });
  tbody.addEventListener('click', function(e) {
    if (e.target.classList.contains('delete-emoji-row')) e.target.closest('tr').remove();
  });
  form.addEventListener('submit', function(e) {
    e.preventDefault();
    var list = [];
    var rows = tbody.querySelectorAll('tr');
    for (var i = 0; i < rows.length; i++) {
      var label = (rows[i].querySelector('.label-input').value || '').trim();
      var code = (rows[i].querySelector('.code-input').value || '').trim();
      if (label && code) list.push({ label: label, code: code });
    }
    bodyInput.value = JSON.stringify(list, null, 2);
    form.submit();
  });
})();
    </script>
  `)}
`;
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>${adminHead('Emojis')}</head>
<body class="min-h-screen bg-slate-50 text-slate-900">${content}</body>
</html>`);
});

router.post('/', express.urlencoded({ extended: true }), async (req, res) => {
    const raw = (req.body && req.body.body) || '[]';
    let list;
    try {
        const data = JSON.parse(raw);
        list = Array.isArray(data) ? data.filter((e) => e && typeof e.label === 'string' && typeof e.code === 'string') : [];
    } catch (_) {
        return res.redirect('/admin/emojis');
    }
    try {
        saveEmojiLibrary(list);
        await putEmojisToS3(JSON.stringify(list, null, 2));
        return res.redirect('/admin/emojis?saved=1');
    } catch (err) {
        console.error('Admin emojis save:', err);
        const msg = (err && err.message) || '';
        const saveError = msg.toLowerCase().includes('credential')
            ? 'S3 credentials missing or invalid.'
            : 'Could not save to S3. Check .env (AWS_*, S3_BUCKET_NAME).';
        const rowsHtml = list
            .map(({ label, code }) => {
                const url = emojiCodeToUrl(code);
                const img = url ? `<img src="${escapeHtml(url)}" alt="" class="inline-block h-6 w-6 object-contain rounded" loading="lazy">` : '';
                return `<tr class="emoji-row border-b border-slate-200"><td class="py-2 px-3 w-10 align-middle">${img}</td><td class="py-2 px-3"><input type="text" class="label-input w-full rounded border border-slate-300 px-2 py-1.5 text-sm" value="${escapeHtml(label)}" /></td><td class="py-2 px-3"><input type="text" class="code-input w-full rounded border border-slate-300 px-2 py-1.5 text-sm font-mono" value="${escapeHtml(code)}" /></td><td class="py-2 px-3 w-20"><button type="button" class="delete-emoji-row text-sm text-slate-500 hover:text-red-600">Remove</button></td></tr>`;
            })
            .join('');
        const content = `
  ${adminNav('emojis')}
  ${adminContainer(`
    ${breadcrumb([{ href: '/admin', label: 'Dashboard' }, { label: 'Emojis' }])}
    <h1 class="text-2xl font-semibold text-slate-800 mb-2">Discord emoji library</h1>
    <div class="rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 mb-6">${escapeHtml(saveError)}</div>
    <form id="emojis-form" method="post" action="/admin/emojis">
      <textarea id="emojis-body" name="body" class="hidden">${escapeHtml(raw)}</textarea>
      <div class="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <table class="w-full text-sm">
          <thead><tr class="bg-slate-50 border-b border-slate-200"><th class="text-left py-3 px-3 w-10"></th><th class="text-left py-3 px-3 font-semibold text-slate-700">Label</th><th class="text-left py-3 px-3 font-semibold text-slate-700">Code</th><th class="w-20"></th></tr></thead>
          <tbody id="emojis-tbody">${rowsHtml}</tbody>
        </table>
      </div>
      <div class="flex gap-3 mt-4">
        <button type="submit" class="rounded-lg bg-emerald-600 text-white font-medium py-2.5 px-5">Save to S3</button>
        <a href="/admin/emojis" class="rounded-lg border border-slate-300 bg-white font-medium py-2.5 px-5 text-slate-700 inline-block">Cancel</a>
      </div>
    </form>
    <script>
(function(){
  var tbody = document.getElementById('emojis-tbody');
  tbody.addEventListener('click', function(e) {
    if (e.target.classList.contains('delete-emoji-row')) e.target.closest('tr').remove();
  });
  document.getElementById('emojis-form').addEventListener('submit', function(e) {
    e.preventDefault();
    var list = [];
    var rows = tbody.querySelectorAll('tr');
    for (var i = 0; i < rows.length; i++) {
      var label = (rows[i].querySelector('.label-input').value || '').trim();
      var code = (rows[i].querySelector('.code-input').value || '').trim();
      if (label && code) list.push({ label: label, code: code });
    }
    document.getElementById('emojis-body').value = JSON.stringify(list, null, 2);
    e.target.submit();
  });
})();
    </script>
  `)}
`;
        res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>${adminHead('Emojis')}</head>
<body class="min-h-screen bg-slate-50 text-slate-900">${content}</body>
</html>`);
    }
});

export { router as emojiRoutes };
