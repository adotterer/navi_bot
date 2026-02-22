/**
 * Admin Cost routes: token usage and estimated cost for Missions (Gemini and Anthropic).
 */
import express from 'express';
import { adminHead, adminNav, adminContainer, breadcrumb, escapeHtml } from './layout.js';
import { listRuns } from './agent/runStore.js';
import { loadRunMetadataFromS3 } from './agent/agentRunPersistence.js';
import { listS3KeysWithPrefix } from '../shared/s3Helper.js';

const router = express.Router();

// Pricing per 1M tokens (approximate list price; actual billing may differ)
const GEMINI_INPUT_PER_1M = 0.075;
const GEMINI_OUTPUT_PER_1M = 0.3;
const ANTHROPIC_INPUT_PER_1M = 3;
const ANTHROPIC_OUTPUT_PER_1M = 15;

function isAnthropic(model) {
    return typeof model === 'string' && model.trim().toLowerCase().startsWith('claude-');
}

function costForRun(model, inputTokens, outputTokens) {
    const inT = Number(inputTokens) || 0;
    const outT = Number(outputTokens) || 0;
    if (isAnthropic(model)) {
        return (inT / 1e6) * ANTHROPIC_INPUT_PER_1M + (outT / 1e6) * ANTHROPIC_OUTPUT_PER_1M;
    }
    return (inT / 1e6) * GEMINI_INPUT_PER_1M + (outT / 1e6) * GEMINI_OUTPUT_PER_1M;
}

async function getAggregatedUsage() {
    const memoryRuns = listRuns(50);
    let historyRuns = [];
    try {
        const keys = await listS3KeysWithPrefix('admin/agent-runs/', 50);
        const sorted = keys
            .sort((a, b) => new Date(b.LastModified || 0) - new Date(a.LastModified || 0))
            .slice(0, 50);
        historyRuns = await Promise.all(
            sorted.map(async (k) => {
                const runId = k.Key.replace('admin/agent-runs/', '').replace('.json', '');
                const fallbackTs = k.LastModified ? new Date(k.LastModified).getTime() : 0;
                const meta = await loadRunMetadataFromS3(runId);
                return {
                    runId,
                    title: meta?.title || '',
                    status: meta?.status || '',
                    runMode: meta?.runMode || 'pr',
                    createdAt: meta?.createdAt || fallbackTs,
                    model: meta?.model || '',
                    inputTokens: meta?.inputTokens || 0,
                    outputTokens: meta?.outputTokens || 0,
                };
            })
        );
    } catch (_) {
        // S3 not configured or error
    }
    const byId = new Map();
    memoryRuns.forEach((r) => byId.set(r.runId, { ...r, fromMemory: true }));
    historyRuns.forEach((r) => {
        if (!byId.has(r.runId)) byId.set(r.runId, r);
    });
    const runs = Array.from(byId.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    const byProvider = {
        gemini: { inputTokens: 0, outputTokens: 0, runs: 0, cost: 0 },
        anthropic: { inputTokens: 0, outputTokens: 0, runs: 0, cost: 0 },
    };
    const byModel = {};
    const byDate = {};
    const byMission = {};
    const runsWithCost = runs.map((r) => {
        const provider = isAnthropic(r.model) ? 'anthropic' : 'gemini';
        const cost = costForRun(r.model, r.inputTokens, r.outputTokens);
        byProvider[provider].inputTokens += r.inputTokens || 0;
        byProvider[provider].outputTokens += r.outputTokens || 0;
        byProvider[provider].runs += 1;
        byProvider[provider].cost += cost;

        const modelId = r.model || 'unknown';
        if (!byModel[modelId]) byModel[modelId] = { inputTokens: 0, outputTokens: 0, runs: 0, cost: 0 };
        byModel[modelId].inputTokens += r.inputTokens || 0;
        byModel[modelId].outputTokens += r.outputTokens || 0;
        byModel[modelId].runs += 1;
        byModel[modelId].cost += cost;

        const dateStr = r.createdAt ? new Date(r.createdAt).toISOString().split('T')[0] : 'unknown';
        if (!byDate[dateStr]) byDate[dateStr] = { inputTokens: 0, outputTokens: 0, runs: 0, cost: 0 };
        byDate[dateStr].inputTokens += r.inputTokens || 0;
        byDate[dateStr].outputTokens += r.outputTokens || 0;
        byDate[dateStr].runs += 1;
        byDate[dateStr].cost += cost;

        const mission = r.title || 'No Title';
        if (!byMission[mission]) byMission[mission] = { inputTokens: 0, outputTokens: 0, runs: 0, cost: 0 };
        byMission[mission].inputTokens += r.inputTokens || 0;
        byMission[mission].outputTokens += r.outputTokens || 0;
        byMission[mission].runs += 1;
        byMission[mission].cost += cost;

        return {
            runId: r.runId,
            title: r.title || '',
            status: r.status || '',
            runMode: r.runMode || 'pr',
            createdAt: r.createdAt,
            model: r.model || '',
            inputTokens: r.inputTokens || 0,
            outputTokens: r.outputTokens || 0,
            cost,
            provider,
        };
    });

    return { byProvider, byModel, byDate, byMission, runs: runsWithCost };
}

// GET /admin/cost/usage – JSON
router.get('/usage', async (req, res) => {
    try {
        const data = await getAggregatedUsage();
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message || String(err) });
    }
});

