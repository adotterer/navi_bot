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
import { adminHead, adminNav, adminContainer, breadcrumb, escapeHtml } from './layout.js';

const router = express.Router();

// GET /admin/data – choose Stats or Framedata
router.get('/', (req, res) => {
    const content = `
  ${adminNav('data')}
  ${adminContainer(`
    ${breadcrumb([{ href: '/admin', label: 'Dashboard' }, { label: 'Data' }])}
    <h1 class="text-2xl font-semibold text-slate-800 mb-6">Edit data</h1>
    <div class="grid gap-4 sm:grid-cols-2">
      <a href="/admin/data/stats" class="block rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:border-emerald-200 hover:shadow-md transition-all group">
        <h2 class="text-lg font-semibold text-slate-800 group-hover:text-emerald-700">Stats CSVs</h2>
        <p class="mt-2 text-sm text-slate-500">Weight, air-speed, reflectors, etc.</p>
        <span class="mt-3 inline-block text-sm font-medium text-emerald-600 group-hover:text-emerald-700">Open →</span>
      </a>
      <a href="/admin/data/framedata" class="block rounded-xl border border-slate-200 bg-white p-6 shadow-sm hover:border-emerald-200 hover:shadow-md transition-all group">
        <h2 class="text-lg font-semibold text-slate-800 group-hover:text-emerald-700">Framedata CSVs</h2>
        <p class="mt-2 text-sm text-slate-500">Per-character move data.</p>
        <span class="mt-3 inline-block text-sm font-medium text-emerald-600 group-hover:text-emerald-700">Open →</span>
      </a>
    </div>
  `)}
`;
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>${adminHead('Data')}</head>
<body class="min-h-screen bg-slate-50 text-slate-900">${content}</body>
</html>`);
});

// ----- Stats -----
router.get('/stats', (req, res) => {
    const files = listStatsFiles();
    const rows = files
        .map(
            (f) => `
        <tr class="border-b border-slate-200 hover:bg-slate-50/80">
          <td class="py-3 px-4"><a href="/admin/data/stats/${encodeURIComponent(f)}" class="font-medium text-emerald-600 hover:text-emerald-700">${escapeHtml(f)}</a></td>
        </tr>`
        )
        .join('');
    const content = `
  ${adminNav('data')}
  ${adminContainer(`
    ${breadcrumb([{ href: '/admin', label: 'Dashboard' }, { href: '/admin/data', label: 'Data' }, { label: 'Stats' }])}
    <h1 class="text-2xl font-semibold text-slate-800 mb-6">Stats CSVs</h1>
    <div class="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
      <table class="w-full">
        <thead><tr class="bg-slate-50 border-b border-slate-200"><th class="text-left py-3 px-4 text-sm font-semibold text-slate-700">File</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `)}
`;
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>${adminHead('Stats')}</head>
<body class="min-h-screen bg-slate-50 text-slate-900">${content}</body>
</html>`);
});

