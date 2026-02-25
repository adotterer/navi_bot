/**
 * Admin Cost routes: token usage and estimated cost for Missions (Gemini and Anthropic).
 */
import express from 'express';
import { adminHead, adminNav, adminContainer, breadcrumb, escapeHtml } from './layout.js';
import { listRuns } from './agent/runStore.js';
import { loadRunMetadataFromS3 } from './agent/agentRunPersistence.js';
import { listAllS3KeysWithPrefix } from '../shared/s3Helper.js';

const router = express.Router();

// Pricing per 1M tokens (list price; actual billing may differ).
const GEMINI_FLASH_INPUT_PER_1M = 0.075;
const GEMINI_FLASH_OUTPUT_PER_1M = 0.3;
const GEMINI_PRO_INPUT_PER_1M = 3.5;
const GEMINI_PRO_OUTPUT_PER_1M = 10.5;

function getAnthropicRates(modelId) {
    const m = (modelId || '').toLowerCase();
    if (/opus-4-[56]|opus-4\.(5|6)/.test(m)) return { input: 5, output: 25 };
    if (/opus-4|opus-3/.test(m)) return { input: 15, output: 75 };
    if (/sonnet/.test(m)) return { input: 3, output: 15 };
    if (/haiku-4-5|haiku-4\.5/.test(m)) return { input: 1, output: 5 };
    if (/haiku-3-5|haiku-3\.5/.test(m)) return { input: 0.8, output: 4 };
    if (/haiku-3\b/.test(m)) return { input: 0.25, output: 1.25 };
    return { input: 3, output: 15 };
}

function isAnthropic(model) {
    return typeof model === 'string' && model.trim().toLowerCase().startsWith('claude-');
}

function costForRun(model, inputTokens, outputTokens, cachedTokens = 0) {
    const inT = Number(inputTokens) || 0;
    const outT = Number(outputTokens) || 0;
    const cacheT = Number(cachedTokens) || 0;
    if (isAnthropic(model)) {
        const rates = getAnthropicRates(model);
        const nonCached = Math.max(0, inT - cacheT);
        return (nonCached / 1e6) * rates.input + (cacheT / 1e6) * rates.input * 0.1 + (outT / 1e6) * rates.output;
    }
    const isPro = typeof model === 'string' && model.toLowerCase().includes('pro');
    const inputRate = isPro ? GEMINI_PRO_INPUT_PER_1M : GEMINI_FLASH_INPUT_PER_1M;
    const outputRate = isPro ? GEMINI_PRO_OUTPUT_PER_1M : GEMINI_FLASH_OUTPUT_PER_1M;
    const multiplier = inT > 128000 ? 2 : 1;
    const nonCached = Math.max(0, inT - cacheT);
    return (((nonCached / 1e6) * inputRate + (cacheT / 1e6) * inputRate * 0.1 + (outT / 1e6) * outputRate)) * multiplier;
}

