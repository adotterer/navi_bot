/**
 * Admin routes for editing stats and framedata CSVs. Uses dataReader.
 */
import express from 'express';
import {
    listStatsFiles,
    getStatsCSVRaw,
    putStatsCSV,
    clearStatsCache,
    listFramedataCharacters,
    listFramedataSections,
    getFramedataCSVRaw,
    putFramedataCSV,
    clearFramedataCache
} from '../shared/dataReader.js';
import { adminHead, adminNav, adminContainer, breadcrumb, escapeHtml, s3Badge, saveBarToggleButton, saveBarMinimizeScript } from './layout.js';
import { headS3Key, deleteFromS3 } from '../shared/s3Helper.js';
import { generateCsrfToken } from './csrf.js';

const S3_STATS_PREFIX = 'admin/data/stats/';
const S3_FRAMEDATA_PREFIX = 'admin/data/framedata/';

const router = express.Router();

// GET /admin/data – choose Stats or Framedata
router.get('/', (req, res) => {
    const content = `
  ${adminNav('data')}
  ${adminContainer(`
    ${breadcrumb([{ href: '/admin', label: 'Dashboard' }, { label: 'Data' }])}
    <h1 class="text-2xl font-semibold text-slate-800 dark:text-slate-100 mb-6">Edit data</h1>
    <div class="grid gap-4 sm:grid-cols-2">
      <a href="/admin/data/stats" class="block rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm hover:border-emerald-200 dark:hover:border-emerald-800 hover:shadow-md transition-all group">
        <h2 class="text-lg font-semibold text-slate-800 dark:text-slate-100 group-hover:text-emerald-700 dark:group-hover:text-emerald-400">Stats CSVs</h2>
        <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">Weight, air-speed, reflectors, etc.</p>
        <span class="mt-3 inline-block text-sm font-medium text-emerald-600 group-hover:text-emerald-700 dark:group-hover:text-emerald-400">Open →</span>
      </a>
      <a href="/admin/data/framedata" class="block rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm hover:border-emerald-200 dark:hover:border-emerald-800 hover:shadow-md transition-all group">
        <h2 class="text-lg font-semibold text-slate-800 dark:text-slate-100 group-hover:text-emerald-700 dark:group-hover:text-emerald-400">Framedata CSVs</h2>
        <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">Per-character move data.</p>
        <span class="mt-3 inline-block text-sm font-medium text-emerald-600 group-hover:text-emerald-700 dark:group-hover:text-emerald-400">Open →</span>
      </a>
    </div>
  `)}
`;
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>${adminHead('Data')}</head>
<body class="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">${content}</body>
</html>`);
});

// ----- Stats -----
router.get('/stats', async (req, res) => {
    const files = listStatsFiles();
    const s3Flags = await Promise.all(files.map(f => headS3Key(S3_STATS_PREFIX + f + '.csv').catch(() => false)));
    const rows = files
        .map(
            (f, i) => `
        <tr class="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50/80 dark:hover:bg-slate-800/50">
          <td class="py-3 px-4"><a href="/admin/data/stats/${encodeURIComponent(f)}" class="font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400">${escapeHtml(f)}</a></td>
          <td class="py-3 px-4">${s3Flags[i] ? s3Badge() : ''}</td>
        </tr>`
        )
        .join('');
    const content = `
  ${adminNav('data')}
  ${adminContainer(`
    ${breadcrumb([{ href: '/admin', label: 'Dashboard' }, { href: '/admin/data', label: 'Data' }, { label: 'Stats' }])}
    <h1 class="text-2xl font-semibold text-slate-800 dark:text-slate-100 mb-6">Stats CSVs</h1>
    <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden shadow-sm">
      <table class="w-full">
        <thead><tr class="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700"><th class="text-left py-3 px-4 text-sm font-semibold text-slate-700 dark:text-slate-300">File</th><th class="text-left py-3 px-4 text-sm font-semibold text-slate-700 dark:text-slate-300 w-16"></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `)}
`;
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>${adminHead('Stats')}</head>
<body class="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">${content}</body>
</html>`);
});