router.get('/stats/:filename', async (req, res) => {
    const filename = req.params.filename.replace(/\.csv$/i, '');
    try {
        const raw = await getStatsCSVRaw(filename);
        if (raw == null) return res.status(404).send('File not found.');
        const saved = req.query.saved === '1';
        res.send(csvEditPage('stats', raw, saved, 'Stats – ' + filename, filename, null));
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

// ----- Framedata -----
router.get('/framedata', (req, res) => {
    const chars = listFramedataCharacters();
    const rows = chars
        .map(
            (c) => `
        <tr class="border-b border-slate-200 hover:bg-slate-50/80">
          <td class="py-3 px-4"><a href="/admin/data/framedata/${encodeURIComponent(c)}" class="font-medium text-emerald-600 hover:text-emerald-700">${escapeHtml(c)}</a></td>
        </tr>`
        )
        .join('');
    const content = `
  ${adminNav('data')}
  ${adminContainer(`
    ${breadcrumb([{ href: '/admin', label: 'Dashboard' }, { href: '/admin/data', label: 'Data' }, { label: 'Framedata' }])}
    <h1 class="text-2xl font-semibold text-slate-800 mb-6">Framedata by character</h1>
    <div class="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
      <table class="w-full">
        <thead><tr class="bg-slate-50 border-b border-slate-200"><th class="text-left py-3 px-4 text-sm font-semibold text-slate-700">Character</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `)}
`;
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>${adminHead('Framedata')}</head>
<body class="min-h-screen bg-slate-50 text-slate-900">${content}</body>
</html>`);
});

router.get('/framedata/:character', (req, res) => {
    const character = req.params.character;
    const sections = listFramedataSections(character);
    const rows = sections
        .map(
            (s) => `
        <tr class="border-b border-slate-200 hover:bg-slate-50/80">
          <td class="py-3 px-4"><a href="/admin/data/framedata/${encodeURIComponent(character)}/${encodeURIComponent(s)}" class="font-medium text-emerald-600 hover:text-emerald-700">${escapeHtml(s)}</a></td>
        </tr>`
        )
        .join('');
    const content = `
  ${adminNav('data')}
  ${adminContainer(`
    ${breadcrumb([{ href: '/admin', label: 'Dashboard' }, { href: '/admin/data', label: 'Data' }, { href: '/admin/data/framedata', label: 'Framedata' }, { label: character }])}
    <h1 class="text-2xl font-semibold text-slate-800 mb-6">${escapeHtml(character)}</h1>
    <div class="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
      <table class="w-full">
        <thead><tr class="bg-slate-50 border-b border-slate-200"><th class="text-left py-3 px-4 text-sm font-semibold text-slate-700">Section</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `)}
`;
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>${adminHead(character)}</head>
<body class="min-h-screen bg-slate-50 text-slate-900">${content}</body>
</html>`);
});

router.get('/framedata/:character/:section', async (req, res) => {
    const { character, section } = req.params;
    const sectionClean = section.replace(/\.csv$/i, '');
    try {
        const raw = await getFramedataCSVRaw(character, sectionClean);
        if (raw == null) return res.status(404).send('File not found.');
        const saved = req.query.saved === '1';
        res.send(csvEditPage('framedata', raw, saved, `Framedata: ${character} / ${sectionClean}`, character, sectionClean));
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

function csvEditPage(type, body, saved, title, param1, param2) {
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
        ? '<div class="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm px-4 py-3 mb-6">Saved. Bot will use this content (S3 override).</div>'
        : '';
    const content = `
  ${adminNav('data')}
  ${adminContainer(`
    ${breadcrumb(breadcrumbItems)}
    <h1 class="text-2xl font-semibold text-slate-800 mb-2">${escapeHtml(title)}</h1>
    <p class="text-slate-600 text-sm mb-6">First row is headers. Use commas; put quotes around values that contain commas.</p>
    ${savedBanner}
    <form method="post" action="${saveAction}" class="space-y-4">
      <div>
        <label for="csv-body" class="block text-sm font-medium text-slate-700 mb-2">CSV content</label>
        <textarea id="csv-body" name="body" rows="24" class="w-full font-mono text-sm rounded-xl border border-slate-300 px-4 py-3 text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none resize-y min-h-[280px]">${escapeHtml(body)}</textarea>
      </div>
      <div class="flex flex-wrap gap-3">
        <button type="submit" class="rounded-lg bg-emerald-600 text-white font-medium py-2.5 px-5 hover:bg-emerald-700 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 transition-colors">Save to S3</button>
        <a href="${backUrl}" class="rounded-lg border border-slate-300 bg-white font-medium py-2.5 px-5 text-slate-700 hover:bg-slate-50 inline-block">Cancel</a>
      </div>
    </form>
  `)}
`;
    return `<!DOCTYPE html>
<html lang="en">
<head>${adminHead(escapeHtml(title))}</head>
<body class="min-h-screen bg-slate-50 text-slate-900">${content}</body>
</html>`;
}

export { router as dataRoutes };