async function getAggregatedUsage(daysBack = 30) {
    const memoryRuns = listRuns(50);
    let historyRuns = [];
    try {
        const keys = await listAllS3KeysWithPrefix('admin/agent-runs/');
        const sorted = keys.sort((a, b) => new Date(b.LastModified || 0) - new Date(a.LastModified || 0));
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
    const allRuns = Array.from(byId.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const windowStart = Date.now() - daysBack * 24 * 60 * 60 * 1000;
    const runs = allRuns.filter((r) => (r.createdAt || 0) >= windowStart);

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

    // Build dailyRows: group by UTC calendar date, descending
    const dailyMap = {};
    runsWithCost.forEach((r) => {
        const dateStr = r.createdAt ? new Date(r.createdAt).toISOString().split('T')[0] : 'unknown';
        if (!dailyMap[dateStr]) dailyMap[dateStr] = { date: dateStr, totalCost: 0, byModel: {}, runs: 0 };
        dailyMap[dateStr].totalCost += r.cost;
        dailyMap[dateStr].runs += 1;
        const mid = r.model || 'unknown';
        dailyMap[dateStr].byModel[mid] = (dailyMap[dateStr].byModel[mid] || 0) + r.cost;
    });
    const dailyRows = Object.values(dailyMap).sort((a, b) => b.date.localeCompare(a.date));

    // Compute summaryMetrics
    const total30 = runsWithCost.reduce((s, r) => s + r.cost, 0);
    const dailyAvg = daysBack > 0 ? total30 / daysBack : 0;
    const todayStr = new Date().toISOString().split('T')[0];
    const todayCost = (dailyMap[todayStr] || { totalCost: 0 }).totalCost;
    // Previous window total
    const prevWindowStart = windowStart - daysBack * 24 * 60 * 60 * 1000;
    const prevWindowRuns = allRuns.filter((r) => (r.createdAt || 0) >= prevWindowStart && (r.createdAt || 0) < windowStart);
    const prevWindowTotal = prevWindowRuns.reduce((s, r) => {
        const cached = r.cachedTokens ?? r.cached_tokens ?? 0;
        return s + costForRun(r.model, r.inputTokens, r.outputTokens, cached);
    }, 0);
    const trendPct = prevWindowTotal > 0 ? ((total30 - prevWindowTotal) / prevWindowTotal) * 100 : null;
    const peakDay = dailyRows.length > 0 ? dailyRows.reduce((best, d) => d.totalCost > best.totalCost ? d : best, dailyRows[0]) : null;
    const summaryMetrics = { total30, dailyAvg, todayCost, prevWindowTotal, trendPct, peakDay };

    return { byProvider, byModel, byDate, byMission, runs: runsWithCost, dailyRows, summaryMetrics };
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
    const range = parseInt(req.query.range, 10);
    const daysBack = [7, 30, 90].includes(range) ? range : 30;
    let usage = {
        byProvider: {
            gemini: { cost: 0, runs: 0, inputTokens: 0, outputTokens: 0 },
            anthropic: { cost: 0, runs: 0, inputTokens: 0, outputTokens: 0 },
        },
        byModel: {},
        byDate: {},
        byMission: {},
        runs: [],
        dailyRows: [],
        summaryMetrics: { total30: 0, dailyAvg: 0, todayCost: 0, prevWindowTotal: 0, trendPct: null, peakDay: null },
    };
    try { usage = await getAggregatedUsage(daysBack); } catch (_) {}
    const { byProvider, byModel, byDate, byMission, runs, dailyRows, summaryMetrics } = usage;

    const fmt = (n) => (n || 0).toLocaleString();
    const costFmt = (c) => '

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
        // Claude: cache reads at 0.1x base input price (platform.claude.com/docs/about-claude/pricing)
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

async function getAggregatedUsage(daysBack = 30) {
    const memoryRuns = listRuns(50);
    let historyRuns = [];
    try {
        const keys = await listAllS3KeysWithPrefix('admin/agent-runs/');
        const sorted = keys
            .sort((a, b) => new Date(b.LastModified || 0) - new Date(a.LastModified || 0));
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
    const allRuns = Array.from(byId.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const windowStart = Date.now() - daysBack * 24 * 60 * 60 * 1000;
    const runs = allRuns.filter((r) => (r.createdAt || 0) >= windowStart);

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

    // Build dailyRows: group by UTC calendar date, descending
    const dailyMap = {};
    runsWithCost.forEach((r) => {
        const dateStr = r.createdAt ? new Date(r.createdAt).toISOString().split('T')[0] : 'unknown';
        if (!dailyMap[dateStr]) dailyMap[dateStr] = { date: dateStr, totalCost: 0, byModel: {}, runs: 0 };
        dailyMap[dateStr].totalCost += r.cost;
        dailyMap[dateStr].runs += 1;
        const mid = r.model || 'unknown';
        dailyMap[dateStr].byModel[mid] = (dailyMap[dateStr].byModel[mid] || 0) + r.cost;
    });
    const dailyRows = Object.values(dailyMap).sort((a, b) => b.date.localeCompare(a.date));

    // Compute summaryMetrics
    const total30 = runsWithCost.reduce((s, r) => s + r.cost, 0);
    const dailyAvg = dailyRows.length > 0 ? total30 / daysBack : 0;
    const todayStr = new Date().toISOString().split('T')[0];
    const todayCost = (dailyMap[todayStr] || { totalCost: 0 }).totalCost;
    // Previous window total: runs in the window before the current window
    const prevWindowStart = windowStart - daysBack * 24 * 60 * 60 * 1000;
    const prevWindowRuns = allRuns.filter((r) => (r.createdAt || 0) >= prevWindowStart && (r.createdAt || 0) < windowStart);
    const prevWindowTotal = prevWindowRuns.reduce((s, r) => {
        const cached = r.cachedTokens ?? r.cached_tokens ?? 0;
        return s + costForRun(r.model, r.inputTokens, r.outputTokens, cached);
    }, 0);
    const trendPct = prevWindowTotal > 0 ? ((total30 - prevWindowTotal) / prevWindowTotal) * 100 : null;
    const peakDay = dailyRows.length > 0 ? dailyRows.reduce((best, d) => d.totalCost > best.totalCost ? d : best, dailyRows[0]) : null;
    const summaryMetrics = { total30, dailyAvg, todayCost, prevWindowTotal, trendPct, peakDay };

    return { byProvider, byModel, byDate, byMission, runs: runsWithCost, dailyRows, summaryMetrics };
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
    const range = parseInt(req.query.range, 10);
    const daysBack = [7, 30, 90].includes(range) ? range : 30;
    let usage = { byProvider: { gemini: { cost: 0, runs: 0, inputTokens: 0, outputTokens: 0 }, anthropic: { cost: 0, runs: 0, inputTokens: 0, outputTokens: 0 } }, byModel: {}, byDate: {}, byMission: {}, runs: [], dailyRows: [], summaryMetrics: { total30: 0, dailyAvg: 0, todayCost: 0, prevWindowTotal: 0, trendPct: null, peakDay: null } };
    try { usage = await getAggregatedUsage(daysBack); } catch (_) {}
    const { byProvider, byModel, byDate, byMission, runs, dailyRows, summaryMetrics } = usage;

    const fmt = (n) => (n || 0).toLocaleString();
    const costFmt = (c) => '

    // Day-over-day % change for daily breakdown table
    const dailyRowsWithChange = dailyRows.map((row, i) => {
        const prev = dailyRows[i + 1];
        const pct = prev && prev.totalCost > 0 ? ((row.totalCost - prev.totalCost) / prev.totalCost) * 100 : null;
        return { ...row, dodPct: pct };
    });

    const content = `
  ${adminNav('cost', false, nonce)}
  ${adminContainer(`
    ${breadcrumb([{ href: '/admin', label: 'Dashboard' }, { label: 'Cost' }])}
    <div class="flex items-center justify-between mb-8">
      <h1 class="text-2xl font-semibold text-slate-800 dark:text-slate-100">Cost</h1>
      <a href="/admin" class="text-sm font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">Dashboard</a>
    </div>
    <p class="text-slate-600 dark:text-slate-400 mb-6">Token usage and estimated cost for Missions. Estimates are based on list price and may differ from actual billing.</p>
    <div class="flex items-center gap-2 mb-6">
      <span class="text-sm text-slate-500 dark:text-slate-400">Range:</span>
      ${[7, 30, 90].map((d) => `<a href="/admin/cost?range=${d}" class="px-3 py-1 rounded-lg text-sm font-medium border ${range === d ? 'bg-emerald-600 text-white border-emerald-600' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}">${d === 7 ? 'Last 7 Days' : d === 30 ? 'Last 30 Days' : 'Last 90 Days'}</a>`).join('')}
    </div>
    <div class="grid gap-4 sm:grid-cols-3 mb-8">
      <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
        <p class="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Total Spend (${range}d)</p>
        <p class="text-2xl font-semibold text-slate-800 dark:text-slate-100">${costFmt(totalCost)}</p>
      </div>
      <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
        <p class="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Daily Average</p>
        <p class="text-2xl font-semibold text-slate-800 dark:text-slate-100">${costFmt(dailyAvg)}</p>
      </div>
      <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
        <p class="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Peak Day</p>
        <p class="text-2xl font-semibold text-slate-800 dark:text-slate-100">${peakDay ? peakDay : '—'}</p>
        ${peakDay ? `<p class="text-xs text-slate-500 dark:text-slate-400 mt-1">${costFmt(dailyMap[peakDay])}</p>` : ''}
      </div>
    </div>
    <div class="flex items-center gap-2 mb-6">
      <span class="text-sm text-slate-500 dark:text-slate-400 mr-1">Range:</span>
      ${[7, 30, 90].map((d) => `<a href="/admin/cost?range=${d}" class="px-3 py-1 rounded-lg border text-sm font-medium transition-colors ${rangeDays === d ? 'bg-emerald-600 text-white border-emerald-600' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}">Last ${d} days</a>`).join('')}
    </div>
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
      <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
        <p class="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Total Spend (${rangeDays}d)</p>
        <p class="text-2xl font-semibold text-slate-800 dark:text-slate-100">${costFmt(summary.total30d)}</p>
      </div>
      <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
        <p class="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Daily Average</p>
        <p class="text-2xl font-semibold text-slate-800 dark:text-slate-100">${costFmt(summary.dailyAverage)}</p>
      </div>
      <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
        <p class="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Peak Day</p>
        <p class="text-2xl font-semibold text-slate-800 dark:text-slate-100">${summary.peakDay ? costFmt(summary.peakDay.cost) : '—'}</p>
        ${summary.peakDay ? `<p class="text-xs text-slate-400 mt-1">${escapeHtml(summary.peakDay.date)}</p>` : ''}
      </div>
      <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
        <p class="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Week-over-Week Trend</p>
        <p class="text-2xl font-semibold ${trendColor}">${trendSign} ${pctFmt(Math.abs(summary.weekOverWeekTrend))}</p>
        <p class="text-xs text-slate-400 mt-1">vs prior 7 days</p>
      </div>
    </div>
    <!-- Filter bar -->
    <div class="flex items-center gap-2 mb-6">
      ${[7, 30, 90].map((n) => `<a href="/admin/cost?range=${n}" class="px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${daysBack === n ? 'bg-emerald-600 text-white border-emerald-600' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}">Last ${n} Days</a>`).join('')}
    </div>
    <!-- Summary cards -->
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
      <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
        <p class="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Total Spend</p>
        <p class="text-2xl font-semibold text-slate-800 dark:text-slate-100">${costFmt(total30)}</p>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Last ${daysBack} days</p>
      </div>
      <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
        <p class="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Daily Average</p>
        <p class="text-2xl font-semibold text-slate-800 dark:text-slate-100">${costFmt(dailyAvg)}</p>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Over ${daysBack}-day window</p>
      </div>
      <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
        <p class="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Most Recent Day</p>
        <p class="text-2xl font-semibold text-slate-800 dark:text-slate-100">${costFmt(todayCost)}</p>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">${new Date().toISOString().split('T')[0]}</p>
      </div>
      <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
        <p class="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Week-over-Week Trend</p>
        <p class="text-2xl font-semibold ${trendColor}">${escapeHtml(trendStr)}</p>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">${peakDay ? 'Peak: ' + escapeHtml(peakDay.date) + ' (' + costFmt(peakDay.totalCost) + ')' : 'No data'}</p>
      </div>
    </div>
    <!-- Daily breakdown table -->
    <section class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden mb-8">
      <div class="border-b border-slate-200 dark:border-slate-700 px-4 py-2.5 bg-slate-50 dark:bg-slate-900/50 text-sm font-medium text-slate-700 dark:text-slate-300">Daily Breakdown</div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-slate-200 dark:border-slate-700 text-left text-slate-500 dark:text-slate-400">
              <th class="py-2 px-4">Date</th>
              <th class="py-2 px-4">Total Cost</th>
              ${allModelKeys.map((m) => `<th class="py-2 px-4">${escapeHtml(m)}</th>`).join('')}
              <th class="py-2 px-4">Day-over-Day % Change</th>
            </tr>
          </thead>
          <tbody>
            ${dailyRowsWithChange.length ? dailyRowsWithChange.map((row, i) => `
            <tr class="border-b border-slate-100 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700/50 ${i % 2 === 1 ? 'even:bg-slate-50 dark:even:bg-slate-800/50' : ''}">
              <td class="py-2 px-4 font-mono">${escapeHtml(row.date)}</td>
              <td class="py-2 px-4 font-medium">${costFmt(row.totalCost)}</td>
              ${allModelKeys.map((m) => `<td class="py-2 px-4">${row.byModel[m] ? costFmt(row.byModel[m]) : '—'}</td>`).join('')}
              <td class="py-2 px-4 ${row.dodPct === null ? 'text-slate-400' : row.dodPct > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}">${row.dodPct === null ? '—' : (row.dodPct >= 0 ? '↑' : '↓') + ' ' + Math.abs(row.dodPct).toFixed(1) + '%'}</td>
            </tr>
            `).join('') : '<tr><td colspan="' + (3 + allModelKeys.length) + '" class="py-4 px-4 text-slate-500 dark:text-slate-400">No data in this period.</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
    <div class="grid gap-4 sm:grid-cols-2 mb-8">
      <section class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6" aria-label="Gemini provider stats">
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
    <div class="mb-4 flex items-center gap-2">
      ${[7, 30, 90].map((r) => {
        const isActive = r === range;
        const cls = isActive
          ? 'bg-slate-700 text-white'
          : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700';
        return `<a href="/admin/cost?range=${r}" class="${cls} rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-sm font-medium transition-colors">Last ${r} Days</a>`;
      }).join('')}
    </div>
    <div class="mb-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6">
      <h2 class="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-4">Daily Spending — Last ${range} Days</h2>
      <div style="height: 250px;"><canvas id="costChart"></canvas></div>
    </div>
    <div class="mb-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
      <div class="border-b border-slate-200 dark:border-slate-700 px-4 py-2.5 bg-slate-50 dark:bg-slate-900/50 text-sm font-medium text-slate-700 dark:text-slate-300">Daily breakdown (last ${rangeDays} days)</div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-slate-200 dark:border-slate-700 text-left text-slate-500 dark:text-slate-400">
              <th class="py-2 px-4">Date</th>
              <th class="py-2 px-4">Total Cost</th>
              <th class="py-2 px-4">By Model</th>
            </tr>
          </thead>
          <tbody>
            ${dailyBreakdown.length ? [...dailyBreakdown].reverse().map((d) => `
            <tr class="border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
              <td class="py-2 px-4 font-mono text-slate-700 dark:text-slate-300">${escapeHtml(d.date)}</td>
              <td class="py-2 px-4 font-medium text-slate-800 dark:text-slate-100">${costFmt(d.totalCost)}</td>
              <td class="py-2 px-4 text-slate-500 dark:text-slate-400 text-xs">${Object.entries(d.byModel).sort((a, b) => b[1] - a[1]).map(([mid, c]) => `<span class="inline-block mr-2">${escapeHtml(mid)}: ${costFmt(c)}</span>`).join('')}</td>
            </tr>
            `).join('') : '<tr><td colspan="3" class="py-4 px-4 text-slate-500 dark:text-slate-400">No data for this period.</td></tr>'}
          </tbody>
        </table>
      </div>
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
              <th class="py-2 px-4">In / Out / Cached</th>
              <th class="py-2 px-4">Est. cost</th>
            </tr>
          </thead>
          <tbody>
            ${filteredRuns.length ? filteredRuns.slice(0, 30).map((r) => `
            <tr class="border-b border-slate-100 dark:border-slate-700">
              <td class="py-2 px-4"><a href="/admin/agent" class="text-emerald-600 hover:text-emerald-700 dark:text-emerald-400">${escapeHtml(r.runId)}</a></td>
              <td class="py-2 px-4">${escapeHtml(r.model || '—')}</td>
              <td class="py-2 px-4">${escapeHtml(r.runMode || 'pr')}</td>
              <td class="py-2 px-4">${fmt(r.inputTokens)} / ${fmt(r.outputTokens)}${(r.cachedTokens || 0) > 0 ? ' <span class="text-slate-400" title="Cached tokens (discounted)">(' + fmt(r.cachedTokens) + ' cached)</span>' : ''}</td>
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
 + (Number(c) || 0).toFixed(4);
    // Chart uses dailyRows data (ascending for chart)
    const chartRowsAsc = [...dailyRows].sort((a, b) => a.date.localeCompare(b.date)).slice(-14);
    const sortedDates = chartRowsAsc.map((r) => r.date);
    const chartLabels = JSON.stringify(sortedDates);
    const chartValues = JSON.stringify(chartRowsAsc.map((r) => r.totalCost));
    const nonce = res.locals.nonce || '';
    const scriptNonce = nonce ? ` nonce="${escapeHtml(nonce)}"` : '';

    // All model keys across dailyRows for table columns
    const allModelKeys = Array.from(new Set(dailyRows.flatMap((d) => Object.keys(d.byModel || {})))).sort();

    // Trend display
    const { total30, dailyAvg, todayCost, trendPct, peakDay } = summaryMetrics;
    const trendStr = trendPct === null ? '—' : (trendPct >= 0 ? '↑' : '↓') + ' ' + Math.abs(trendPct).toFixed(1) + '% vs prev ' + daysBack + ' days';
    const trendColor = trendPct === null ? 'text-slate-500 dark:text-slate-400' : trendPct > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400';

    const content = `
  ${adminNav('cost', false, nonce)}
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
              <th class="py-2 px-4">In / Out / Cached</th>
              <th class="py-2 px-4">Est. cost</th>
            </tr>
          </thead>
          <tbody>
            ${runs.length ? runs.slice(0, 30).map((r) => `
            <tr class="border-b border-slate-100 dark:border-slate-700">
              <td class="py-2 px-4"><a href="/admin/agent" class="text-emerald-600 hover:text-emerald-700 dark:text-emerald-400">${escapeHtml(r.runId)}</a></td>
              <td class="py-2 px-4">${escapeHtml(r.model || '—')}</td>
              <td class="py-2 px-4">${escapeHtml(r.runMode || 'pr')}</td>
              <td class="py-2 px-4">${fmt(r.inputTokens)} / ${fmt(r.outputTokens)}${(r.cachedTokens || 0) > 0 ? ' <span class="text-slate-400" title="Cached tokens (discounted)">(' + fmt(r.cachedTokens) + ' cached)</span>' : ''}</td>
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
 + (Number(c) || 0).toFixed(4);

    // Chart uses dailyRows data (ascending, last 14 days)
    const chartRowsAsc = [...dailyRows].sort((a, b) => a.date.localeCompare(b.date)).slice(-14);
    const chartLabels = JSON.stringify(chartRowsAsc.map((r) => r.date));
    const chartValues = JSON.stringify(chartRowsAsc.map((r) => r.totalCost));
    const nonce = res.locals.nonce || '';
    const scriptNonce = nonce ? ` nonce="${escapeHtml(nonce)}"` : '';

    // All model keys across dailyRows for table columns
    const allModelKeys = Array.from(new Set(dailyRows.flatMap((d) => Object.keys(d.byModel || {})))).sort();

    // Trend display
    const { total30, dailyAvg, todayCost, trendPct, peakDay } = summaryMetrics;
    const trendStr = trendPct === null ? '—' : (trendPct >= 0 ? '↑' : '↓') + ' ' + Math.abs(trendPct).toFixed(1) + '% vs prev ' + daysBack + ' days';
    const trendColor = trendPct === null ? 'text-slate-500 dark:text-slate-400' : trendPct > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400';

    // Day-over-day % change for daily breakdown table
    const dailyRowsWithChange = dailyRows.map((row, i) => {
        const prev = dailyRows[i + 1];
        const pct = prev && prev.totalCost > 0 ? ((row.totalCost - prev.totalCost) / prev.totalCost) * 100 : null;
        return { ...row, dodPct: pct };
    });

    const content = `
  ${adminNav('cost', false, nonce)}
  ${adminContainer(`
    ${breadcrumb([{ href: '/admin', label: 'Dashboard' }, { label: 'Cost' }])}
    <div class="flex items-center justify-between mb-8">
      <h1 class="text-2xl font-semibold text-slate-800 dark:text-slate-100">Cost</h1>
      <a href="/admin" class="text-sm font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">Dashboard</a>
    </div>
    <p class="text-slate-600 dark:text-slate-400 mb-6">Token usage and estimated cost for Missions. Estimates are based on list price and may differ from actual billing.</p>
    <!-- Filter bar -->
    <div class="flex items-center gap-2 mb-6">
      ${[7, 30, 90].map((n) => `<a href="/admin/cost?range=${n}" class="px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${daysBack === n ? 'bg-emerald-600 text-white border-emerald-600' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}">Last ${n} Days</a>`).join('')}
    </div>
    <!-- Summary cards -->
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
      <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
        <p class="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Total Spend</p>
        <p class="text-2xl font-semibold text-slate-800 dark:text-slate-100">${costFmt(total30)}</p>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Last ${daysBack} days</p>
      </div>
      <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
        <p class="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Daily Average</p>
        <p class="text-2xl font-semibold text-slate-800 dark:text-slate-100">${costFmt(dailyAvg)}</p>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Over ${daysBack}-day window</p>
      </div>
      <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
        <p class="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Most Recent Day</p>
        <p class="text-2xl font-semibold text-slate-800 dark:text-slate-100">${costFmt(todayCost)}</p>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">${new Date().toISOString().split('T')[0]}</p>
      </div>
      <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
        <p class="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Week-over-Week Trend</p>
        <p class="text-2xl font-semibold ${trendColor}">${escapeHtml(trendStr)}</p>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">${peakDay ? 'Peak: ' + escapeHtml(peakDay.date) + ' (' + costFmt(peakDay.totalCost) + ')' : 'No data'}</p>
      </div>
    </div>
    <!-- Daily breakdown table -->
    <section class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden mb-8">
      <div class="border-b border-slate-200 dark:border-slate-700 px-4 py-2.5 bg-slate-50 dark:bg-slate-900/50 text-sm font-medium text-slate-700 dark:text-slate-300">Daily Breakdown</div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-slate-200 dark:border-slate-700 text-left text-slate-500 dark:text-slate-400">
              <th class="py-2 px-4">Date</th>
              <th class="py-2 px-4">Total Cost</th>
              ${allModelKeys.map((m) => `<th class="py-2 px-4">${escapeHtml(m)}</th>`).join('')}
              <th class="py-2 px-4">Day-over-Day % Change</th>
            </tr>
          </thead>
          <tbody>
            ${dailyRowsWithChange.length ? dailyRowsWithChange.map((row, i) => `
            <tr class="border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 ${i % 2 === 1 ? 'bg-slate-50 dark:bg-slate-800/50' : ''}">
              <td class="py-2 px-4 font-mono">${escapeHtml(row.date)}</td>
              <td class="py-2 px-4 font-medium">${costFmt(row.totalCost)}</td>
              ${allModelKeys.map((m) => `<td class="py-2 px-4">${row.byModel[m] ? costFmt(row.byModel[m]) : '—'}</td>`).join('')}
              <td class="py-2 px-4 ${row.dodPct === null ? 'text-slate-400' : row.dodPct > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}">${row.dodPct === null ? '—' : (row.dodPct >= 0 ? '↑' : '↓') + ' ' + Math.abs(row.dodPct).toFixed(1) + '%'}</td>
            </tr>
            `).join('') : '<tr><td colspan="' + (3 + allModelKeys.length) + '" class="py-4 px-4 text-slate-500 dark:text-slate-400">No data in this period.</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
    <!-- Provider summary -->
    <div class="grid gap-4 sm:grid-cols-2 mb-8">
      <section class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6" aria-label="Gemini provider stats">
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
    <!-- Chart -->
    <div class="mb-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6">
      <h2 class="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-4">Daily Spending — Last ${daysBack} Days</h2>
      <div style="height: 250px;"><canvas id="costChart"></canvas></div>
    </div>
    <!-- Recent runs -->
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
          <tbody>
            ${runs.length ? runs.slice(0, 30).map((r) => `
            <tr class="border-b border-slate-100 dark:border-slate-700">
              <td class="py-2 px-4"><a href="/admin/agent" class="text-emerald-600 hover:text-emerald-700 dark:text-emerald-400">${escapeHtml(r.runId)}</a></td>
              <td class="py-2 px-4">${escapeHtml(r.model || '—')}</td>
              <td class="py-2 px-4">${escapeHtml(r.runMode || 'pr')}</td>
              <td class="py-2 px-4">${fmt(r.inputTokens)} / ${fmt(r.outputTokens)}${(r.cachedTokens || 0) > 0 ? ' <span class="text-slate-400" title="Cached tokens (discounted)">(' + fmt(r.cachedTokens) + ' cached)</span>' : ''}</td>
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
        // Claude: cache reads at 0.1x base input price (platform.claude.com/docs/about-claude/pricing)
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

async function getAggregatedUsage(daysBack = 30) {
    const memoryRuns = listRuns(50);
    let historyRuns = [];
    try {
        const keys = await listAllS3KeysWithPrefix('admin/agent-runs/');
        const sorted = keys
            .sort((a, b) => new Date(b.LastModified || 0) - new Date(a.LastModified || 0));
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
    const allRuns = Array.from(byId.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const windowStart = Date.now() - daysBack * 24 * 60 * 60 * 1000;
    const runs = allRuns.filter((r) => (r.createdAt || 0) >= windowStart);

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

    // Build dailyRows: group by UTC calendar date, descending
    const dailyMap = {};
    runsWithCost.forEach((r) => {
        const dateStr = r.createdAt ? new Date(r.createdAt).toISOString().split('T')[0] : 'unknown';
        if (!dailyMap[dateStr]) dailyMap[dateStr] = { date: dateStr, totalCost: 0, byModel: {}, runs: 0 };
        dailyMap[dateStr].totalCost += r.cost;
        dailyMap[dateStr].runs += 1;
        const mid = r.model || 'unknown';
        dailyMap[dateStr].byModel[mid] = (dailyMap[dateStr].byModel[mid] || 0) + r.cost;
    });
    const dailyRows = Object.values(dailyMap).sort((a, b) => b.date.localeCompare(a.date));

    // Compute summaryMetrics
    const total30 = runsWithCost.reduce((s, r) => s + r.cost, 0);
    const dailyAvg = dailyRows.length > 0 ? total30 / daysBack : 0;
    const todayStr = new Date().toISOString().split('T')[0];
    const todayCost = (dailyMap[todayStr] || { totalCost: 0 }).totalCost;
    // Previous window total: runs in the window before the current window
    const prevWindowStart = windowStart - daysBack * 24 * 60 * 60 * 1000;
    const prevWindowRuns = allRuns.filter((r) => (r.createdAt || 0) >= prevWindowStart && (r.createdAt || 0) < windowStart);
    const prevWindowTotal = prevWindowRuns.reduce((s, r) => {
        const cached = r.cachedTokens ?? r.cached_tokens ?? 0;
        return s + costForRun(r.model, r.inputTokens, r.outputTokens, cached);
    }, 0);
    const trendPct = prevWindowTotal > 0 ? ((total30 - prevWindowTotal) / prevWindowTotal) * 100 : null;
    const peakDay = dailyRows.length > 0 ? dailyRows.reduce((best, d) => d.totalCost > best.totalCost ? d : best, dailyRows[0]) : null;
    const summaryMetrics = { total30, dailyAvg, todayCost, prevWindowTotal, trendPct, peakDay };

    return { byProvider, byModel, byDate, byMission, runs: runsWithCost, dailyRows, summaryMetrics };
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
    const range = parseInt(req.query.range, 10);
    const daysBack = [7, 30, 90].includes(range) ? range : 30;
    let usage = { byProvider: { gemini: { cost: 0, runs: 0, inputTokens: 0, outputTokens: 0 }, anthropic: { cost: 0, runs: 0, inputTokens: 0, outputTokens: 0 } }, byModel: {}, byDate: {}, byMission: {}, runs: [], dailyRows: [], summaryMetrics: { total30: 0, dailyAvg: 0, todayCost: 0, prevWindowTotal: 0, trendPct: null, peakDay: null } };
    try { usage = await getAggregatedUsage(daysBack); } catch (_) {}
    const { byProvider, byModel, byDate, byMission, runs, dailyRows, summaryMetrics } = usage;

    const fmt = (n) => (n || 0).toLocaleString();
    const costFmt = (c) => '

    // Day-over-day % change for daily breakdown table
    const dailyRowsWithChange = dailyRows.map((row, i) => {
        const prev = dailyRows[i + 1];
        const pct = prev && prev.totalCost > 0 ? ((row.totalCost - prev.totalCost) / prev.totalCost) * 100 : null;
        return { ...row, dodPct: pct };
    });

    const content = `
  ${adminNav('cost', false, nonce)}
  ${adminContainer(`
    ${breadcrumb([{ href: '/admin', label: 'Dashboard' }, { label: 'Cost' }])}
    <div class="flex items-center justify-between mb-8">
      <h1 class="text-2xl font-semibold text-slate-800 dark:text-slate-100">Cost</h1>
      <a href="/admin" class="text-sm font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">Dashboard</a>
    </div>
    <p class="text-slate-600 dark:text-slate-400 mb-6">Token usage and estimated cost for Missions. Estimates are based on list price and may differ from actual billing.</p>
    <div class="flex items-center gap-2 mb-6">
      <span class="text-sm text-slate-500 dark:text-slate-400">Range:</span>
      ${[7, 30, 90].map((d) => `<a href="/admin/cost?range=${d}" class="px-3 py-1 rounded-lg text-sm font-medium border ${range === d ? 'bg-emerald-600 text-white border-emerald-600' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}">${d === 7 ? 'Last 7 Days' : d === 30 ? 'Last 30 Days' : 'Last 90 Days'}</a>`).join('')}
    </div>
    <div class="grid gap-4 sm:grid-cols-3 mb-8">
      <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
        <p class="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Total Spend (${range}d)</p>
        <p class="text-2xl font-semibold text-slate-800 dark:text-slate-100">${costFmt(totalCost)}</p>
      </div>
      <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
        <p class="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Daily Average</p>
        <p class="text-2xl font-semibold text-slate-800 dark:text-slate-100">${costFmt(dailyAvg)}</p>
      </div>
      <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
        <p class="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Peak Day</p>
        <p class="text-2xl font-semibold text-slate-800 dark:text-slate-100">${peakDay ? peakDay : '—'}</p>
        ${peakDay ? `<p class="text-xs text-slate-500 dark:text-slate-400 mt-1">${costFmt(dailyMap[peakDay])}</p>` : ''}
      </div>
    </div>
    <div class="flex items-center gap-2 mb-6">
      <span class="text-sm text-slate-500 dark:text-slate-400 mr-1">Range:</span>
      ${[7, 30, 90].map((d) => `<a href="/admin/cost?range=${d}" class="px-3 py-1 rounded-lg border text-sm font-medium transition-colors ${rangeDays === d ? 'bg-emerald-600 text-white border-emerald-600' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}">Last ${d} days</a>`).join('')}
    </div>
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
      <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
        <p class="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Total Spend (${rangeDays}d)</p>
        <p class="text-2xl font-semibold text-slate-800 dark:text-slate-100">${costFmt(summary.total30d)}</p>
      </div>
      <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
        <p class="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Daily Average</p>
        <p class="text-2xl font-semibold text-slate-800 dark:text-slate-100">${costFmt(summary.dailyAverage)}</p>
      </div>
      <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
        <p class="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Peak Day</p>
        <p class="text-2xl font-semibold text-slate-800 dark:text-slate-100">${summary.peakDay ? costFmt(summary.peakDay.cost) : '—'}</p>
        ${summary.peakDay ? `<p class="text-xs text-slate-400 mt-1">${escapeHtml(summary.peakDay.date)}</p>` : ''}
      </div>
      <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
        <p class="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Week-over-Week Trend</p>
        <p class="text-2xl font-semibold ${trendColor}">${trendSign} ${pctFmt(Math.abs(summary.weekOverWeekTrend))}</p>
        <p class="text-xs text-slate-400 mt-1">vs prior 7 days</p>
      </div>
    </div>
    <!-- Filter bar -->
    <div class="flex items-center gap-2 mb-6">
      ${[7, 30, 90].map((n) => `<a href="/admin/cost?range=${n}" class="px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${daysBack === n ? 'bg-emerald-600 text-white border-emerald-600' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'}">Last ${n} Days</a>`).join('')}
    </div>
    <!-- Summary cards -->
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
      <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
        <p class="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Total Spend</p>
        <p class="text-2xl font-semibold text-slate-800 dark:text-slate-100">${costFmt(total30)}</p>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Last ${daysBack} days</p>
      </div>
      <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
        <p class="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Daily Average</p>
        <p class="text-2xl font-semibold text-slate-800 dark:text-slate-100">${costFmt(dailyAvg)}</p>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Over ${daysBack}-day window</p>
      </div>
      <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
        <p class="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Most Recent Day</p>
        <p class="text-2xl font-semibold text-slate-800 dark:text-slate-100">${costFmt(todayCost)}</p>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">${new Date().toISOString().split('T')[0]}</p>
      </div>
      <div class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
        <p class="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Week-over-Week Trend</p>
        <p class="text-2xl font-semibold ${trendColor}">${escapeHtml(trendStr)}</p>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">${peakDay ? 'Peak: ' + escapeHtml(peakDay.date) + ' (' + costFmt(peakDay.totalCost) + ')' : 'No data'}</p>
      </div>
    </div>
    <!-- Daily breakdown table -->
    <section class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden mb-8">
      <div class="border-b border-slate-200 dark:border-slate-700 px-4 py-2.5 bg-slate-50 dark:bg-slate-900/50 text-sm font-medium text-slate-700 dark:text-slate-300">Daily Breakdown</div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-slate-200 dark:border-slate-700 text-left text-slate-500 dark:text-slate-400">
              <th class="py-2 px-4">Date</th>
              <th class="py-2 px-4">Total Cost</th>
              ${allModelKeys.map((m) => `<th class="py-2 px-4">${escapeHtml(m)}</th>`).join('')}
              <th class="py-2 px-4">Day-over-Day % Change</th>
            </tr>
          </thead>
          <tbody>
            ${dailyRowsWithChange.length ? dailyRowsWithChange.map((row, i) => `
            <tr class="border-b border-slate-100 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700/50 ${i % 2 === 1 ? 'even:bg-slate-50 dark:even:bg-slate-800/50' : ''}">
              <td class="py-2 px-4 font-mono">${escapeHtml(row.date)}</td>
              <td class="py-2 px-4 font-medium">${costFmt(row.totalCost)}</td>
              ${allModelKeys.map((m) => `<td class="py-2 px-4">${row.byModel[m] ? costFmt(row.byModel[m]) : '—'}</td>`).join('')}
              <td class="py-2 px-4 ${row.dodPct === null ? 'text-slate-400' : row.dodPct > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}">${row.dodPct === null ? '—' : (row.dodPct >= 0 ? '↑' : '↓') + ' ' + Math.abs(row.dodPct).toFixed(1) + '%'}</td>
            </tr>
            `).join('') : '<tr><td colspan="' + (3 + allModelKeys.length) + '" class="py-4 px-4 text-slate-500 dark:text-slate-400">No data in this period.</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
    <div class="grid gap-4 sm:grid-cols-2 mb-8">
      <section class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6" aria-label="Gemini provider stats">
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
    <div class="mb-4 flex items-center gap-2">
      ${[7, 30, 90].map((r) => {
        const isActive = r === range;
        const cls = isActive
          ? 'bg-slate-700 text-white'
          : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700';
        return `<a href="/admin/cost?range=${r}" class="${cls} rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-sm font-medium transition-colors">Last ${r} Days</a>`;
      }).join('')}
    </div>
    <div class="mb-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6">
      <h2 class="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-4">Daily Spending — Last ${range} Days</h2>
      <div style="height: 250px;"><canvas id="costChart"></canvas></div>
    </div>
    <div class="mb-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
      <div class="border-b border-slate-200 dark:border-slate-700 px-4 py-2.5 bg-slate-50 dark:bg-slate-900/50 text-sm font-medium text-slate-700 dark:text-slate-300">Daily breakdown (last ${rangeDays} days)</div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-slate-200 dark:border-slate-700 text-left text-slate-500 dark:text-slate-400">
              <th class="py-2 px-4">Date</th>
              <th class="py-2 px-4">Total Cost</th>
              <th class="py-2 px-4">By Model</th>
            </tr>
          </thead>
          <tbody>
            ${dailyBreakdown.length ? [...dailyBreakdown].reverse().map((d) => `
            <tr class="border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
              <td class="py-2 px-4 font-mono text-slate-700 dark:text-slate-300">${escapeHtml(d.date)}</td>
              <td class="py-2 px-4 font-medium text-slate-800 dark:text-slate-100">${costFmt(d.totalCost)}</td>
              <td class="py-2 px-4 text-slate-500 dark:text-slate-400 text-xs">${Object.entries(d.byModel).sort((a, b) => b[1] - a[1]).map(([mid, c]) => `<span class="inline-block mr-2">${escapeHtml(mid)}: ${costFmt(c)}</span>`).join('')}</td>
            </tr>
            `).join('') : '<tr><td colspan="3" class="py-4 px-4 text-slate-500 dark:text-slate-400">No data for this period.</td></tr>'}
          </tbody>
        </table>
      </div>
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
              <th class="py-2 px-4">In / Out / Cached</th>
              <th class="py-2 px-4">Est. cost</th>
            </tr>
          </thead>
          <tbody>
            ${filteredRuns.length ? filteredRuns.slice(0, 30).map((r) => `
            <tr class="border-b border-slate-100 dark:border-slate-700">
              <td class="py-2 px-4"><a href="/admin/agent" class="text-emerald-600 hover:text-emerald-700 dark:text-emerald-400">${escapeHtml(r.runId)}</a></td>
              <td class="py-2 px-4">${escapeHtml(r.model || '—')}</td>
              <td class="py-2 px-4">${escapeHtml(r.runMode || 'pr')}</td>
              <td class="py-2 px-4">${fmt(r.inputTokens)} / ${fmt(r.outputTokens)}${(r.cachedTokens || 0) > 0 ? ' <span class="text-slate-400" title="Cached tokens (discounted)">(' + fmt(r.cachedTokens) + ' cached)</span>' : ''}</td>
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
 + (Number(c) || 0).toFixed(4);
    // Chart uses dailyRows data (ascending for chart)
    const chartRowsAsc = [...dailyRows].sort((a, b) => a.date.localeCompare(b.date)).slice(-14);
    const sortedDates = chartRowsAsc.map((r) => r.date);
    const chartLabels = JSON.stringify(sortedDates);
    const chartValues = JSON.stringify(chartRowsAsc.map((r) => r.totalCost));
    const nonce = res.locals.nonce || '';
    const scriptNonce = nonce ? ` nonce="${escapeHtml(nonce)}"` : '';

    // All model keys across dailyRows for table columns
    const allModelKeys = Array.from(new Set(dailyRows.flatMap((d) => Object.keys(d.byModel || {})))).sort();

    // Trend display
    const { total30, dailyAvg, todayCost, trendPct, peakDay } = summaryMetrics;
    const trendStr = trendPct === null ? '—' : (trendPct >= 0 ? '↑' : '↓') + ' ' + Math.abs(trendPct).toFixed(1) + '% vs prev ' + daysBack + ' days';
    const trendColor = trendPct === null ? 'text-slate-500 dark:text-slate-400' : trendPct > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400';

    const content = `
  ${adminNav('cost', false, nonce)}
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
              <th class="py-2 px-4">In / Out / Cached</th>
              <th class="py-2 px-4">Est. cost</th>
            </tr>
          </thead>
          <tbody>
            ${runs.length ? runs.slice(0, 30).map((r) => `
            <tr class="border-b border-slate-100 dark:border-slate-700">
              <td class="py-2 px-4"><a href="/admin/agent" class="text-emerald-600 hover:text-emerald-700 dark:text-emerald-400">${escapeHtml(r.runId)}</a></td>
              <td class="py-2 px-4">${escapeHtml(r.model || '—')}</td>
              <td class="py-2 px-4">${escapeHtml(r.runMode || 'pr')}</td>
              <td class="py-2 px-4">${fmt(r.inputTokens)} / ${fmt(r.outputTokens)}${(r.cachedTokens || 0) > 0 ? ' <span class="text-slate-400" title="Cached tokens (discounted)">(' + fmt(r.cachedTokens) + ' cached)</span>' : ''}</td>
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
