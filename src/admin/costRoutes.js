/**
 * Admin Cost routes: token usage and estimated cost for Missions (Gemini and Anthropic).
 */
import express from 'express';
import { adminHead, adminNav, adminContainer, breadcrumb, escapeHtml } from './layout.js';
import { listRuns } from './agent/runStore.js';
import { loadRunMetadataFromS3 } from './agent/agentRunPersistence.js';
import { listS3KeysWithPrefix } from '../shared/s3Helper.js';

const router = express.Router();

// Pricing per 1M tokens (list price; actual billing may differ). Source: https://docs.anthropic.com/en/docs/about-claude/pricing
const GEMINI_FLASH_INPUT_PER_1M = 0.075;
const GEMINI_FLASH_OUTPUT_PER_1M = 0.3;
const GEMINI_PRO_INPUT_PER_1M = 3.5;
const GEMINI_PRO_OUTPUT_PER_1M = 10.5;

/** Anthropic base input/output $ per 1M tokens by model tier. Fallback: Sonnet 4.x. */
function getAnthropicRates(modelId) {
    const m = (modelId || '').toLowerCase();
    // Opus 4.5 / 4.6: $5 in, $25 out
    if (/opus-4-[56]|opus-4\.(5|6)/.test(m)) return { input: 5, output: 25 };
    // Opus 4 / 4.1: $15 in, $75 out
    if (/opus-4|opus-3/.test(m)) return { input: 15, output: 75 };
    // Sonnet 4.x / 3.7: $3 in, $15 out
    if (/sonnet/.test(m)) return { input: 3, output: 15 };
    // Haiku 4.5: $1 in, $5 out
    if (/haiku-4-5|haiku-4\.5/.test(m)) return { input: 1, output: 5 };
    // Haiku 3.5: $0.80 in, $4 out
    if (/haiku-3-5|haiku-3\.5/.test(m)) return { input: 0.8, output: 4 };
    // Haiku 3: $0.25 in, $1.25 out
    if (/haiku-3\b/.test(m)) return { input: 0.25, output: 1.25 };
    // Default: Sonnet 4.x
    return { input: 3, output: 15 };
}

function isAnthropic(model) {
    return typeof model === 'string' && model.trim().toLowerCase().startsWith('claude-');
}

function isGeminiPro(model) {
    return typeof model === 'string' && model.toLowerCase().includes('pro');
}