// GET /admin/cost – Cost page
router.get('/', async (req, res) => {
    let usage = { byProvider: { gemini: { cost: 0, runs: 0 }, anthropic: { cost: 0, runs: 0 } }, byModel: {}, byDate: {}, byMission: {}, runs: [] };
    try { usage = await getAggregatedUsage(); } catch (_) {}
    const { byProvider, byModel, byDate, byMission, runs } = usage;
        byProvider = data.byProvider;
        runs = data.runs;
    } catch (_) {}

    const fmt = (n) => (n || 0).toLocaleString();
    const costFmt = (c) => '
  ${adminNav('cost')}
  ${adminContainer(`
    ${breadcrumb([{ href: '/admin', label: 'Dashboard' }, { label: 'Cost' }])}
    <div class="flex items-center justify-between mb-8">
      <h1 class="text-2xl font-semibold text-slate-800 dark:text-slate-100">Cost</h1>
      <a href="/admin" class="text-sm font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">Dashboard</a>
    </div>
    <p class="text-slate-600 dark:text-slate-400 mb-6">Token usage and estimated cost for Missions. Estimates are based on list price and may differ from actual billing.</p>
    <div class="grid gap-4 sm:grid-cols-2 mb-8">
      <section class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6">
        <h2 class="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-3">Gemini</h2>
        <p class="text-sm text-slate-500 dark:text-slate-400 mb-2">${fmt(byProvider.gemini.runs)} run(s)</p>
        <p class="text-sm text-slate-700 dark:text-slate-300">Input: ${fmt(byProvider.gemini.inputTokens)} tokens</p>
        <p class="text-sm text-slate-700 dark:text-slate-300">Output: ${fmt(byProvider.gemini.outputTokens)} tokens</p>
        <p class="text-sm font-medium text-slate-800 dark:text-slate-100 mt-2">Est. ${costFmt(byProvider.gemini.cost)}</p>
      </section>
      <section class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6">
        <h2 class="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-3">Anthropic</h2>
        <p class="text-sm text-slate-500 dark:text-slate-400 mb-2">${fmt(byProvider.anthropic.runs)} run(s)</p>
        <p class="text-sm text-slate-700 dark:text-slate-300">Input: ${fmt(byProvider.anthropic.inputTokens)} tokens</p>
        <p class="text-sm text-slate-700 dark:text-slate-300">Output: ${fmt(byProvider.anthropic.outputTokens)} tokens</p>
        <p class="text-sm font-medium text-slate-800 dark:text-slate-100 mt-2">Est. ${costFmt(byProvider.anthropic.cost)}</p>
      </section>
    </div>
    <div class="mb-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6">
      <h2 class="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-4">Daily Spending</h2>
      <div style="height: 250px;"><canvas id="costChart"></canvas></div>
    </div>
    <section class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
      <div class="border-b border-slate-200 dark:border-slate-700 px-4 py-2.5 bg-slate-50 dark:bg-slate-900/50 text-sm font-medium text-slate-700 dark:text-slate-300">Recent runs</div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-slate-200 dark:border-slate-700 text-left text-slate-500 dark:text-slate-400">
              <th class="py-2 px-4">Run</th>
              <th class="py-2 px-4">Model</th>
              <th class="py-2 px-4">Mode</th>
              <th class="py-2 px-4">In / Out tokens</th>
              <th class="py-2 px-4">Est. cost</th>
            </tr>
          </thead>
          <tbody>
            ${runs.length ? runs.slice(0, 30).map((r) => `
            <tr class="border-b border-slate-100 dark:border-slate-700">
              <td class="py-2 px-4"><a href="/admin/agent" class="text-emerald-600 hover:text-emerald-700 dark:text-emerald-400">${escapeHtml(r.runId)}</a></td>
              <td class="py-2 px-4">${escapeHtml(r.model || '—')}</td>
              <td class="py-2 px-4">${escapeHtml(r.runMode || 'pr')}</td>
              <td class="py-2 px-4">${fmt(r.inputTokens)} / ${fmt(r.outputTokens)}</td>
              <td class="py-2 px-4">${costFmt(r.cost)}</td>
            </tr>
            `).join('') : '<tr><td colspan="5" class="py-4 px-4 text-slate-500 dark:text-slate-400">No runs yet.</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
  `)}
`;
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  ${adminHead('Cost')}
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body class="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
  ${content}
  <script>
    const ctx = document.getElementById('costChart')?.getContext('2d');
    if (ctx) {
      new Chart(ctx, {
        type: 'bar',
        data: {
          labels: ${chartLabels},
          datasets: [{
            label: 'Daily Cost ($)',
            data: ${chartValues},
            backgroundColor: '#10b981',
            borderRadius: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, grid: { color: 'rgba(150,150,150,0.1)' } },
            x: { grid: { display: false } }
          }
        }
      });
    }
  </script>
</body>
</html>`);
});

