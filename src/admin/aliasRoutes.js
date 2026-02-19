/**
 * Admin routes for managing character aliases. State is stored in S3 (admin/character-aliases.json)
 * and synced to local file so the bot uses it without restart.
 */
import express from 'express';
import fs from 'fs';
import { getNicknameAliases } from '../matchups/characterAliases.js';
import { ALIASES_PATH, fetchAliasesFromS3, putAliasesToS3 } from '../shared/aliasSync.js';
import { adminHead, adminNav, adminContainer, breadcrumb, escapeHtml, s3Badge } from './layout.js';

const router = express.Router();

router.get('/', async (req, res) => {
    let aliases = {};
    let s3InUse = false;
    try {
        const fromS3 = await fetchAliasesFromS3();
        if (fromS3 != null && fromS3.trim()) {
            const data = JSON.parse(fromS3);
            if (data && typeof data === 'object' && !Array.isArray(data)) {
                fs.writeFileSync(ALIASES_PATH, JSON.stringify(data, null, 2), 'utf8');
                aliases = data;
                s3InUse = true;
            }
        }
    } catch (_) {
        // ignore S3 errors, fall back to local
    }
    if (Object.keys(aliases).length === 0) {
        aliases = getNicknameAliases();
    }
    const entries = Object.entries(aliases).sort((a, b) => a[0].localeCompare(b[0], 'en', { sensitivity: 'base' }));
    const saved = req.query.saved === '1';
    const rowsHtml = entries
        .map(([alias, canonical]) => `
        <tr class="alias-row border-b border-slate-200 hover:bg-slate-50/50">
          <td class="py-2 px-3"><input type="text" class="alias-input w-full rounded border border-slate-300 px-2 py-1.5 text-sm" value="${escapeHtml(alias)}" placeholder="e.g. palu" /></td>
          <td class="py-2 px-3"><input type="text" class="canonical-input w-full rounded border border-slate-300 px-2 py-1.5 text-sm" value="${escapeHtml(canonical)}" placeholder="e.g. palutena" /></td>
          <td class="py-2 px-3 w-20"><button type="button" class="delete-row text-sm text-slate-500 hover:text-red-600 font-medium">Remove</button></td>
        </tr>`)
        .join('');
    const content = `
  ${adminNav('aliases')}
  ${adminContainer(`
    ${breadcrumb([{ href: '/admin', label: 'Dashboard' }, { label: 'Aliases' }])}
    <div class="flex items-center gap-2 mb-2">
      <h1 class="text-2xl font-semibold text-slate-800">Character aliases</h1>
      ${s3InUse ? s3Badge() : ''}
    </div>
    <p class="text-slate-600 text-sm mb-6">Add nicknames or shortcuts that resolve to a character (e.g. <strong>palu</strong> → <strong>palutena</strong>). Used by !mu, !fd, and !aliases. Click <strong>Save to S3</strong> when done.</p>
    ${saved ? '<div class="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm px-4 py-3 mb-6">Saved to S3.</div>' : ''}
    <form id="aliases-form" method="post" action="/admin/aliases" class="space-y-6">
      <textarea id="aliases-body" name="body" class="hidden" aria-hidden="true"></textarea>
      <div class="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <table class="w-full text-sm">
          <thead><tr class="bg-slate-50 border-b border-slate-200"><th class="text-left py-3 px-3 font-semibold text-slate-700">Alias (what users type)</th><th class="text-left py-3 px-3 font-semibold text-slate-700">Maps to (canonical character)</th><th class="w-20"></th></tr></thead>
          <tbody id="aliases-tbody">${rowsHtml}</tbody>
        </table>
      </div>
      <div class="flex flex-wrap items-end gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50/50">
        <div>
          <label for="new-alias" class="block text-sm font-medium text-slate-700 mb-1">New alias</label>
          <input type="text" id="new-alias" class="rounded border border-slate-300 px-3 py-2 text-sm w-48" placeholder="e.g. pika" />
        </div>
        <div>
          <label for="new-canonical" class="block text-sm font-medium text-slate-700 mb-1">Maps to</label>
          <input type="text" id="new-canonical" class="rounded border border-slate-300 px-3 py-2 text-sm w-48" placeholder="e.g. pikachu" />
        </div>
        <button type="button" id="add-row-btn" class="rounded-lg border border-slate-300 bg-white font-medium py-2 px-4 text-sm text-slate-700 hover:bg-slate-100">Add row</button>
      </div>
      <div class="flex flex-wrap gap-3">
        <button type="submit" class="rounded-lg bg-emerald-600 text-white font-medium py-2.5 px-5 hover:bg-emerald-700 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 transition-colors">Save to S3</button>
        <a href="/admin" class="rounded-lg border border-slate-300 bg-white font-medium py-2.5 px-5 text-slate-700 hover:bg-slate-50 inline-block">Back to dashboard</a>
      </div>
    </form>
    <details class="mt-8">
      <summary class="text-sm text-slate-500 cursor-pointer hover:text-slate-700">Advanced: edit as JSON</summary>
      <textarea id="aliases-json-fallback" rows="12" class="mt-2 w-full font-mono text-sm rounded border border-slate-300 px-3 py-2 text-slate-900" placeholder="Raw JSON (for power users)"></textarea>
      <p class="text-xs text-slate-500 mt-1">Changes here are not saved unless you replace the table and save. Use the table above for normal editing.</p>
    </details>
    <script>
(function(){
  var form = document.getElementById('aliases-form');
  var tbody = document.getElementById('aliases-tbody');
  var bodyInput = document.getElementById('aliases-body');
  var newAlias = document.getElementById('new-alias');
  var newCanonical = document.getElementById('new-canonical');
  var addBtn = document.getElementById('add-row-btn');
  var jsonFallback = document.getElementById('aliases-json-fallback');

  function addRow(alias, canonical) {
    var tr = document.createElement('tr');
    tr.className = 'alias-row border-b border-slate-200 hover:bg-slate-50/50';
    var esc = function(s) { return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
    tr.innerHTML = '<td class="py-2 px-3"><input type="text" class="alias-input w-full rounded border border-slate-300 px-2 py-1.5 text-sm" value="' + esc(alias) + '" placeholder="e.g. palu" /></td><td class="py-2 px-3"><input type="text" class="canonical-input w-full rounded border border-slate-300 px-2 py-1.5 text-sm" value="' + esc(canonical) + '" placeholder="e.g. palutena" /></td><td class="py-2 px-3 w-20"><button type="button" class="delete-row text-sm text-slate-500 hover:text-red-600 font-medium">Remove</button></td>';
    tbody.appendChild(tr);
    tr.querySelector('.delete-row').addEventListener('click', function() { tr.remove(); });
  }
  addBtn.addEventListener('click', function() {
    var a = (newAlias.value || '').trim();
    var c = (newCanonical.value || '').trim();
    if (!a || !c) return;
    addRow(a, c);
    newAlias.value = '';
    newCanonical.value = '';
    newAlias.focus();
  });
  tbody.addEventListener('click', function(e) {
    if (e.target.classList.contains('delete-row')) e.target.closest('tr').remove();
  });
  form.addEventListener('submit', function(e) {
    e.preventDefault();
    var obj = {};
    var rows = tbody.querySelectorAll('tr');
    for (var i = 0; i < rows.length; i++) {
      var alias = (rows[i].querySelector('.alias-input').value || '').trim();
      var canonical = (rows[i].querySelector('.canonical-input').value || '').trim();
      if (alias && canonical) obj[alias] = canonical;
    }
    bodyInput.value = JSON.stringify(obj, null, 2);
    form.submit();
  });
  jsonFallback.addEventListener('blur', function() {
    try {
      var data = JSON.parse(jsonFallback.value);
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        tbody.innerHTML = '';
        Object.entries(data).sort(function(a,b) { return a[0].localeCompare(b[0]); }).forEach(function(pair) { addRow(pair[0], pair[1]); });
      }
    } catch (_) {}
  });
  document.querySelector('details').addEventListener('toggle', function() {
    if (jsonFallback.value) return;
    var obj = {};
    tbody.querySelectorAll('tr').forEach(function(tr) {
      var a = (tr.querySelector('.alias-input').value || '').trim();
      var c = (tr.querySelector('.canonical-input').value || '').trim();
      if (a && c) obj[a] = c;
    });
    jsonFallback.value = JSON.stringify(obj, null, 2);
  });
})();
    </script>
  `)}
`;
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>${adminHead('Aliases')}</head>
<body class="min-h-screen bg-slate-50 text-slate-900">${content}</body>
</html>`);
});

router.post('/', express.urlencoded({ extended: true }), async (req, res) => {
    const raw = req.body?.body ?? '';
    let data;
    try {
        data = JSON.parse(raw);
    } catch (_) {
        return res.status(400).send(renderAliasesTablePage({}, 'Invalid JSON.'));
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        return res.status(400).send(renderAliasesTablePage({}, 'JSON must be an object (alias → canonical).'));
    }
    const normalized = {};
    for (const [k, v] of Object.entries(data)) {
        if (k == null || v == null) continue;
        const alias = String(k).trim();
        const canonical = String(v).trim();
        if (alias && canonical) {
            normalized[alias] = canonical;
        }
    }
    const jsonString = JSON.stringify(normalized, null, 2);
    try {
        await putAliasesToS3(jsonString);
        fs.writeFileSync(ALIASES_PATH, jsonString, 'utf8');
    } catch (err) {
        console.error('Admin aliases save:', err);
        const msg = (err && err.message) || '';
        const saveError = msg.toLowerCase().includes('credential')
            ? 'S3 credentials are missing or invalid. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env.'
            : 'Could not save to S3. Check .env (AWS_*, S3_BUCKET_NAME) and try again.';
        return res.status(500).send(renderAliasesTablePage(normalized, saveError));
    }
    res.redirect('/admin/aliases?saved=1');
});

function renderAliasesTablePage(aliases, error, s3InUse = false) {
    const entries = Object.entries(aliases).sort((a, b) => a[0].localeCompare(b[0], 'en', { sensitivity: 'base' }));
    const rowsHtml = entries
        .map(([alias, canonical]) => `
        <tr class="alias-row border-b border-slate-200 hover:bg-slate-50/50">
          <td class="py-2 px-3"><input type="text" class="alias-input w-full rounded border border-slate-300 px-2 py-1.5 text-sm" value="${escapeHtml(alias)}" placeholder="e.g. palu" /></td>
          <td class="py-2 px-3"><input type="text" class="canonical-input w-full rounded border border-slate-300 px-2 py-1.5 text-sm" value="${escapeHtml(canonical)}" placeholder="e.g. palutena" /></td>
          <td class="py-2 px-3 w-20"><button type="button" class="delete-row text-sm text-slate-500 hover:text-red-600 font-medium">Remove</button></td>
        </tr>`)
        .join('');
    const content = `
  ${adminNav('aliases')}
  ${adminContainer(`
    ${breadcrumb([{ href: '/admin', label: 'Dashboard' }, { label: 'Aliases' }])}
    <div class="flex items-center gap-2 mb-2">
      <h1 class="text-2xl font-semibold text-slate-800">Character aliases</h1>
      ${s3InUse ? s3Badge() : ''}
    </div>
    <p class="text-slate-600 text-sm mb-6">Add nicknames or shortcuts that resolve to a character. Click <strong>Save to S3</strong> when done.</p>
    ${error ? `<div class="rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 mb-6">${escapeHtml(error)}</div>` : ''}
    <form id="aliases-form" method="post" action="/admin/aliases" class="space-y-6">
      <textarea id="aliases-body" name="body" class="hidden" aria-hidden="true"></textarea>
      <div class="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <table class="w-full text-sm">
          <thead><tr class="bg-slate-50 border-b border-slate-200"><th class="text-left py-3 px-3 font-semibold text-slate-700">Alias (what users type)</th><th class="text-left py-3 px-3 font-semibold text-slate-700">Maps to (canonical character)</th><th class="w-20"></th></tr></thead>
          <tbody id="aliases-tbody">${rowsHtml}</tbody>
        </table>
      </div>
      <div class="flex flex-wrap items-end gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50/50">
        <div>
          <label for="new-alias" class="block text-sm font-medium text-slate-700 mb-1">New alias</label>
          <input type="text" id="new-alias" class="rounded border border-slate-300 px-3 py-2 text-sm w-48" placeholder="e.g. pika" />
        </div>
        <div>
          <label for="new-canonical" class="block text-sm font-medium text-slate-700 mb-1">Maps to</label>
          <input type="text" id="new-canonical" class="rounded border border-slate-300 px-3 py-2 text-sm w-48" placeholder="e.g. pikachu" />
        </div>
        <button type="button" id="add-row-btn" class="rounded-lg border border-slate-300 bg-white font-medium py-2 px-4 text-sm text-slate-700 hover:bg-slate-100">Add row</button>
      </div>
      <div class="flex flex-wrap gap-3">
        <button type="submit" class="rounded-lg bg-emerald-600 text-white font-medium py-2.5 px-5 hover:bg-emerald-700 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 transition-colors">Save to S3</button>
        <a href="/admin" class="rounded-lg border border-slate-300 bg-white font-medium py-2.5 px-5 text-slate-700 hover:bg-slate-50 inline-block">Back to dashboard</a>
      </div>
    </form>
    <details class="mt-8">
      <summary class="text-sm text-slate-500 cursor-pointer hover:text-slate-700">Advanced: edit as JSON</summary>
      <textarea id="aliases-json-fallback" rows="12" class="mt-2 w-full font-mono text-sm rounded border border-slate-300 px-3 py-2 text-slate-900"></textarea>
    </details>
    <script>
(function(){
  var form = document.getElementById('aliases-form');
  var tbody = document.getElementById('aliases-tbody');
  var bodyInput = document.getElementById('aliases-body');
  var newAlias = document.getElementById('new-alias');
  var newCanonical = document.getElementById('new-canonical');
  var addBtn = document.getElementById('add-row-btn');
  var jsonFallback = document.getElementById('aliases-json-fallback');
  function addRow(alias, canonical) {
    var tr = document.createElement('tr');
    tr.className = 'alias-row border-b border-slate-200 hover:bg-slate-50/50';
    var esc = function(s) { return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
    tr.innerHTML = '<td class="py-2 px-3"><input type="text" class="alias-input w-full rounded border border-slate-300 px-2 py-1.5 text-sm" value="' + esc(alias) + '" placeholder="e.g. palu" /></td><td class="py-2 px-3"><input type="text" class="canonical-input w-full rounded border border-slate-300 px-2 py-1.5 text-sm" value="' + esc(canonical) + '" placeholder="e.g. palutena" /></td><td class="py-2 px-3 w-20"><button type="button" class="delete-row text-sm text-slate-500 hover:text-red-600 font-medium">Remove</button></td>';
    tbody.appendChild(tr);
    tr.querySelector('.delete-row').addEventListener('click', function() { tr.remove(); });
  }
  addBtn.addEventListener('click', function() {
    var a = (newAlias.value || '').trim();
    var c = (newCanonical.value || '').trim();
    if (!a || !c) return;
    addRow(a, c);
    newAlias.value = '';
    newCanonical.value = '';
    newAlias.focus();
  });
  tbody.addEventListener('click', function(e) {
    if (e.target.classList.contains('delete-row')) e.target.closest('tr').remove();
  });
  form.addEventListener('submit', function(e) {
    e.preventDefault();
    var obj = {};
    var rows = tbody.querySelectorAll('tr');
    for (var i = 0; i < rows.length; i++) {
      var alias = (rows[i].querySelector('.alias-input').value || '').trim();
      var canonical = (rows[i].querySelector('.canonical-input').value || '').trim();
      if (alias && canonical) obj[alias] = canonical;
    }
    bodyInput.value = JSON.stringify(obj, null, 2);
    form.submit();
  });
  jsonFallback.addEventListener('blur', function() {
    try {
      var data = JSON.parse(jsonFallback.value);
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        tbody.innerHTML = '';
        Object.entries(data).sort(function(a,b) { return a[0].localeCompare(b[0]); }).forEach(function(pair) { addRow(pair[0], pair[1]); });
      }
    } catch (_) {}
  });
  document.querySelector('details').addEventListener('toggle', function() {
    if (jsonFallback.value) return;
    var obj = {};
    tbody.querySelectorAll('tr').forEach(function(tr) {
      var a = (tr.querySelector('.alias-input').value || '').trim();
      var c = (tr.querySelector('.canonical-input').value || '').trim();
      if (a && c) obj[a] = c;
    });
    jsonFallback.value = JSON.stringify(obj, null, 2);
  });
})();
    </script>
  `)}
`;
    return `<!DOCTYPE html>
<html lang="en">
<head>${adminHead('Aliases')}</head>
<body class="min-h-screen bg-slate-50 text-slate-900">${content}</body>
</html>`;
}

export { router as aliasRoutes };