router.get('/stats/:filename', async (req, res) => {
    const filename = req.params.filename.replace(/\.csv$/i, '');
    try {
        const [raw, s3InUse] = await Promise.all([
            getStatsCSVRaw(filename),
            headS3Key(S3_STATS_PREFIX + filename + '.csv').catch(() => false)
        ]);
        if (raw == null) return res.status(404).send('File not found.');
        const saved = req.query.saved === '1';
        const reverted = req.query.reverted === '1';
        const revertError = req.query.revert_error === '1';
        const csrfToken = generateCsrfToken(req, res);
        res.send(csvEditPage('stats', raw, saved, 'Stats – ' + filename, filename, null, s3InUse, csrfToken, reverted, revertError));
    } catch (err) {
        console.error('Admin stats get:', err);
        res.status(500).send('Error loading file.');
    }
});

router.post('/stats/:filename', express.urlencoded({ extended: true }), async (req, res) => {
    const filename = req.params.filename.replace(/\.csv$/i, '');
    const body = (req.body && req.body.body) != null ? req.body.body : '';
    try {
        await putStatsCSV(filename, body);
        clearStatsCache(filename);
        res.redirect(`/admin/data/stats/${encodeURIComponent(filename)}?saved=1`);
    } catch (err) {
        console.error('Admin stats save:', err);
        res.status(500).send('Error saving file.');
    }
});

router.post('/stats/:filename/revert-to-disk', express.urlencoded({ extended: true }), async (req, res) => {
    const filename = req.params.filename.replace(/\.csv$/i, '');
    const redirectUrl = `/admin/data/stats/${encodeURIComponent(filename)}`;
    try {
        const key = S3_STATS_PREFIX + filename + '.csv';
        await deleteFromS3(key);
        clearStatsCache(filename);
        res.redirect(redirectUrl + '?reverted=1');
    } catch (err) {
        console.error('Admin stats revert-to-disk:', err);
        res.redirect(redirectUrl + '?revert_error=1');
    }
});

// ----- Framedata -----
router.get('/framedata', (req, res) => {
    const chars = listFramedataCharacters();
    const rows = chars
        .map(
            (c) => `
        <tr class="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50/80 dark:hover:bg-slate-800/50">
          <td class="py-3 px-4"><a href="/admin/data/framedata/${encodeURIComponent(c)}" class="font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400">${escapeHtml(c)}</a></td>
        </tr>`
        )
        .join('');
    const content = `
  ${adminNav('data')}
  ${adminContainer(`
    ${breadcrumb([{ href: '/admin', label: 'Dashboard' }, { href: '/admin/data', label: 'Data' }, { label: 'Framedata' }])}
    <h1 class="text-2xl font-semibold text-slate-800 dark:text-slate-100 mb-6">Framedata by character</h1>
    <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden shadow-sm">
      <table class="w-full">
        <thead><tr class="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700"><th class="text-left py-3 px-4 text-sm font-semibold text-slate-700 dark:text-slate-300">Character</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `)}
`;
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>${adminHead('Framedata')}</head>
<body class="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">${content}</body>
</html>`);
});

router.get('/framedata/:character', async (req, res) => {
    const character = req.params.character;
    const sections = listFramedataSections(character);
    const s3Flags = await Promise.all(sections.map(s => headS3Key(S3_FRAMEDATA_PREFIX + character + '/' + s + '.csv').catch(() => false)));
    const rows = sections
        .map(
            (s, i) => `
        <tr class="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50/80 dark:hover:bg-slate-800/50">
          <td class="py-3 px-4"><a href="/admin/data/framedata/${encodeURIComponent(character)}/${encodeURIComponent(s)}" class="font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400">${escapeHtml(s)}</a></td>
          <td class="py-3 px-4">${s3Flags[i] ? s3Badge() : ''}</td>
        </tr>`
        )
        .join('');
    const content = `
  ${adminNav('data')}
  ${adminContainer(`
    ${breadcrumb([{ href: '/admin', label: 'Dashboard' }, { href: '/admin/data', label: 'Data' }, { href: '/admin/data/framedata', label: 'Framedata' }, { label: character }])}
    <h1 class="text-2xl font-semibold text-slate-800 dark:text-slate-100 mb-6">${escapeHtml(character)}</h1>
    <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden shadow-sm">
      <table class="w-full">
        <thead><tr class="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700"><th class="text-left py-3 px-4 text-sm font-semibold text-slate-700 dark:text-slate-300">Section</th><th class="text-left py-3 px-4 text-sm font-semibold text-slate-700 dark:text-slate-300 w-16"></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `)}
`;
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>${adminHead(character)}</head>
<body class="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">${content}</body>
</html>`);
});

