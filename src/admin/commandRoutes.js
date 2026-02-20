import express from 'express';
import { requireAdmin } from './auth.js';
import { adminHead, adminNav, adminContainer } from './layout.js';

const router = express.Router();

router.get('/', requireAdmin, (req, res) => {
    const content = `
  ${adminNav('commands')}
  ${adminContainer(`
    <h1 class="text-2xl font-semibold text-slate-800 mb-6">Commands</h1>
    <div class="overflow-x-auto">
      <table class="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
        <thead>
          <tr class="bg-slate-50 text-left text-slate-600 font-medium">
            <th class="px-4 py-3 border-b border-slate-200">Command</th>
            <th class="px-4 py-3 border-b border-slate-200">Aliases</th>
            <th class="px-4 py-3 border-b border-slate-200">Description</th>
            <th class="px-4 py-3 border-b border-slate-200">Works In</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr class="hover:bg-slate-50">
            <td class="px-4 py-3"><code class="text-emerald-700 font-mono">!mu</code></td>
            <td class="px-4 py-3 text-slate-500"><code class="font-mono">!mu-notes</code></td>
            <td class="px-4 py-3 text-slate-700">Generate full matchup summary for a character</td>
            <td class="px-4 py-3 text-slate-500">Any channel</td>
          </tr>
          <tr class="hover:bg-slate-50">
            <td class="px-4 py-3"><code class="text-emerald-700 font-mono">!mq</code></td>
            <td class="px-4 py-3 text-slate-500"><code class="font-mono">!mu-question, !mu-q, !muq</code></td>
            <td class="px-4 py-3 text-slate-700">Ask a specific matchup question</td>
            <td class="px-4 py-3 text-slate-500">Any channel</td>
          </tr>
          <tr class="hover:bg-slate-50">
            <td class="px-4 py-3"><code class="text-emerald-700 font-mono">!q</code></td>
            <td class="px-4 py-3 text-slate-500">—</td>
            <td class="px-4 py-3 text-slate-700">General question using glossary and fundamentals</td>
            <td class="px-4 py-3 text-slate-500">Any channel</td>
          </tr>
          <tr class="hover:bg-slate-50">
            <td class="px-4 py-3"><code class="text-emerald-700 font-mono">!sq</code></td>
            <td class="px-4 py-3 text-slate-500">—</td>
            <td class="px-4 py-3 text-slate-700">Stats question</td>
            <td class="px-4 py-3 text-slate-500">Any channel</td>
          </tr>
          <tr class="hover:bg-slate-50">
            <td class="px-4 py-3"><code class="text-emerald-700 font-mono">!fd</code></td>
            <td class="px-4 py-3 text-slate-500">—</td>
            <td class="px-4 py-3 text-slate-700">Frame data lookup for a move</td>
            <td class="px-4 py-3 text-slate-500">Any channel</td>
          </tr>
          <tr class="hover:bg-slate-50">
            <td class="px-4 py-3"><code class="text-emerald-700 font-mono">!fdq</code></td>
            <td class="px-4 py-3 text-slate-500">—</td>
            <td class="px-4 py-3 text-slate-700">Frame data question (AI-powered)</td>
            <td class="px-4 py-3 text-slate-500">Any channel</td>
          </tr>
          <tr class="hover:bg-slate-50">
            <td class="px-4 py-3"><code class="text-emerald-700 font-mono">!export</code></td>
            <td class="px-4 py-3 text-slate-500">—</td>
            <td class="px-4 py-3 text-slate-700">Export channel messages to S3</td>
            <td class="px-4 py-3 text-slate-500">Any channel</td>
          </tr>
          <tr class="hover:bg-slate-50">
            <td class="px-4 py-3"><code class="text-emerald-700 font-mono">!cleanup</code></td>
            <td class="px-4 py-3 text-slate-500"><code class="font-mono">!cleanupall</code></td>
            <td class="px-4 py-3 text-slate-700">Delete bot messages in channel</td>
            <td class="px-4 py-3 text-slate-500">Any channel</td>
          </tr>
          <tr class="hover:bg-slate-50">
            <td class="px-4 py-3"><code class="text-emerald-700 font-mono">!stats</code></td>
            <td class="px-4 py-3 text-slate-500"><code class="font-mono">!s</code></td>
            <td class="px-4 py-3 text-slate-700">Character stats lookup</td>
            <td class="px-4 py-3 text-slate-500">Any channel</td>
          </tr>
        </tbody>
      </table>
    </div>
  `)}
`;
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>${adminHead('Commands')}</head>
<body class="min-h-screen bg-slate-50 text-slate-900">${content}</body>
</html>`);
});

export { router as commandRoutes };