function costForRun(model, inputTokens, outputTokens, cachedTokens = 0) {
    const inT = Number(inputTokens) || 0;
    const outT = Number(outputTokens) || 0;
    const cacheT = Number(cachedTokens) || 0;
    if (isAnthropic(model)) {
        const rates = getAnthropicRates(model);
        // Claude: cache reads at 0.1x base input price
        const nonCached = Math.max(0, inT - cacheT);
        return (nonCached / 1e6) * rates.input + (cacheT / 1e6) * rates.input * 0.1 + (outT / 1e6) * rates.output;
    }
    const isPro = typeof model === 'string' && model.toLowerCase().includes('pro');
    const inputRate = isPro ? GEMINI_PRO_INPUT_PER_1M : GEMINI_FLASH_INPUT_PER_1M;
    const outputRate = isPro ? GEMINI_PRO_OUTPUT_PER_1M : GEMINI_FLASH_OUTPUT_PER_1M;
    const multiplier = inT > 128000 ? 2 : 1;
    // Gemini: cached tokens at ~10% of input (context caching discount)
    const nonCached = Math.max(0, inT - cacheT);
    return (((nonCached / 1e6) * inputRate + (cacheT / 1e6) * inputRate * 0.1 + (outT / 1e6) * outputRate)) * multiplier;
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
                    cachedTokens: meta?.cachedTokens || 0,
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
        const cached = r.cachedTokens ?? r.cached_tokens ?? 0;
        const cost = costForRun(r.model, r.inputTokens, r.outputTokens, cached);
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
            cachedTokens: cached,
            cost,
            provider,
        };
    });

    // --- Daily cost aggregation for last 30 days ---
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const windowStart = new Date(now);
    windowStart.setDate(windowStart.getDate() - 29);
    windowStart.setHours(0, 0, 0, 0);

    // Build sortedDailyArray: one entry per calendar day in the 30-day window
    const sortedDailyArray = [];
    for (let i = 0; i < 30; i++) {
        const d = new Date(windowStart);
        d.setDate(d.getDate() + i);
        const dateStr = d.toISOString().split('T')[0];
        const entry = byDate[dateStr];
        sortedDailyArray.push({
            date: dateStr,
            totalCost: entry ? entry.cost : 0,
            runs: entry ? entry.runs : 0,
        });
    }

    const periodTotal = sortedDailyArray.reduce((s, d) => s + d.totalCost, 0);
    const dailyAverage = periodTotal / 30;

    const todayEntry = sortedDailyArray.find((d) => d.date === todayStr);
    const todayCost = todayEntry ? todayEntry.totalCost : 0;

    const peakDay = sortedDailyArray.reduce(
        (best, d) => (d.totalCost > best.totalCost ? d : best),
        { date: '', totalCost: 0 }
    );

    // Rolling 7-day average: last 7 entries in sortedDailyArray
    const last7 = sortedDailyArray.slice(-7);
    const prior7 = sortedDailyArray.slice(-14, -7);
    const last7Total = last7.reduce((s, d) => s + d.totalCost, 0);
    const prior7Total = prior7.reduce((s, d) => s + d.totalCost, 0);
    const rolling7dayAvg = last7Total / 7;

    // Week-over-week trend as a percentage change (positive = more spend)
    let weekOverWeekTrend = null;
    if (prior7Total > 0) {
        weekOverWeekTrend = ((last7Total - prior7Total) / prior7Total) * 100;
    } else if (last7Total > 0) {
        weekOverWeekTrend = 100;
    } else {
        weekOverWeekTrend = 0;
    }

    return {
        byProvider,
        byModel,
        byDate,
        byMission,
        runs: runsWithCost,
        sortedDailyArray,
        periodTotal,
        dailyAverage,
        todayCost,
        peakDay,
        rolling7dayAvg,
        weekOverWeekTrend,
    };
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
    let usage = {
        byProvider: {
            gemini: { cost: 0, runs: 0, inputTokens: 0, outputTokens: 0 },
            anthropic: { cost: 0, runs: 0, inputTokens: 0, outputTokens: 0 },
        },
        byModel: {},
        byDate: {},
        byMission: {},
        runs: [],
        sortedDailyArray: [],
        periodTotal: 0,
        dailyAverage: 0,
        todayCost: 0,
        weekOverWeekTrend: 0,
    };
    try { usage = await getAggregatedUsage(); } catch (_) {}
    const { byProvider, byModel, byDate, byMission, runs, periodTotal, dailyAverage, todayCost, weekOverWeekTrend } = usage;

    const fmt = (n) => (n || 0).toLocaleString();
    const costFmt = (c) => '$' + (Number(c) || 0).toFixed(4);
    const dailyMap = {};
    runs.forEach((r) => {
        const d = new Date(r.createdAt || Date.now()).toISOString().split('T')[0];
        dailyMap[d] = (dailyMap[d] || 0) + (r.cost || 0);
    });
    const sortedDates = Object.keys(dailyMap).sort().slice(-14);
    const chartLabels = JSON.stringify(sortedDates);
    const chartValues = JSON.stringify(sortedDates.map((d) => dailyMap[d]));
    const nonce = res.locals.nonce || '';
    const scriptNonce = nonce ? ` nonce="${escapeHtml(nonce)}"` : '';

    // Summary metric computation
    const trendPct = typeof weekOverWeekTrend === 'number' ? weekOverWeekTrend : 0;
    const trendUp = trendPct >= 0;
    const trendArrow = trendUp ? '\u2191' : '\u2193';
    const trendColor = trendUp
        ? 'text-red-600 dark:text-red-400'
        : 'text-emerald-600 dark:text-emerald-400';

    const dailyTableRows = (usage.sortedDailyArray || []).slice().reverse().map((entry, i, arr) => {
        const prev = arr[i + 1];
        let changeCel = '<span class="text-slate-400">\u2014</span>';
        if (prev !== undefined) {
            if (prev.totalCost === 0 && entry.totalCost === 0) {
                changeCel = '<span class="text-slate-400">\u2014</span>';
            } else if (prev.totalCost === 0) {
                changeCel = '<span class="text-emerald-600 dark:text-emerald-400">+100.0%</span>';
            } else {
                const pct = ((entry.totalCost - prev.totalCost) / prev.totalCost) * 100;
                const sign = pct >= 0 ? '+' : '';
                const color = pct > 0
                    ? 'text-red-600 dark:text-red-400'
                    : pct < 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-slate-400';
                changeCel = '<span class="' + color + '">' + sign + pct.toFixed(1) + '%</span>';
            }
        }
        const stripe = i % 2 === 1 ? 'bg-slate-50 dark:bg-slate-800/50' : '';
        return '<tr class="border-b border-slate-100 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 ' + stripe + '">' +
            '<td class="py-2 px-4 font-mono text-slate-700 dark:text-slate-300">' + escapeHtml(entry.date) + '</td>' +
            '<td class="py-2 px-4 text-slate-700 dark:text-slate-300">' + costFmt(entry.totalCost) + '</td>' +
            '<td class="py-2 px-4">' + changeCel + '</td>' +
            '</tr>';
    }).join('');

    const recentRunRows = runs.length
        ? runs.slice(0, 30).map((r) =>
            '<tr class="border-b border-slate-100 dark:border-slate-700">' +
            '<td class="py-2 px-4"><a href="/admin/agent" class="text-emerald-600 hover:text-emerald-700 dark:text-emerald-400">' + escapeHtml(r.runId) + '</a></td>' +
            '<td class="py-2 px-4">' + escapeHtml(r.model || '\u2014') + '</td>' +
            '<td class="py-2 px-4">' + escapeHtml(r.runMode || 'pr') + '</td>' +
            '<td class="py-2 px-4">' + fmt(r.inputTokens) + ' / ' + fmt(r.outputTokens) +
                ((r.cachedTokens || 0) > 0
                    ? ' <span class="text-slate-400" title="Cached tokens (discounted)">(' + fmt(r.cachedTokens) + ' cached)</span>'
                    : '') +
            '</td>' +
            '<td class="py-2 px-4">' + costFmt(r.cost) + '</td>' +
            '</tr>'
        ).join('')
        : '<tr><td colspan="5" class="py-4 px-4 text-slate-500 dark:text-slate-400">No runs yet.</td></tr>';

    const content = adminNav('cost', false, nonce) + adminContainer(
        breadcrumb([{ href: '/admin', label: 'Dashboard' }, { label: 'Cost' }]) +
        `<div class="flex items-center justify-between mb-8">
  <h1 class="text-2xl font-semibold text-slate-800 dark:text-slate-100">Cost</h1>
  <a href="/admin" class="text-sm font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">Dashboard</a>
</div>
<p class="text-slate-600 dark:text-slate-400 mb-6">Token usage and estimated cost for Missions. Estimates are based on list price and may differ from actual billing.</p>
<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
  <div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
    <p class="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Total Spend</p>
    <p class="text-2xl font-semibold text-slate-800 dark:text-slate-100">${costFmt(periodTotal)}</p>
    <p class="text-xs text-slate-400 dark:text-slate-500 mt-1">Last 30 days</p>
  </div>
  <div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
    <p class="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Daily Average</p>
    <p class="text-2xl font-semibold text-slate-800 dark:text-slate-100">${costFmt(dailyAverage)}</p>
    <p class="text-xs text-slate-400 dark:text-slate-500 mt-1">30-day average</p>
  </div>
  <div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
    <p class="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Today&#39;s Cost</p>
    <p class="text-2xl font-semibold text-slate-800 dark:text-slate-100">${costFmt(todayCost)}</p>
    <p class="text-xs text-slate-400 dark:text-slate-500 mt-1">Current day</p>
  </div>
  <div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
    <p class="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Trend</p>
    <p class="text-2xl font-semibold ${trendColor}">${trendArrow} ${Math.abs(trendPct).toFixed(1)}%</p>
    <p class="text-xs text-slate-400 dark:text-slate-500 mt-1">Week-over-week</p>
  </div>
</div>
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
<section class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden mb-8">
  <div class="border-b border-slate-200 dark:border-slate-700 px-4 py-2.5 bg-slate-50 dark:bg-slate-900/50 text-sm font-medium text-slate-700 dark:text-slate-300">Daily breakdown (last 30 days)</div>
  <div class="overflow-x-auto">
    <table class="w-full text-sm">
      <thead>
        <tr class="border-b border-slate-200 dark:border-slate-700 text-left text-slate-500 dark:text-slate-400">
          <th class="py-2 px-4 font-medium">Date</th>
          <th class="py-2 px-4 font-medium">Total Cost</th>
          <th class="py-2 px-4 font-medium">Change</th>
        </tr>
      </thead>
      <tbody>${dailyTableRows}</tbody>
    </table>
  </div>
</section>
<section class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
  <div class="border-b border-slate-200 dark:border-slate-700 px-4 py-2.5 bg-slate-50 dark:bg-slate-900/50 text-sm font-medium text-slate-700 dark:text-slate-300">Recent runs</div>
  <div class="overflow-x-auto">
    <table class="w-full text-sm">
      <thead>
        <tr class="border-b border-slate-200 dark:border-slate-700 text-left text-slate-500 dark:text-slate-400">
          <th class="py-2 px-4">Run</th>
          <th class="py-2 px-4">Model</th>
          <th class="py-2 px-4">Mode</th>
          <th class="py-2 px-4">In / Out / Cached</th>
          <th class="py-2 px-4">Est. cost</th>
        </tr>
      </thead>
      <tbody>${recentRunRows}</tbody>
    </table>
  </div>
</section>`
    );

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  ${adminHead('Cost', nonce)}
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body class="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
  ${content}
  <script${scriptNonce}>
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
