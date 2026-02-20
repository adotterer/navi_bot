import express from 'express';
import { updateCommandMetadata, PROMPT_META } from '../shared/promptLoader.js';
import { adminHead, adminNav, adminContainer, escapeHtml, breadcrumb } from './layout.js';

const router = express.Router();

router.get('/', (req, res) => {
    const rows = Object.entries(PROMPT_META).map(([id, meta]) => `
<tr class="border-t border-slate-100">
  <td class="py-4 px-4 font-mono text-xs text-slate-500">${escapeHtml(id)}</td>
  <td class="py-4 px-4">
    <input type="text" name="description" value="${escapeHtml(meta.description)}" class="w-full rounded border border-slate-200 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none" onchange="save('${escapeHtml(id)}', this)">
  </td>
  <td class="py-4 px-4">
    <input type="text" name="whereItWorks" value="${escapeHtml(meta.allowedChannels || 'all')}" class="w-full rounded border border-slate-200 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none" onchange="save('${escapeHtml(id)}', this)">
  </td>
</tr>`).join('');

    const content = `
${adminNav('commands')}
${adminContainer(`
  ${breadcrumb([{ label: 'Dashboard', href: '/admin' }, { label: 'Commands', href: '/admin/commands' }])}
  <div class="mb-6">
    <h1 class="text-2xl font-semibold text-slate-800">Commands</h1>
    <p class="text-slate-500 text-sm mt-1">All of the current Discord commands with a description of what the commands do, and WHere these commands work.</p>
  </div>
  <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
    <table class="w-full text-left border-collapse">
      <thead class="bg-slate-50 text-slate-500 text-xs font-semibold uppercase">
        <tr>
          <th class="py-3 px-4">Command</th>
          <th class="py-3 px-4">Description</th>
          <th class="py-3 px-4 w-1/3">Where these commands work</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <script>
    async function save(id, input) {
      const row = input.closest('tr');
      const description = row.querySelector('input[name="description"]').value;
      const whereItWorks = row.querySelector('input[name="whereItWorks"]').value;
      await fetch('/admin/commands/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, description, whereItWorks })
      });
    }
  </script>
`)}`;
    res.send(`<!DOCTYPE html><html lang="en"><head>${adminHead('Commands')}</head><body class="min-h-screen bg-slate-50 text-slate-900">${content}</body></html>`);
});

router.post('/update', async (req, res) => {
    const { id, description, whereItWorks } = req.body;

    if (!id) {
        return res.status(400).json({ error: 'Command ID is required' });
    }

    try {
        await updateCommandMetadata(id, {
            description,
            whereItWorks
        });
        res.json({ success: true });
    } catch (err) {
        console.error('Failed to update command metadata:', err);
        res.status(500).json({ error: 'Failed to update command metadata' });
    }
});

export { router as commandRoutes };