router.get('/framedata/:character/:section', async (req, res) => {
    const { character, section } = req.params;
    const sectionClean = section.replace(/\.csv$/i, '');
    try {
        const [raw, s3InUse] = await Promise.all([
            getFramedataCSVRaw(character, sectionClean),
            headS3Key(S3_FRAMEDATA_PREFIX + character + '/' + sectionClean + '.csv').catch(() => false)
        ]);
        if (raw == null) return res.status(404).send('File not found.');
        const saved = req.query.saved === '1';
        const reverted = req.query.reverted === '1';
        const revertError = req.query.revert_error === '1';
        const csrfToken = generateCsrfToken(req, res);
        res.send(csvEditPage('framedata', raw, saved, `Framedata: ${character} / ${sectionClean}`, character, sectionClean, s3InUse, csrfToken, reverted, revertError));
    } catch (err) {
        console.error('Admin framedata get:', err);
        res.status(500).send('Error loading file.');
    }
});

router.post('/framedata/:character/:section', express.urlencoded({ extended: true }), async (req, res) => {
    const { character, section } = req.params;
    const sectionClean = section.replace(/\.csv$/i, '');
    const body = (req.body && req.body.body) != null ? req.body.body : '';
    try {
        await putFramedataCSV(character, sectionClean, body);
        clearFramedataCache(character);
        res.redirect(`/admin/data/framedata/${encodeURIComponent(character)}/${encodeURIComponent(sectionClean)}?saved=1`);
    } catch (err) {
        console.error('Admin framedata save:', err);
        res.status(500).send('Error saving file.');
    }
});

router.post('/framedata/:character/:section/revert-to-disk', express.urlencoded({ extended: true }), async (req, res) => {
    const { character, section } = req.params;
    const sectionClean = section.replace(/\.csv$/i, '');
    const redirectUrl = `/admin/data/framedata/${encodeURIComponent(character)}/${encodeURIComponent(sectionClean)}`;
    try {
        const key = S3_FRAMEDATA_PREFIX + character + '/' + sectionClean + '.csv';
        await deleteFromS3(key);
        clearFramedataCache(character);
        res.redirect(redirectUrl + '?reverted=1');
    } catch (err) {
        console.error('Admin framedata revert-to-disk:', err);
        res.redirect(redirectUrl + '?revert_error=1');
    }
});