export { router as costRoutes };
 + (c || 0).toFixed(4);

    const dailyMap = {};
    runs.forEach(r => {
      const d = new Date(r.createdAt || Date.now()).toISOString().split('T')[0];
      dailyMap[d] = (dailyMap[d] || 0) + (r.cost || 0);
    });
    const sortedDates = Object.keys(dailyMap).sort().slice(-14);
    const chartLabels = JSON.stringify(sortedDates);
    const chartValues = JSON.stringify(sortedDates.map(d => dailyMap[d]));

    const content = `
  ${adminNav('cost')}
  ${adminContainer(`
    ${breadcrumb([{ href: '/admin', label: 'Dashboard' }, { label: 'Cost' }])}
    <div class="flex items-center justify-between mb-8">
      <h1 class="text-2xl font-semibold text-slate-800 dark:text-slate-100">Cost</h1>
      <a href="/admin" class="text-sm font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">Dashboard</a>
    </div>
    <p class="text-slate-600 dark:text-slate-400 mb-6">Token usage and estimated cost for Missions. Estimates are based on list price and may differ from actual billing.</p>
    <div class="grid gap-4 sm:grid-cols-2 mb-8">
      <section class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6">
        <h2 class="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-3">Gemini</h2>
        <p class="text-sm text-slate-500 dark:text-slate-400 mb-2">${fmt(byProvider.gemini.runs)} run(s)</p>
        <p class="text-sm text-slate-700 dark:text-slate-300">Input: ${fmt(byProvider.gemini.inputTokens)} tokens</p>
        <p class="text-sm text-slate-700 dark:text-slate-300">Output: ${fmt(byProvider.gemini.outputTokens)} tokens</p>
        <p class="text-sm font-medium text-slate-800 dark:text-slate-100 mt-2">Est. ${costFmt(byProvider.gemini.cost)}</p>
      </section>
      <section class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6">
        <h2 class="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-3">Anthropic</h2>
        <p class="text-sm text-slate-500 dark:text-slate-400 mb-2">${fmt(byProvider.anthropic.runs)} run(s)</p>
        <p class="text-sm text-slate-700 dark:text-slate-300">Input: ${fmt(byProvider.anthropic.inputTokens)} tokens</p>
        <p class="text-sm text-slate-700 dark:text-slate-300">Output: ${fmt(byProvider.anthropic.outputTokens)} tokens</p>
        <p class="text-sm font-medium text-slate-800 dark:text-slate-100 mt-2">Est. ${costFmt(byProvider.anthropic.cost)}</p>
      </section>
    </div>
    <section class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
      <div class="border-b border-slate-200 dark:border-slate-700 px-4 py-2.5 bg-slate-50 dark:bg-slate-900/50 text-sm font-medium text-slate-700 dark:text-slate-300">Recent runs</div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-slate-200 dark:border-slate-700 text-left text-slate-500 dark:text-slate-400">
              <th class="py-2 px-4">Run</th>
              <th class="py-2 px-4">Model</th>
              <th class="py-2 px-4">Mode</th>
              <th class="py-2 px-4">In / Out tokens</th>
              <th class="py-2 px-4">Est. cost</th>
            </tr>
          </thead>
          <tbody>
            ${runs.length ? runs.slice(0, 30).map((r) => `
            <tr class="border-b border-slate-100 dark:border-slate-700">
              <td class="py-2 px-4"><a href="/admin/agent" class="text-emerald-600 hover:text-emerald-700 dark:text-emerald-400">${escapeHtml(r.runId)}</a></td>
              <td class="py-2 px-4">${escapeHtml(r.model || '—')}</td>
              <td class="py-2 px-4">${escapeHtml(r.runMode || 'pr')}</td>
              <td class="py-2 px-4">${fmt(r.inputTokens)} / ${fmt(r.outputTokens)}</td>
              <td class="py-2 px-4">${costFmt(r.cost)}</td>
            </tr>
            `).join('') : '<tr><td colspan="5" class="py-4 px-4 text-slate-500 dark:text-slate-400">No runs yet.</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
  `)}
`;
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>${adminHead('Cost')}</head>
<body class="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">${content}</body>
</html>`);
});

export { router as costRoutes };