function csvEditPage(type, body, saved, title, param1, param2, s3InUse = false, csrfToken = '', reverted = false, revertError = false) {
    const backUrl =
        type === 'stats' ? '/admin/data/stats' : '/admin/data/framedata' + (param1 ? '/' + encodeURIComponent(param1) : '');
    const saveAction =
        type === 'stats'
            ? `/admin/data/stats/${encodeURIComponent(param1)}`
            : `/admin/data/framedata/${encodeURIComponent(param1)}/${encodeURIComponent(param2)}`;
    const breadcrumbItems =
        type === 'stats'
            ? [
                { href: '/admin', label: 'Dashboard' },
                { href: '/admin/data', label: 'Data' },
                { href: '/admin/data/stats', label: 'Stats' },
                { label: param1 },
            ]
            : [
                { href: '/admin', label: 'Dashboard' },
                { href: '/admin/data', label: 'Data' },
                { href: '/admin/data/framedata', label: 'Framedata' },
                { href: '/admin/data/framedata/' + encodeURIComponent(param1), label: param1 },
                { label: param2 },
            ];
    const savedBanner = saved
        ? '<div class="rounded-lg bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-400 text-sm px-4 py-3 mb-6">Saved. Bot will use this content (S3 override).</div>'
        : '';
    const revertedBanner = reverted
        ? '<div class="rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-400 text-sm px-4 py-3 mb-6">Reverted to disk. S3 override removed; content below is from local file.</div>'
        : '';
    const revertErrorBanner = revertError
        ? '<div class="rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-400 text-sm px-4 py-3 mb-6">Could not revert (delete from S3 failed). Check AWS credentials and try again.</div>'
        : '';
    const csrfInput = csrfToken ? `<input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">` : '';
    const content = `
  ${adminNav('data')}
  ${adminContainer(`
    <div class="csv-edit-layout flex flex-col min-h-[calc(100vh-11rem)]">
      <div class="flex-shrink-0 mb-4">
        ${breadcrumb(breadcrumbItems)}
        <div class="flex items-center gap-2 mt-1">
      <h1 class="text-xl font-semibold text-slate-800 dark:text-slate-100">${escapeHtml(title)}</h1>
      ${s3InUse ? s3Badge() : ''}
    </div>
        <p class="text-slate-600 dark:text-slate-400 text-sm mt-1">Edit cells below; click <strong>Save to S3</strong> to upload.</p>
        ${savedBanner}
        ${revertedBanner}
        ${revertErrorBanner}
      </div>
      <form id="csv-form" method="post" action="${saveAction}" class="flex flex-1 flex-col min-h-0 flex-shrink-0 admin-save-bar-spacer">
        ${csrfInput}
        <textarea id="csv-body" name="body" hidden aria-hidden="true"></textarea>
        <div id="csv-spreadsheet-wrap" class="flex-1 min-h-0 min-w-0 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm ring-1 ring-slate-200/50 dark:ring-slate-600/50">
          <table id="csv-grid" class="csv-grid border-collapse"></table>
        </div>
      </form>
    </div>
    <style>
      main:has(.csv-edit-layout) { max-width: 85rem; }
      .csv-edit-layout { padding: 0 0.5rem; }
      #csv-body { display: none !important; }
      #csv-spreadsheet-wrap { min-height: 12rem; overflow-x: auto; overflow-y: auto; }
      .csv-grid { font-size: 0.8125rem; width: max-content; min-width: 100%; }
      .csv-grid td { border: 1px solid #cbd5e1; padding: 0.2rem 0.3rem; max-width: 9rem; }
      .csv-grid td.cell-narrow { max-width: 4.25rem; min-width: 3rem; }
      .csv-grid .cell-move-name { max-width: 10rem; }
      .csv-grid .cell-input, .csv-grid .cell-textarea { border: 1px solid #e2e8f0; border-radius: 3px; padding: 0.2rem 0.3rem; }
      .csv-grid .cell-input:focus, .csv-grid .cell-textarea:focus { border-color: #10b981; box-shadow: 0 0 0 1px #10b981; outline: none; }
      .csv-grid .cell-textarea { resize: vertical; min-height: 2.25rem; word-wrap: break-word; white-space: pre-wrap; }
      .csv-grid td .cell-input, .csv-grid td .cell-textarea { min-height: 1.5rem; }
      .csv-grid td.cell-notes { min-width: 180px; max-width: 280px; }
      .csv-grid .cell-gif { min-width: 90px; max-width: 120px; }
      .csv-grid .cell-gif img { max-width: 80px; height: auto; display: block; border-radius: 3px; border: 1px solid #e2e8f0; }
      .csv-grid .cell-gif .gif-url-input { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.7rem; padding: 0.2rem 0.3rem; }
      .csv-grid .cell-gif .gif-filename { font-size: 0.7rem; color: #64748b; margin-top: 2px; }
      .csv-grid .cell-move-name span { padding: 0.125rem 0; }
      .csv-grid tbody tr:first-child td span { padding: 0.25rem 0.375rem; padding-left: calc(0.375rem + 1px); }
      #csv-action-bar { position: fixed; bottom: 0; left: 0; right: 0; z-index: 50; }
      .dark #csv-spreadsheet-wrap .csv-grid td { border-color: #475569; }
      .dark #csv-spreadsheet-wrap .csv-grid .cell-input, .dark #csv-spreadsheet-wrap .csv-grid .cell-textarea { border-color: #475569; background: #334155; color: #f1f5f9; }
      .dark #csv-spreadsheet-wrap .csv-grid .cell-input:focus, .dark #csv-spreadsheet-wrap .csv-grid .cell-textarea:focus { border-color: #10b981; box-shadow: 0 0 0 1px #10b981; }
      .dark #csv-spreadsheet-wrap .csv-grid tbody tr:first-child td { background: #1e293b; border-color: #475569; }
      .dark #csv-spreadsheet-wrap .csv-grid .cell-gif img { border-color: #475569; }
      .dark #csv-spreadsheet-wrap .csv-grid .cell-gif .gif-filename { color: #94a3b8; }
    </style>
    <script>
(function(){
  var rawText = ${JSON.stringify(body).replace(/<(?=\/script)/gi, '\\u003c')};
  var form = document.getElementById('csv-form');
  var gridEl = document.getElementById('csv-grid');
  var textarea = document.getElementById('csv-body');
  var dirty = false;

  var headerAbbrev = {
    'Move Name': 'Move', 'Total Frames': 'Tot Frames', 'Landing Lag': 'Land Lag', 'Base Damage': 'Damage',
    'Shield Lag': 'Sh Lag', 'Shield Stun': 'Sh Stun', 'Active Frames': 'Active', 'Property 1': 'Prop 1',
    'On Shield': 'On Sh', 'GIF URL': 'GIF', 'End Lag': 'End Lag'
  };
  var narrowHeaders = { 'Total Frames': 1, 'Landing Lag': 1, 'Startup': 1, 'Base Damage': 1, 'Shield Lag': 1, 'Shield Stun': 1, 'Active Frames': 1, 'Property 1': 1, 'Property 2': 1, 'On Shield': 1, 'End Lag': 1 };
  function isNarrowColumn(header) {
    if (!header) return false;
    var h = header.trim();
    return narrowHeaders[h] || (h.length <= 4 && /^[A-Za-z0-9\\s]+$/.test(h));
  }
  function abbrevHeader(t) {
    if (!t) return '';
    var s = (headerAbbrev[t] != null) ? headerAbbrev[t] : t;
    return s.length > 14 ? s.slice(0, 12) + '…' : s;
  }
  // Full move name (as in CSV) -> short display label. CSV value is unchanged.
  var moveDisplayAbbrev = {
    'Jab': 'Jab', 'Rapid Jab': 'R.Jab', 'Rapid Jab Finisher': 'R.Jab Fin.',
    'Forward Tilt': 'FTilt', 'Up Tilt': 'UTilt', 'Down Tilt': 'DTilt',
    'Forward Smash': 'FSmash', 'Up Smash': 'USmash', 'Down Smash': 'DSmash',
    'Dash Attack': 'DAtk', 'Neutral Air': 'NAir', 'Forward Air': 'FAir', 'Back Air': 'BAir', 'Backward Air': 'BAir',
    'Up Air': 'UAir', 'Down Air': 'DAir', 'Z Air': 'ZAir',
    'Neutral B': 'N-B', 'Side B': 'Side-B', 'Up B': 'Up-B', 'Down B': 'Down-B',
    'Grab': 'Grab', 'Dash Grab': 'D.Grab', 'Pivot Grab': 'Pivot', 'Pummel': 'Pummel',
    'Forward Throw': 'FThrow', 'Backward Throw': 'BThrow', 'Up Throw': 'UThrow', 'Down Throw': 'DThrow'
  };
  function moveDisplayName(fullName) {
    if (!fullName) return '';
    var key = fullName.trim();
    return moveDisplayAbbrev[key] != null ? moveDisplayAbbrev[key] : (key.length > 14 ? key.slice(0, 12) + '…' : key);
  }

  function simpleParse(text) {
    var lines = text.split(/\\r?\\n/);
    var rows = [];
    for (var i = 0; i < lines.length; i++) {
      var row = [], line = lines[i], f = '', q = false;
      for (var j = 0; j <= line.length; j++) {
        var c = line[j];
        if (q) {
          if (c === '"') { if (line[j+1] === '"') { f += '"'; j++; } else q = false; }
          else f += c;
          continue;
        }
        if (c === '"') { q = true; continue; }
        if (c === ',' || c === undefined) { row.push(f); f = ''; continue; }
        f += c;
      }
      rows.push(row);
    }
    return rows;
  }

  function escapeCSV(val) {
    if (val == null) return '';
    var s = String(val);
    if (/[",\\n\\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function getCellValue(td) {
    var hidden = td.querySelector('input[type="hidden"]');
    if (hidden) return hidden.value;
    var inp = td.querySelector('input, textarea');
    return inp ? inp.value : '';
  }

  function gridToCSV() {
    var trs = gridEl.querySelectorAll('tbody tr');
    if (!trs.length) return '';
    var maxCols = trs[1] ? trs[1].querySelectorAll('td').length : (rows[0] || []).length;
    var headerRow = (rows[0] || []).slice();
    while (headerRow.length < maxCols) headerRow.push('');
    var result = [];
    result.push(headerRow.map(escapeCSV).join(','));
    for (var r = 1; r < trs.length; r++) {
      var cells = trs[r].querySelectorAll('td');
      var row = [];
      for (var c = 0; c < cells.length; c++) row.push(getCellValue(cells[c]));
      result.push(row.map(escapeCSV).join(','));
    }
    return result.join('\\n');
  }

  function isUrlLike(s) {
    return typeof s === 'string' && /^https?:\\/\\//i.test(s.trim());
  }
  function filenameFromUrl(url) {
    if (!url || typeof url !== 'string') return '';
    var u = url.trim();
    var last = u.split('/').pop();
    return last || u;
  }
  function markDirty() { dirty = true; }
  function clearDirty() {
    dirty = false;
  }

  function renderGrid(rows) {
    gridEl.innerHTML = '';
    var tbody = gridEl.appendChild(document.createElement('tbody'));
    if (!rows.length) {
      var tr = tbody.insertRow();
      tr.innerHTML = '<td><input type="text" class="cell-input w-full min-w-[52px] bg-transparent" placeholder="Cell"></td>';
      return;
    }
    var maxCols = Math.max.apply(null, rows.map(function(r) { return r.length; }));
    var headers = rows[0].map(function(h) { return (h || '').trim(); });
    for (var r = 0; r < rows.length; r++) {
      var tr = tbody.insertRow();
      tr.className = r === 0 ? 'bg-slate-100 dark:bg-slate-800 sticky top-0' : 'hover:bg-slate-50/50 dark:hover:bg-slate-700/50';
      for (var c = 0; c < maxCols; c++) {
        var td = tr.insertCell();
        td.className = r === 0 ? 'border-slate-200 dark:border-slate-600 sticky top-0 bg-slate-100 dark:bg-slate-800 z-10' : 'align-top';
        var rawVal = rows[r][c] != null ? rows[r][c] : '';
        var header = (headers[c] || '').toLowerCase();
        var isNotes = header.indexOf('notes') !== -1;
        var isGif = header.indexOf('gif') !== -1 && (header.indexOf('url') !== -1 || header === 'gif');
        var isMoveName = header.indexOf('move') !== -1 && header.indexOf('name') !== -1;

        if (r === 0) {
          if (isNarrowColumn(headers[c])) td.classList.add('cell-narrow');
          var label = document.createElement('span');
          label.className = 'font-semibold text-slate-700 dark:text-slate-200 block';
          label.textContent = abbrevHeader(headers[c]);
          label.title = headers[c] || '';
          td.appendChild(label);
          continue;
        }

        if (isGif) {
          td.classList.add('cell-gif');
          var gifVal = rawVal.trim();
          if (isUrlLike(gifVal)) {
            var img = document.createElement('img');
            img.src = gifVal;
            img.alt = 'GIF';
            img.onerror = function() { this.style.display = 'none'; };
            td.appendChild(img);
          }
          var fnSpan = document.createElement('div');
          fnSpan.className = 'gif-filename';
          fnSpan.textContent = gifVal ? filenameFromUrl(gifVal) : '';
          fnSpan.title = gifVal || '';
          td.appendChild(fnSpan);
          var inp = document.createElement('input');
          inp.type = 'text';
          inp.value = rawVal;
          inp.className = 'cell-input gif-url-input w-full min-w-0 mt-1';
          inp.placeholder = 'Paste GIF URL';
          inp.title = rawVal || 'GIF URL';
          inp.addEventListener('input', markDirty);
          inp.addEventListener('blur', function() { fnSpan.textContent = filenameFromUrl(inp.value); fnSpan.title = inp.value; });
          td.appendChild(inp);
          continue;
        }

        if (isNotes) {
          td.classList.add('cell-notes');
          var ta = document.createElement('textarea');
          ta.value = rawVal;
          ta.rows = 3;
          ta.className = 'cell-textarea w-full min-w-0 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100';
          ta.addEventListener('input', markDirty);
          td.appendChild(ta);
          continue;
        }

        if (isMoveName) {
          td.classList.add('cell-move-name');
          var moveHidden = document.createElement('input');
          moveHidden.type = 'hidden';
          moveHidden.value = rawVal;
          td.appendChild(moveHidden);
          var moveSpan = document.createElement('span');
          moveSpan.className = 'block text-slate-700 dark:text-slate-300';
          moveSpan.textContent = moveDisplayName(rawVal);
          moveSpan.title = rawVal || '';
          td.appendChild(moveSpan);
          continue;
        }

        if (isNarrowColumn(headers[c])) td.classList.add('cell-narrow');
        var single = document.createElement('input');
        single.type = 'text';
        single.value = rawVal;
        single.className = 'cell-input w-full min-w-0 bg-transparent';
        single.addEventListener('input', markDirty);
        td.appendChild(single);
      }
    }
  }

  var rows = simpleParse(rawText);
  renderGrid(rows);

  gridEl.addEventListener('input', markDirty);
  gridEl.addEventListener('change', markDirty);
  form.addEventListener('submit', function(e) {
    e.preventDefault();
    clearDirty();
    textarea.value = gridToCSV();
    form.submit();
  });
  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else { clearDirty(); textarea.value = gridToCSV(); form.submit(); }
    }
  });
})();
    </script>
  `)}
  <div id="csv-action-bar" class="save-bar border-t border-slate-200 dark:border-slate-700 shadow-[0_-4px_16px_rgba(0,0,0,0.08)]" data-save-bar-key="csv">
    <div class="save-bar-inner max-w-[85rem] mx-auto px-4">
      <div class="save-bar-content">
        <div id="csv-unsaved-reminder-placeholder" class="text-slate-400 text-sm"></div>
        <div class="flex flex-wrap items-center gap-2">
          <span class="save-bar-hint text-slate-400 text-xs hidden sm:inline">Ctrl+S to save</span>
          <button type="submit" form="csv-form" class="rounded-lg bg-emerald-600 text-white font-medium py-2.5 px-5 hover:bg-emerald-700 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 transition-colors">Save to S3</button>
          <a href="${backUrl}" class="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 font-medium py-2.5 px-5 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-600 inline-block">Cancel</a>
          ${s3InUse ? `
          <form method="post" action="${saveAction}/revert-to-disk" class="inline-block" onsubmit="return confirm('Remove S3 override and load content from disk?');">
            ${csrfInput}
            <button type="submit" class="rounded-lg border border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/40 font-medium py-2.5 px-5 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/60 inline-block">Revert to disk</button>
          </form>` : ''}
        </div>
      </div>
      ${saveBarToggleButton()}
    </div>
  </div>
  ${saveBarMinimizeScript('csv-action-bar', 'csv')}
`;
    return `<!DOCTYPE html>
<html lang="en">
<head>${adminHead(escapeHtml(title))}</head>
<body class="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">${content}</body>
</html>`;
}

export { router as dataRoutes };
