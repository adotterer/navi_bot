/**
 * Agent PR routes: main page, start run, SSE stream.
 */
import express from 'express';
import { adminHead, adminNav, adminContainer, breadcrumb, escapeHtml } from '../layout.js';
import { createRun, getRun, updateRun, subscribe, listRuns, setRunCancelled, hydrateRun, deleteRun, DEFAULT_DOCS } from './runStore.js';
import { runPipeline } from './orchestrator.js';
import { listBranches, getTree, getFileContent } from './repoBrowser.js';
import { loadRunFromS3, loadRunMetadataFromS3, persistRunToS3 } from './agentRunPersistence.js';
import { listS3KeysWithPrefix, deleteFromS3 } from '../../shared/s3Helper.js';
import { getAgentPrompt, saveAgentPrompt, resetAgentPromptToDefault, listAgentPromptIds } from './agentPromptLoader.js';
import { listModelsForMissions } from './agents.js';

const router = express.Router();
const SSE_HEARTBEAT_MS = 15000;

// ----- GET /admin/agent – main page -----
router.get('/', (req, res) => {
    const content = `
  ${adminNav('agent')}
  ${adminContainer(`
    ${breadcrumb([{ href: '/admin', label: 'Dashboard' }, { label: 'Missions' }])}
    <div class="flex items-center justify-between mb-8">
      <h1 class="text-2xl font-semibold text-slate-800 dark:text-slate-100">Missions</h1>
      <a href="/admin/agent/prompts" class="text-sm font-medium text-emerald-600 hover:text-emerald-700">Edit agent prompts</a>
    </div>
    <p class="text-slate-600 dark:text-slate-400 mb-6">Describe a mission; the AI will create a flight plan, implementation steps, and open a PR for you to review.</p>
    <section class="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden w-full mb-4">
      <button type="button" id="past-runs-toggle" class="w-full flex items-center gap-2 px-4 py-2.5 bg-slate-50 dark:bg-slate-900/50 text-sm font-medium text-slate-700 dark:text-slate-300 text-left hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
        <span>Recent runs</span>
        <span id="past-runs-count" class="text-xs text-slate-400 font-normal"></span>
        <span id="past-runs-chevron" class="ml-auto text-slate-400 text-xs">▾</span>
      </button>
      <div id="past-runs-list" class="divide-y divide-slate-100 max-h-60 overflow-y-auto hidden">
        <p id="past-runs-empty" class="px-4 py-3 text-sm text-slate-400">No past runs found.</p>
      </div>
    </section>
    <div class="flex flex-col gap-6 mb-8">
      <section class="rounded-xl border border-slate-200 bg-white overflow-hidden w-full">
        <div class="border-b border-slate-200 px-4 py-2.5 bg-slate-50 text-sm font-medium text-slate-700">Mission prompt</div>
        <form id="agent-form" class="flex flex-col p-4 gap-4">
          <textarea id="prompt" name="prompt" rows="4" placeholder="e.g. Add a health check endpoint at GET /health that returns { status: 'ok' }"
            class="w-full min-h-[100px] rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none font-mono text-sm resize-y"></textarea>
          <div class="flex flex-wrap gap-4 items-end">
            <div>
              <label for="model" class="block text-xs font-medium text-slate-500 mb-1">Model <span class="font-normal text-slate-400">(hover for use-case)</span></label>
              <select id="model" name="model" class="rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none text-sm min-w-[180px]">
                <option value="">Loading…</option>
              </select>
            </div>
            <div>
              <label for="maxPlanners" class="block text-xs font-medium text-slate-500 mb-1">Max planners</label>
              <input type="number" id="maxPlanners" name="maxPlanners" min="1" max="5" value="2"
                class="w-20 rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none" />
            </div>
            <div>
              <label for="maxCoders" class="block text-xs font-medium text-slate-500 mb-1">Max coders</label>
              <input type="number" id="maxCoders" name="maxCoders" min="1" max="10" value="3"
                class="w-20 rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none" />
            </div>
            <div class="flex items-center gap-2">
              <button type="button" id="start-btn" class="rounded-lg bg-emerald-600 text-white font-medium py-2.5 px-5 hover:enabled:bg-emerald-700 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 transition-colors disabled:bg-slate-300 disabled:text-slate-400 disabled:cursor-not-allowed">Start run</button>
              <button type="button" id="stop-btn" disabled class="rounded-lg bg-red-600 text-white font-medium py-2.5 px-5 hover:enabled:bg-red-700 focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors disabled:bg-slate-300 disabled:text-slate-400 disabled:cursor-not-allowed" title="Stop the current run — work so far is saved to S3">Stop run</button>
              <button type="button" id="resume-btn" class="hidden rounded-lg bg-amber-500 text-white font-medium py-2.5 px-5 hover:bg-amber-600 focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 transition-colors">Resume</button>
            </div>
          </div>
        </form>
      </section>
      <div class="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden min-h-[420px] flex flex-col">
        <div id="run-area" class="hidden flex flex-col flex-1 min-h-0 overflow-hidden">
          <div class="flex flex-col flex-1 min-h-0 p-4 gap-4 overflow-auto">
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-shrink-0">
              <section class="rounded-lg border border-slate-200 bg-white overflow-hidden flex flex-col flex-1 min-h-[200px]">
                <div class="border-b border-slate-200 px-4 py-2 bg-slate-50 text-sm font-medium text-slate-700 flex-shrink-0 flex items-center gap-3">
                  <span>Audit log</span>
                  <span id="run-timer" class="ml-auto text-xs font-mono text-slate-400 tabular-nums hidden">0:00</span>
                </div>
                <div id="log-container" class="bg-slate-900 text-slate-100 p-4 font-mono text-sm flex-1 overflow-y-auto whitespace-pre-wrap break-words"></div>
                <div id="run-tokens-bar" class="hidden border-t border-slate-100 px-4 py-1.5 text-xs text-slate-400 flex items-center gap-1">
                  <span id="run-tokens"></span>
                </div>
              </section>
              <section class="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
                <div class="flex items-center gap-3 flex-wrap">
                  <span id="run-status" class="text-sm font-medium text-slate-700">Running…</span>
                  <span id="run-stage" class="text-sm text-slate-500"></span>
                </div>
                <div class="text-xs text-slate-500 mb-1">Mission</div>
                <div id="run-mission" class="p-2 text-sm text-slate-700 whitespace-pre-wrap break-words bg-slate-50 rounded min-h-[2rem] mb-3"></div>
                <div id="pipeline-area" class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <div class="flex flex-wrap items-center gap-2 text-sm">
                    <span id="phase-researcher" class="phase px-3 py-1.5 rounded-full border border-slate-200 text-slate-500 font-medium transition-all">Researcher</span>
                    <span class="text-slate-300">\u2192</span>
                    <span id="phase-planner" class="phase px-3 py-1.5 rounded-full border border-slate-200 text-slate-500 font-medium transition-all">Planner</span>
                    <span class="text-slate-300">\u2192</span>
                    <span id="phase-coder" class="phase px-3 py-1.5 rounded-full border border-slate-200 text-slate-500 font-medium transition-all">Coder</span>
                    <span class="text-slate-300">\u2192</span>
                    <span id="phase-review" class="phase px-3 py-1.5 rounded-full border border-slate-200 text-slate-500 font-medium transition-all">Review</span>
                    <span class="text-slate-300">\u2192</span>
                    <span id="phase-pr" class="phase px-3 py-1.5 rounded-full border border-slate-200 text-slate-500 font-medium transition-all">Create PR</span>
                  </div>
                </div>
                <div id="result-area" class="rounded-lg border border-slate-200 bg-emerald-50/50 p-4 hidden mt-2">
                  <a id="pr-link" href="#" target="_blank" rel="noopener" class="text-emerald-700 hover:text-emerald-800 font-medium underline">Open PR</a>
                  <p id="error-msg" class="text-red-600 text-sm mt-2 hidden"></p>
                  <p id="result-note" class="text-slate-500 text-xs mt-2 hidden"></p>
                </div>
              </section>
            </div>
            <section id="docs-panel" class="rounded-lg border border-slate-200 bg-white overflow-hidden flex-shrink-0 hidden">
              <div class="border-b border-slate-200 px-4 py-2 bg-slate-50 text-sm font-medium text-slate-700">Docs</div>
              <div class="p-4 space-y-4 max-h-[320px] overflow-y-auto">
                <div>
                  <label class="block text-xs font-medium text-slate-500 mb-1">Mission</label>
                  <div id="docs-mission" class="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 bg-slate-50 whitespace-pre-wrap min-h-[3rem]"></div>
                </div>
                <div><label class="block text-xs font-medium text-slate-500 mb-1">Overview</label><textarea id="docs-overview" data-section="overview" rows="2" class="docs-textarea w-full rounded-lg border border-slate-300 px-3 py-2 text-sm resize-y"></textarea></div>
                <div><label class="block text-xs font-medium text-slate-500 mb-1">Requirements</label><textarea id="docs-requirements" data-section="requirements" rows="2" class="docs-textarea w-full rounded-lg border border-slate-300 px-3 py-2 text-sm resize-y"></textarea></div>
                <div><label class="block text-xs font-medium text-slate-500 mb-1">Architecture</label><textarea id="docs-architecture" data-section="architecture" rows="2" class="docs-textarea w-full rounded-lg border border-slate-300 px-3 py-2 text-sm resize-y"></textarea></div>
                <div><label class="block text-xs font-medium text-slate-500 mb-1">Decisions</label><textarea id="docs-decisions" data-section="decisions" rows="2" class="docs-textarea w-full rounded-lg border border-slate-300 px-3 py-2 text-sm resize-y"></textarea></div>
                <div><label class="block text-xs font-medium text-slate-500 mb-1">Notes</label><textarea id="docs-notes" data-section="notes" rows="2" class="docs-textarea w-full rounded-lg border border-slate-300 px-3 py-2 text-sm resize-y"></textarea></div>
                <div>
                  <label class="block text-xs font-medium text-slate-500 mb-1">Implementation plan</label>
                  <div id="docs-implementation" class="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 bg-slate-50 whitespace-pre-wrap min-h-[2rem]"></div>
                </div>
                <button type="button" id="docs-save-btn" class="rounded-lg bg-emerald-600 text-white font-medium py-1.5 px-4 text-sm hover:bg-emerald-700">Save docs</button>
              </div>
            </section>
            <section id="step-results-area" class="rounded-lg border border-slate-200 bg-white overflow-hidden hidden flex-shrink-0">
              <div class="border-b border-slate-200 px-4 py-2 bg-slate-50 text-sm font-medium text-slate-700">Step results</div>
              <ul id="step-results-list" class="p-4 list-disc list-inside text-sm text-slate-600 space-y-1"></ul>
            </section>
          </div>
          <div id="files-area" class="mx-4 mb-4 hidden border border-slate-200 rounded-lg bg-white overflow-hidden flex-shrink-0">
            <div class="border-b border-slate-200 px-3 py-2 bg-slate-50 text-sm font-medium text-slate-700">Proposed changes</div>
            <div class="flex min-h-[320px]">
              <div id="files-sidebar" class="w-56 border-r border-slate-200 bg-slate-50 overflow-y-auto flex-shrink-0">
                <ul id="files-list" class="py-2 text-sm"></ul>
              </div>
              <div id="files-content-wrap" class="flex-1 min-w-0 flex flex-col bg-slate-900">
                <div id="files-content-header" class="px-3 py-1.5 bg-slate-800 text-slate-300 text-sm font-mono truncate border-b border-slate-700"></div>
                <div id="files-content" class="flex-1 overflow-auto p-4 font-mono text-sm text-slate-100 whitespace-pre-wrap break-words"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="border border-slate-200 rounded-lg bg-white overflow-hidden mb-8">
      <div class="border-b border-slate-200 px-3 py-2 bg-slate-50 flex items-center gap-3">
        <span class="text-sm font-medium text-slate-700">Repository</span>
        <select id="repo-branch" class="rounded border border-slate-300 px-2 py-1 text-sm text-slate-800 bg-white"></select>
      </div>
      <div class="flex min-h-[400px]">
        <div id="repo-sidebar" class="w-60 border-r border-slate-200 bg-slate-50 overflow-y-auto flex-shrink-0">
          <ul id="repo-tree" class="py-2 text-sm"><li class="px-3 py-2 text-slate-500 text-sm">Loading…</li></ul>
        </div>
        <div id="repo-content-wrap" class="flex-1 min-w-0 flex flex-col bg-slate-900">
          <div id="repo-content-header" class="px-3 py-1.5 bg-slate-800 text-slate-300 text-sm font-mono truncate border-b border-slate-700"></div>
          <div id="repo-content" class="flex-1 overflow-auto p-4 font-mono text-sm text-slate-100 whitespace-pre-wrap break-words"></div>
        </div>
      </div>
    </div>
    <script>
(function(){
  var form = document.getElementById('agent-form');
  var startBtn = document.getElementById('start-btn');
  var runArea = document.getElementById('run-area');
  var runStatus = document.getElementById('run-status');
  var runStage = document.getElementById('run-stage');
  var logContainer = document.getElementById('log-container');
  var stopBtn = document.getElementById('stop-btn');
  var resultArea = document.getElementById('result-area');
  var prLink = document.getElementById('pr-link');
  var errorMsg = document.getElementById('error-msg');
  var currentRunId = null;
  var eventSource = null;
  var runStartedAt = 0;
  var timerInterval = null;

  function startTimer(startTs) {
    runStartedAt = startTs || Date.now();
    clearInterval(timerInterval);
    var timerEl = document.getElementById('run-timer');
    if (timerEl) { timerEl.textContent = '0:00'; timerEl.classList.remove('hidden'); }
    timerInterval = setInterval(function() {
      var secs = Math.floor((Date.now() - runStartedAt) / 1000);
      var m = Math.floor(secs / 60), s = secs % 60;
      var timerEl2 = document.getElementById('run-timer');
      if (timerEl2) timerEl2.textContent = m + ':' + (s < 10 ? '0' : '') + s;
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  function updateTokenDisplay(inT, outT) {
    if (inT == null && outT == null) return;
    inT = inT || 0; outT = outT || 0;
    if (inT === 0 && outT === 0) return;
    var cost = ((inT / 1e6) * 0.075) + ((outT / 1e6) * 0.30);
    var bar = document.getElementById('run-tokens-bar');
    var el = document.getElementById('run-tokens');
    if (el) el.textContent = inT.toLocaleString() + ' in / ' + outT.toLocaleString() + ' out tokens — Est. $' + cost.toFixed(4);
    if (bar) bar.classList.remove('hidden');
  }

  var filesArea = document.getElementById('files-area');
  var filesList = document.getElementById('files-list');
  var filesContentHeader = document.getElementById('files-content-header');
  var filesContent = document.getElementById('files-content');

  var docsPanel = document.getElementById('docs-panel');
  var docsSaveBtn = document.getElementById('docs-save-btn');
  var resumeBtn = document.getElementById('resume-btn');

  var repoBranch = document.getElementById('repo-branch');
  var repoTree = document.getElementById('repo-tree');
  var repoContentHeader = document.getElementById('repo-content-header');
  var repoContent = document.getElementById('repo-content');
  var repoExpanded = {};
  var repoTreeCache = {};

  (function loadModels() {
    var sel = document.getElementById('model');
    if (!sel) return;
    fetch('/admin/agent/models', { credentials: 'same-origin' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var models = data.models || [];
        var defaultId = data.default || (models[0] && models[0].id) || '';
        sel.innerHTML = '';
        models.forEach(function(m) {
          var opt = document.createElement('option');
          opt.value = m.id;
          var label = m.displayName || m.id;
          if (m.sortTier === 0) label = '\u2605 ' + label;
          opt.textContent = label;
          if (m.hint) opt.title = m.hint;
          sel.appendChild(opt);
        });
        if (defaultId) sel.value = defaultId;
      })
      .catch(function() {
        sel.innerHTML = '<option value="gemini-3-flash-preview" title="Best for Missions: fast, strong at code and planning.">\u2605 gemini-3-flash-preview</option>';
        sel.value = 'gemini-3-flash-preview';
      });
  })();

  function updateDocsPanelOnly(docs) {
    if (!docs || typeof docs !== 'object') return;
    ['overview', 'requirements', 'architecture', 'decisions', 'notes'].forEach(function(section) {
      var el = document.getElementById('docs-' + section);
      if (el && el.tagName === 'TEXTAREA') el.value = docs[section] || '';
    });
    if (docsPanel) docsPanel.classList.remove('hidden');
  }

  function populateDocsPanel(data) {
    if (!data) return;
    var missionEl = document.getElementById('docs-mission');
    if (missionEl) missionEl.textContent = (data.prompt || '').trim() || "(No mission)";
    var docs = data.docs || {};
    ['overview', 'requirements', 'architecture', 'decisions', 'notes'].forEach(function(section) {
      var el = document.getElementById('docs-' + section);
      if (el && el.tagName === 'TEXTAREA') el.value = docs[section] || '';
    });
    var implEl = document.getElementById('docs-implementation');
    if (implEl) {
      var parts = [];
      if (data.flightPlan && data.flightPlan.length) {
        data.flightPlan.forEach(function(t, i) {
          parts.push((i + 1) + '. ' + (t.title || 'Task'));
        });
      }
      if (data.steps && data.steps.length) {
        data.steps.forEach(function(s, i) {
          var what = s.step && s.step.what ? s.step.what : 'Step ' + (i + 1);
          parts.push('  - ' + what);
        });
      }
      implEl.textContent = parts.length ? parts.join(String.fromCharCode(10)) : "(No plan yet)";
    }
    if (docsPanel) docsPanel.classList.remove("hidden");
  }

  function saveDocSection(section, content) {
    if (!currentRunId || !section) return;
    fetch('/admin/agent/run/' + encodeURIComponent(currentRunId) + '/docs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ section: section, content: content || '' })
    }).catch(function() {});
  }

  function updateResumeButton(status) {
    if (!resumeBtn) return;
    if (status === 'cancelled' || status === 'error') {
      resumeBtn.classList.remove('hidden');
    } else {
      resumeBtn.classList.add('hidden');
    }
  }

  function updatePipeline(status, runData) {
    runData = runData || {};
    var statusToPhase = { research: 'researcher', planning: 'planning', coding: 'coding', reviewing: 'reviewing', creating_pr: 'creating_pr', done: 'creating_pr', error: 'creating_pr', cancelled: 'creating_pr' };
    var current = statusToPhase[status] || status;
    var labels = {
      researcher: 'Researcher',
      planning: runData.flightPlan && runData.flightPlan.length ? 'Planner (' + runData.flightPlan.length + ' tasks)' : 'Planner',
      coding: runData.stepResults && runData.stepResults.length ? 'Coder (' + runData.stepResults.length + ' steps)' : 'Coder',
      reviewing: 'Review',
      creating_pr: 'Create PR'
    };
    var order = ['researcher', 'planning', 'coding', 'reviewing', 'creating_pr'];
    order.forEach(function(phase, i) {
      var phaseId = phase === 'planning' ? 'planner' : phase === 'creating_pr' ? 'pr' : phase === 'reviewing' ? 'review' : phase === 'coding' ? 'coder' : phase;
      var el = document.getElementById('phase-' + phaseId);
      if (!el) return;
      el.textContent = labels[phase] || el.textContent;
      el.className = 'phase px-3 py-1.5 rounded-full border text-sm font-medium transition-all ';
      var idx = order.indexOf(phase);
      var currentIdx = order.indexOf(current);
      if (status === 'done' || status === 'cancelled') {
        el.className += 'border-slate-200 text-emerald-600 bg-emerald-50';
      } else if (status === 'error' && idx < order.length - 1) {
        el.className += 'border-slate-200 text-emerald-600 bg-emerald-50';
      } else if (status === 'error' && idx === order.length - 1) {
        el.className += 'border-red-200 text-red-700 bg-red-50';
      } else if (idx < currentIdx) {
        el.className += 'border-emerald-200 text-emerald-700 bg-emerald-50';
      } else if (idx === currentIdx) {
        el.className += 'border-amber-300 text-amber-800 bg-amber-50 animate-pulse';
      } else {
        el.className += 'border-slate-200 text-slate-500';
      }
    });
  }

  function repoCacheKey(branch, path) { return branch + ':' + (path || ''); }
  function fetchTree(branch, path, cb) {
    var key = repoCacheKey(branch, path);
    if (repoTreeCache[key]) return cb(null, repoTreeCache[key]);
    fetch('/admin/agent/repo/tree?branch=' + encodeURIComponent(branch) + '&path=' + encodeURIComponent(path || ''), { credentials: 'same-origin' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.ok) { repoTreeCache[key] = data.entries; cb(null, data.entries); }
        else cb(data.error);
      })
      .catch(function(e) { cb(e.message); });
  }
  function fetchFile(branch, path, cb) {
    fetch('/admin/agent/repo/file?branch=' + encodeURIComponent(branch) + '&path=' + encodeURIComponent(path), { credentials: 'same-origin' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.ok) cb(null, data.content);
        else cb(data.error);
      })
      .catch(function(e) { cb(e.message); });
  }
  function renderRepoTree(branch, path, parentEl) {
    parentEl.innerHTML = '<li class="px-3 py-1 text-slate-500 text-xs">Loading…</li>';
    fetchTree(branch, path, function(err, entries) {
      parentEl.innerHTML = '';
      if (err) { parentEl.innerHTML = '<li class="px-3 py-1 text-red-600 text-xs">' + escapeHtml(err) + '</li>'; return; }
      if (!entries || !entries.length) return;
      entries.forEach(function(e) {
        var li = document.createElement('li');
        var entryPath = e.path;
        var entryName = e.name;
        var entryType = e.type;
        li.dataset.path = entryPath;
        li.dataset.type = entryType;
        li.dataset.name = entryName;
        if (entryType === 'dir') {
          li.className = 'repo-dir cursor-pointer px-3 py-1 hover:bg-slate-200 flex items-center gap-1';
          li.innerHTML = '<span class="repo-dir-icon text-slate-500">\u25B6</span><span class="truncate">' + escapeHtml(entryName) + '</span>';
          li.addEventListener('click', function(ev) {
            ev.stopPropagation();
            var key = repoCacheKey(branch, entryPath);
            var isExpanded = repoExpanded[key];
            if (isExpanded) {
              var child = li.querySelector('ul');
              if (child) child.remove();
              li.querySelector('.repo-dir-icon').textContent = '\u25B6';
              repoExpanded[key] = false;
            } else {
              var ul = document.createElement('ul');
              ul.className = 'pl-4 border-l border-slate-200 ml-2 text-sm';
              li.appendChild(ul);
              renderRepoTree(branch, entryPath, ul);
              li.querySelector('.repo-dir-icon').textContent = '\u25BC';
              repoExpanded[key] = true;
            }
          });
        } else {
          li.className = 'repo-file cursor-pointer px-3 py-1 hover:bg-slate-200 flex items-center gap-1 pl-6';
          li.innerHTML = '<span class="truncate text-slate-700">' + escapeHtml(entryName) + '</span>';
          li.addEventListener('click', function(ev) {
            ev.stopPropagation();
            repoContentHeader.textContent = entryPath;
            repoContent.textContent = 'Loading…';
            fetchFile(branch, entryPath, function(err, content) {
              if (err) repoContent.textContent = err;
              else renderCodeBlock(repoContent, content, entryPath);
            });
          });
        }
        parentEl.appendChild(li);
      });
    });
  }
  function loadRepoBranch(branch) {
    repoTreeCache = {};
    repoExpanded = {};
    renderRepoTree(branch, '', repoTree);
    repoContentHeader.textContent = '';
    repoContent.textContent = 'Select a file';
  }
  fetch('/admin/agent/repo/branches', { credentials: 'same-origin' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.ok) return;
      repoBranch.innerHTML = data.branches.map(function(b) {
        return '<option value="' + escapeHtml(b) + '"' + (b === data.current ? ' selected' : '') + '>' + escapeHtml(b) + '</option>';
      }).join('');
      if (data.repoUnavailable) {
        repoTree.innerHTML = '<li class="px-3 py-2 text-slate-500 text-sm">Repo browser is only available when running from a git clone (e.g. locally).</li>';
        repoBranch.disabled = true;
      } else {
        loadRepoBranch(data.current || repoBranch.value);
        repoBranch.addEventListener('change', function() { loadRepoBranch(repoBranch.value); });
      }
    })
    .catch(function() {});

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function relativeTime(ts) {
    var diff = Date.now() - (ts || 0);
    var mins = Math.floor(diff / 60000);
    if (mins < 2) return 'just now';
    if (mins < 60) return mins + ' min ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + ' hr ago';
    var days = Math.floor(hrs / 24);
    return days + ' day' + (days === 1 ? '' : 's') + ' ago';
  }

  function loadPastRunsList() {
    var listEl = document.getElementById('past-runs-list');
    var emptyEl = document.getElementById('past-runs-empty');
    var countEl = document.getElementById('past-runs-count');
    if (!listEl) return;
    Promise.all([
      fetch('/admin/agent/runs', { credentials: 'same-origin' }).then(function(r) { return r.json(); }).catch(function() { return { runs: [] }; }),
      fetch('/admin/agent/runs/history', { credentials: 'same-origin' }).then(function(r) { return r.json(); }).catch(function() { return { runs: [] }; })
    ]).then(function(results) {
      var memory = results[0].runs || [];
      var history = results[1].runs || [];
      var seen = new Set();
      var all = [];
      memory.concat(history).forEach(function(r) {
        if (!seen.has(r.runId)) { seen.add(r.runId); all.push(r); }
      });
      all.sort(function(a, b) { return (b.createdAt || b.lastModified || 0) - (a.createdAt || a.lastModified || 0); });
      all = all.slice(0, 20);
      if (countEl) countEl.textContent = all.length ? '(' + all.length + ')' : '';
      listEl.querySelectorAll('.past-run-row').forEach(function(el) { el.remove(); });
      if (!all.length) {
        if (emptyEl) emptyEl.classList.remove('hidden');
        return;
      }
      if (emptyEl) emptyEl.classList.add('hidden');
      all.forEach(function(r) {
        var row = document.createElement('div');
        row.className = 'past-run-row flex items-center gap-3 px-4 py-2 hover:bg-slate-50 group';
        var ts = r.createdAt || r.lastModified || 0;
        var mission = (r.title || r.prompt || '').trim().slice(0, 90) || '(No mission)';
        var statusBadge = r.status ? '<span class="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 flex-shrink-0">' + escapeHtml(r.status) + '</span>' : '';
        row.innerHTML = '<span class="text-xs text-slate-400 flex-shrink-0 w-20">' + escapeHtml(relativeTime(ts)) + '</span>'
          + '<span class="text-sm text-slate-700 truncate flex-1">' + escapeHtml(mission) + '</span>'
          + statusBadge
          + '<button type="button" data-run-id="' + escapeHtml(r.runId) + '" class="load-run-btn text-xs font-medium text-emerald-600 hover:text-emerald-800 px-2 py-1 rounded hover:bg-emerald-50 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">Load</button>'
          + '<button type="button" data-run-id="' + escapeHtml(r.runId) + '" class="delete-run-btn text-xs font-medium text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" title="Delete run">✕</button>';
        listEl.appendChild(row);
      });
      listEl.querySelectorAll('.load-run-btn').forEach(function(btn) {
        btn.addEventListener('click', function() { loadPastRun(btn.getAttribute('data-run-id')); });
      });
      listEl.querySelectorAll('.delete-run-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var runId = btn.getAttribute('data-run-id');
          if (!confirm('Delete this run? This cannot be undone.')) return;
          fetch('/admin/agent/run/' + encodeURIComponent(runId), { method: 'DELETE', credentials: 'same-origin' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (!data.ok) { alert('Delete failed: ' + (data.error || 'unknown error')); return; }
              if (currentRunId === runId) {
                currentRunId = null;
                runArea.classList.add('hidden');
              }
              loadPastRunsList();
            })
            .catch(function() { alert('Delete request failed'); });
        });
      });
    });
  }

  function loadPastRun(runId) {
    fetch('/admin/agent/run/' + encodeURIComponent(runId), { credentials: 'same-origin' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.error) { alert('Could not load run: ' + data.error); return; }
        var promptEl = document.getElementById('prompt');
        if (promptEl && data.prompt) promptEl.value = data.prompt;
        var modelEl = document.getElementById('model');
        if (modelEl && data.model) {
          modelEl.value = data.model;
          if (modelEl.selectedIndex < 0 && modelEl.options.length) modelEl.value = modelEl.options[0].value;
        }
        currentRunId = runId;
        docsPopulated = true;
        runArea.classList.remove('hidden');
        var missionEl = document.getElementById('run-mission');
        if (missionEl) missionEl.textContent = data.prompt || '(No mission)';
        runStatus.textContent = data.status || 'loaded';
        runStage.textContent = '';
        var isActive = data.status && !['done', 'error', 'cancelled'].includes(data.status);
        stopBtn.disabled = !isActive;
        stopBtn.textContent = 'Stop run';
        startBtn.disabled = isActive;
        updatePipeline(data.status || 'done', { flightPlan: data.flightPlan, stepResults: data.stepResults });
        updateResumeButton(data.status);
        populateDocsPanel(data);
        if (data.edits && data.edits.length) showFileBrowser(data.edits);
        else filesArea.classList.add('hidden');
        if (data.prUrl || data.error) {
          showResult(data.prUrl, data.error);
        } else {
          resultArea.classList.add('hidden');
        }
        var stepArea = document.getElementById('step-results-area');
        var stepList = document.getElementById('step-results-list');
        if (data.stepResults && data.stepResults.length) {
          stepList.innerHTML = data.stepResults.map(function(sr) {
            var what = sr.step && sr.step.what ? sr.step.what : 'Step';
            var ok = sr.status === 'done';
            var reason = sr.reason ? ': ' + escapeHtml(sr.reason) : '';
            return '<li class="' + (ok ? 'text-emerald-600' : 'text-red-600') + '">' + escapeHtml(what) + ' — ' + sr.status + reason + '</li>';
          }).join('');
          stepArea.classList.remove('hidden');
        } else {
          stepArea.classList.add('hidden');
        }
        logContainer.textContent = '';
        if (data.logs && data.logs.length) {
          data.logs.forEach(function(entry) {
            logContainer.textContent += '[' + (entry.role || 'system') + '] ' + (entry.message || '').trim() + String.fromCharCode(10);
          });
          logContainer.scrollTop = logContainer.scrollHeight;
        }
        document.getElementById('agent-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
      })
      .catch(function() { alert('Failed to load run'); });
  }

  var pastRunsToggle = document.getElementById('past-runs-toggle');
  var pastRunsListEl = document.getElementById('past-runs-list');
  var pastRunsChevron = document.getElementById('past-runs-chevron');
  var pastRunsOpen = false;
  if (pastRunsToggle) {
    pastRunsToggle.addEventListener('click', function() {
      pastRunsOpen = !pastRunsOpen;
      if (pastRunsOpen) {
        pastRunsListEl.classList.remove('hidden');
        if (pastRunsChevron) pastRunsChevron.textContent = '▴';
      } else {
        pastRunsListEl.classList.add('hidden');
        if (pastRunsChevron) pastRunsChevron.textContent = '▾';
      }
    });
  }

  loadPastRunsList();
  function languageFromPath(path) {
    var ext = (path || '').split('.').pop().toLowerCase();
    var map = { js: 'javascript', mjs: 'javascript', cjs: 'javascript', json: 'json', md: 'markdown', html: 'markup', htm: 'markup', css: 'css', scss: 'css', yml: 'yaml', yaml: 'yaml', ts: 'typescript', tsx: 'typescript', jsx: 'javascript', sh: 'bash', bash: 'bash' };
    return map[ext] || 'plaintext';
  }
  function renderCodeBlock(containerEl, content, path) {
    var lang = languageFromPath(path);
    var code = escapeHtml(content || '');
    containerEl.innerHTML = '<pre class="line-numbers" style="margin:0;padding:1rem;background:transparent"><code class="language-' + escapeHtml(lang) + '">' + code + '</code></pre>';
    if (window.Prism) {
      var codeEl = containerEl.querySelector('code');
      if (codeEl) window.Prism.highlightElement(codeEl);
    }
  }

  function showFileBrowser(edits) {
    if (!edits || !edits.length) return;
    filesArea.classList.remove('hidden');
    filesList.innerHTML = '';
    edits.forEach(function(e, i) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#';
      a.className = 'block px-3 py-1.5 hover:bg-slate-200 text-slate-700 truncate cursor-pointer';
      a.textContent = e.path;
      a.dataset.index = String(i);
      a.addEventListener('click', function(ev) {
        ev.preventDefault();
        showFileContent(edits, parseInt(a.dataset.index, 10));
        filesList.querySelectorAll('a').forEach(function(x) { x.classList.remove('bg-slate-200', 'font-medium'); });
        a.classList.add('bg-slate-200', 'font-medium');
      });
      li.appendChild(a);
      filesList.appendChild(li);
    });
    showFileContent(edits, 0);
    filesList.querySelectorAll('a')[0].classList.add('bg-slate-200', 'font-medium');
  }

  function showFileContent(edits, index) {
    var e = edits[index];
    if (!e) return;
    filesContentHeader.textContent = e.path;
    renderCodeBlock(filesContent, e.content, e.path);
  }

  function showResult(prUrl, err) {
    resultArea.classList.remove('hidden');
    var resultNote = document.getElementById('result-note');
    if (prUrl) {
      prLink.href = prUrl;
      prLink.textContent = 'Open PR';
      prLink.classList.remove('hidden');
      runStatus.textContent = 'Done — PR created';
      if (err) {
        errorMsg.classList.add('hidden');
        if (resultNote) {
          resultNote.textContent = 'Some steps failed. You can still review the PR.';
          resultNote.classList.remove('hidden');
        }
      } else {
        errorMsg.classList.add('hidden');
        if (resultNote) {
          resultNote.textContent = 'Run complete. Use the link above to review the PR.';
          resultNote.classList.remove('hidden');
        }
      }
      resultArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else if (err) {
      prLink.classList.add('hidden');
      errorMsg.textContent = err;
      errorMsg.classList.remove('hidden');
      if (resultNote) resultNote.classList.add('hidden');
    } else {
      if (resultNote) resultNote.classList.add('hidden');
    }
    if (currentRunId) {
      fetch('/admin/agent/run/' + encodeURIComponent(currentRunId), { credentials: 'same-origin' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.error) return;
          updatePipeline(data.status || 'done', { flightPlan: data.flightPlan, stepResults: data.stepResults });
          updateResumeButton(data.status);
          populateDocsPanel(data);
          if (data.edits && data.edits.length) showFileBrowser(data.edits);
          if (data.stepResults && data.stepResults.length) {
            var area = document.getElementById('step-results-area');
            var list = document.getElementById('step-results-list');
            list.innerHTML = data.stepResults.map(function(sr) {
              var what = sr.step && sr.step.what ? sr.step.what : 'Step';
              var status = sr.status === 'done' ? 'done' : 'failed';
              var reason = sr.reason ? ': ' + escapeHtml(sr.reason) : '';
              return '<li class="' + (status === 'done' ? 'text-emerald-600' : 'text-red-600') + '">' + escapeHtml(what) + ' — ' + status + reason + '</li>';
            }).join('');
            area.classList.remove('hidden');
          } else {
            document.getElementById('step-results-area').classList.add('hidden');
          }
        })
        .catch(function() {});
    }
  }

  var docsPopulated = false;
  function maybePopulateDocs() {
    if (docsPopulated || !currentRunId) return;
    docsPopulated = true;
    fetch('/admin/agent/run/' + encodeURIComponent(currentRunId), { credentials: 'same-origin' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.error && (data.prompt || (data.docs && Object.keys(data.docs).some(function(k) { return data.docs[k]; })))) populateDocsPanel(data);
      })
      .catch(function() {});
  }

  function closeStream() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  }

  function startRun() {
    var promptEl = document.getElementById('prompt');
    var maxPlanners = document.getElementById('maxPlanners').value || '2';
    var maxCoders = document.getElementById('maxCoders').value || '3';
    docsPopulated = false;
    startBtn.disabled = true;
    runArea.classList.remove('hidden');
    stopBtn.disabled = true;
    stopBtn.textContent = 'Stop run';
    if (resumeBtn) resumeBtn.classList.add('hidden');
    var runPlaceholder = document.getElementById('run-placeholder');
    if (runPlaceholder) runPlaceholder.classList.add('hidden');
    var missionEl = document.getElementById('run-mission');
    if (missionEl) missionEl.textContent = promptEl.value.trim() || '(No mission text)';
    logContainer.textContent = '';
    document.getElementById('step-results-area').classList.add('hidden');
    document.getElementById('step-results-list').innerHTML = '';
    resultArea.classList.add('hidden');
    filesArea.classList.add('hidden');
    prLink.classList.add('hidden');
    errorMsg.classList.add('hidden');
    document.getElementById('result-note').classList.add('hidden');
    var tokensBar = document.getElementById('run-tokens-bar');
    if (tokensBar) tokensBar.classList.add('hidden');
    runStatus.textContent = 'Starting…';
    runStage.textContent = '';
    updatePipeline('research');
    startTimer();

    var seedDocs = {};
    ['overview', 'requirements', 'architecture', 'decisions', 'notes'].forEach(function(section) {
      var el = document.getElementById('docs-' + section);
      if (el) seedDocs[section] = el.value || '';
    });
    var modelEl = document.getElementById('model');
    var model = (modelEl && modelEl.value) ? modelEl.value.trim() : '';
    fetch('/admin/agent/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        prompt: promptEl.value.trim(),
        model: model,
        maxParallelPlanners: parseInt(maxPlanners, 10) || 2,
        maxParallelCoders: parseInt(maxCoders, 10) || 3,
        seedDocs: seedDocs
      })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.runId) throw new Error(data.error || 'No runId');
      currentRunId = data.runId;
      runStatus.textContent = 'Running…';
      stopBtn.disabled = false;
      stopBtn.textContent = 'Stop run';
      closeStream();
      eventSource = new EventSource('/admin/agent/stream/' + encodeURIComponent(data.runId));
      function handleStreamError() {
        if (!currentRunId) { closeStream(); return; }
        closeStream();
        runStatus.textContent = 'Checking run status…';
        var pollCount = 0;
        var maxPolls = 5;
        var poll = function() {
          pollCount++;
          fetch('/admin/agent/run/' + encodeURIComponent(currentRunId), { credentials: 'same-origin' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (data.error) {
                runStatus.textContent = 'Stream closed';
                startBtn.disabled = false;
                stopBtn.disabled = true;
                stopTimer();
                resumeBtn && resumeBtn.classList.add('hidden');
                return;
              }
              if (data.status === 'done' || data.status === 'error' || data.status === 'cancelled') {
                runStatus.textContent = data.status === 'done' ? 'Done — PR created' : (data.status === 'cancelled' ? 'Cancelled' : 'Error');
                startBtn.disabled = false;
                stopBtn.disabled = true;
                stopTimer();
                resumeBtn && resumeBtn.classList.add('hidden');
                showResult(data.prUrl, data.status === 'cancelled' ? 'Run stopped by user.' : data.error);
                return;
              }
              // Run is still active — keep stop button enabled and try to reconnect
              stopBtn.disabled = false;
              if (pollCount < maxPolls) {
                setTimeout(poll, 2000);
              } else {
                runStatus.textContent = 'Reconnecting…';
                setTimeout(function() {
                  if (!currentRunId) return;
                  eventSource = new EventSource('/admin/agent/stream/' + encodeURIComponent(currentRunId));
                  eventSource.onmessage = onStreamMessage;
                  eventSource.onerror = function() { handleStreamError(); };
                }, 1500);
              }
            })
            .catch(function() {
              runStatus.textContent = 'Stream closed';
              startBtn.disabled = false;
              stopBtn.disabled = true;
            });
        };
        poll();
      }
      function onStreamMessage(ev) {
        try {
          var entry = JSON.parse(ev.data);
          if (entry.type === 'log') {
            var prefix = '[' + (entry.role || 'system') + '] ';
            var msg = (entry.message || '').trim();
            logContainer.textContent += prefix + msg + String.fromCharCode(10);
            logContainer.scrollTop = logContainer.scrollHeight;
            if (entry.stage) updatePipeline(entry.stage);
          } else if (entry.type === 'status') {
            runStage.textContent = entry.status || '';
            updatePipeline(entry.status || '');
            maybePopulateDocs();
            updateTokenDisplay(entry.inputTokens, entry.outputTokens);
          } else if (entry.type === 'docs') {
            updateDocsPanelOnly(entry.docs);
          } else if (entry.type === 'done') {
            runStatus.textContent = entry.cancelled ? 'Cancelled' : 'Done — PR created';
            runStage.textContent = '';
            closeStream();
            stopTimer();
            startBtn.disabled = false;
            stopBtn.disabled = true;
            resumeBtn && resumeBtn.classList.add('hidden');
            updateTokenDisplay(entry.inputTokens, entry.outputTokens);
            showResult(entry.prUrl, entry.error);
          } else if (entry.type === 'error') {
            runStatus.textContent = 'Error';
            closeStream();
            stopTimer();
            startBtn.disabled = false;
            stopBtn.disabled = true;
            resumeBtn && resumeBtn.classList.add('hidden');
            showResult(null, entry.message || 'Run failed');
          }
        } catch (_) {}
      }
      eventSource.onmessage = onStreamMessage;
      eventSource.onerror = function() { handleStreamError(); };
    })
    .catch(function(err) {
      runStatus.textContent = 'Error';
      startBtn.disabled = false;
      stopBtn.disabled = true;
      showResult(null, err.message || 'Failed to start run');
    });
  }

  form.addEventListener('submit', function(e) {
    e.preventDefault();
    startRun();
  });
  startBtn.addEventListener('click', function() {
    startRun();
  });

  stopBtn.addEventListener('click', function() {
    if (!currentRunId || stopBtn.disabled) return;
    stopBtn.disabled = true;
    stopBtn.textContent = 'Stopping…';
    fetch('/admin/agent/run/' + encodeURIComponent(currentRunId) + '/cancel', {
      method: 'POST',
      credentials: 'same-origin'
    }).catch(function() {});
  });

  if (docsSaveBtn) {
    docsSaveBtn.addEventListener('click', function() {
      ['overview', 'requirements', 'architecture', 'decisions', 'notes'].forEach(function(section) {
        var el = document.getElementById('docs-' + section);
        if (el && el.tagName === 'TEXTAREA') saveDocSection(section, el.value);
      });
    });
  }
  document.querySelectorAll('.docs-textarea').forEach(function(ta) {
    ta.addEventListener('blur', function() {
      var section = ta.getAttribute('data-section');
      if (section) saveDocSection(section, ta.value);
    });
  });

  if (resumeBtn) {
    resumeBtn.addEventListener('click', function() {
      if (!currentRunId || resumeBtn.disabled) return;
      resumeBtn.disabled = true;
      resumeBtn.classList.add('hidden');
      runStatus.textContent = 'Resuming…';
      stopBtn.disabled = false;
      stopBtn.textContent = 'Stop run';
      closeStream();
      startTimer();
      fetch('/admin/agent/run/' + encodeURIComponent(currentRunId) + '/resume', { method: 'POST', credentials: 'same-origin' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (!data.ok) {
            runStatus.textContent = 'Error';
            if (resumeBtn) { resumeBtn.classList.remove('hidden'); resumeBtn.disabled = false; }
            return;
          }
          eventSource = new EventSource('/admin/agent/stream/' + encodeURIComponent(currentRunId));
          eventSource.onmessage = onStreamMessage;
          eventSource.onerror = function() { handleStreamError(); };
          if (resumeBtn) resumeBtn.disabled = false;
        })
        .catch(function() {
          runStatus.textContent = 'Error';
          if (resumeBtn) { resumeBtn.classList.remove('hidden'); resumeBtn.disabled = false; }
        });
    });
  }
})();
    </script>
  `)}
  `;
    const prismHead = `
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/themes/prism-tomorrow.min.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/plugins/line-numbers/prism-line-numbers.min.css">
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/prism.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/plugins/line-numbers/prism-line-numbers.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-javascript.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-json.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-markdown.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-css.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-markup.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-yaml.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-bash.min.js"><\/script>
`;
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>${adminHead('Missions')}${prismHead}</head>
<body class="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">${content}</body>
</html>`);
});

// ----- GET /admin/agent/models – list Gemini models that support generateContent (official list via SDK) -----
const DEFAULT_MODEL_ID = 'gemini-3-flash-preview';
const MODELS_CACHE_MS = 10 * 60 * 1000; // 10 minutes
let modelsCache = null;
let modelsCacheTime = 0;

/** Assign sort order and short description for Missions dropdown. Lower sortTier = better for this project. */
function modelMeta(id, displayName) {
    const lower = (id || '').toLowerCase();
    const name = (displayName || id || '').toLowerCase();
    if (/image|imagen|generation.*image|image.*generation/.test(lower) || /image\s*gen|image\s*generation/i.test(name)) {
        return { sortTier: 4, hint: 'Image generation. Not used for Missions (text/code).' };
    }
    if (/computer.use|computeruse|nano\s*banana|veo|audio|tts|speech/.test(lower)) {
        return { sortTier: 4, hint: 'Specialized (computer use, audio, video). Not for Missions.' };
    }
    if (/lite|nano|8b|small/.test(lower) && !/flash-lite.*001/.test(lower)) {
        return { sortTier: 2, hint: 'Lightweight & fast. Good for simple Missions; may miss nuance on complex tasks.' };
    }
    if (/experimental|exp\b|preview/.test(lower) && !/2\.5.*preview/.test(lower)) {
        return { sortTier: 3, hint: 'Experimental/preview. Use for cutting-edge; behavior may change.' };
    }
    if (/3-flash|2\.0-flash\b|2\.5-flash\b|1\.5-flash\b/.test(lower) && !/lite|nano|8b|image/.test(lower)) {
        return { sortTier: 0, hint: 'Best for Missions: fast, strong at code and planning. Recommended.' };
    }
    if (/3-pro|2\.5-pro|2\.0-pro|1\.5-pro/.test(lower)) {
        return { sortTier: 0, hint: 'Best for hard Missions: best reasoning and multi-step code. Recommended.' };
    }
    return { sortTier: 1, hint: 'General text/code. Good for Missions.' };
}

router.get('/models', async (req, res) => {
    const now = Date.now();
    if (modelsCache && now - modelsCacheTime < MODELS_CACHE_MS) {
        return res.json(modelsCache);
    }
    try {
        const supported = await listModelsForMissions();
        if (supported.length === 0) {
            const fallback = [{ id: DEFAULT_MODEL_ID, displayName: DEFAULT_MODEL_ID, hint: 'Best for Missions: fast, strong at code and planning.' }];
            const payload = { models: fallback, default: DEFAULT_MODEL_ID, fromCache: false };
            return res.json(payload);
        }
        const enriched = supported.map((m) => {
            const { sortTier, hint } = modelMeta(m.id, m.displayName);
            return { ...m, sortTier, hint: hint || 'General text/code.' };
        });
        enriched.sort((a, b) => {
            if (a.sortTier !== b.sortTier) return a.sortTier - b.sortTier;
            return (a.id || '').localeCompare(b.id || '');
        });
        const defaultId = enriched.some((m) => m.id === DEFAULT_MODEL_ID) ? DEFAULT_MODEL_ID : enriched[0].id;
        modelsCache = { models: enriched, default: defaultId, fromCache: false };
        modelsCacheTime = now;
        res.json(modelsCache);
    } catch (_) {
        const fallback = [{ id: DEFAULT_MODEL_ID, displayName: DEFAULT_MODEL_ID, hint: 'Best for Missions: fast, strong at code and planning.' }];
        res.json({ models: fallback, default: DEFAULT_MODEL_ID, fromCache: false });
    }
});

// ----- GET /admin/agent/prompts – edit Researcher, Planner, Coder, Reviewer system prompts -----
const AGENT_PROMPT_LABELS = { researcher: 'Researcher', planner: 'Planner', coder: 'Coder', reviewer: 'Reviewer' };
router.get('/prompts', async (req, res) => {
    try {
        const ids = listAgentPromptIds();
        const prompts = await Promise.all(ids.map(async (id) => ({ id, body: await getAgentPrompt(id), label: AGENT_PROMPT_LABELS[id] || id })));
        const sections = prompts.map(({ id, body, label }) => `
    <section class="rounded-xl border border-slate-200 bg-white overflow-hidden mb-6">
      <div class="border-b border-slate-200 px-4 py-2.5 bg-slate-50 flex items-center justify-between">
        <span class="text-sm font-medium text-slate-700">${escapeHtml(label)}</span>
        <div class="flex items-center gap-2">
          <button type="button" class="agent-prompt-save rounded-lg bg-emerald-600 text-white text-sm font-medium py-1.5 px-3 hover:bg-emerald-700" data-id="${escapeHtml(id)}">Save</button>
          <button type="button" class="agent-prompt-reset rounded-lg border border-slate-300 text-slate-600 text-sm font-medium py-1.5 px-3 hover:bg-slate-50" data-id="${escapeHtml(id)}">Reset to default</button>
        </div>
      </div>
      <textarea class="agent-prompt-body w-full min-h-[200px] rounded-none border-0 px-4 py-3 font-mono text-sm text-slate-800 resize-y focus:ring-2 focus:ring-emerald-500 focus:ring-inset" data-id="${escapeHtml(id)}" spellcheck="false">${escapeHtml(body || '')}</textarea>
      <div class="agent-prompt-status border-t border-slate-100 px-4 py-1.5 text-xs text-slate-400 hidden" data-id="${escapeHtml(id)}"></div>
    </section>`).join('');
        const content = `
  ${adminNav('agent')}
  ${adminContainer(`
    ${breadcrumb([{ href: '/admin', label: 'Dashboard' }, { href: '/admin/agent', label: 'Missions' }, { label: 'Agent prompts' }])}
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-semibold text-slate-800">Agent prompts</h1>
      <a href="/admin/agent" class="text-sm font-medium text-slate-500 hover:text-slate-700">← Missions</a>
    </div>
    <p class="text-slate-600 mb-6">Edit the system prompts used by the Researcher, Planner, Coder, and Reviewer. Changes are saved to S3 and used on the next mission run.</p>
    ${sections}
    <script>
      document.querySelectorAll('.agent-prompt-save').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var id = btn.dataset.id;
          var textarea = document.querySelector('.agent-prompt-body[data-id="' + id + '"]');
          var status = document.querySelector('.agent-prompt-status[data-id="' + id + '"]');
          if (!textarea || !status) return;
          status.classList.remove('hidden');
          status.textContent = 'Saving…';
          status.className = 'agent-prompt-status border-t border-slate-100 px-4 py-1.5 text-xs text-slate-400';
          fetch('/admin/agent/prompts/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id, body: textarea.value }) })
            .then(function(r) { return r.json().then(function(data) { return { ok: r.ok, data: data }; }); })
            .then(function(o) {
              status.textContent = o.ok ? 'Saved.' : (o.data && o.data.error ? o.data.error : 'Save failed');
              if (!o.ok) status.classList.add('text-red-600');
            })
            .catch(function() { status.textContent = 'Save failed'; status.classList.add('text-red-600'); });
        });
      });
      document.querySelectorAll('.agent-prompt-reset').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var id = btn.dataset.id;
          var status = document.querySelector('.agent-prompt-status[data-id="' + id + '"]');
          if (!status) return;
          if (!confirm('Reset ' + id + ' to the built-in default? This will overwrite your saved version.')) return;
          status.classList.remove('hidden');
          status.textContent = 'Resetting…';
          status.className = 'agent-prompt-status border-t border-slate-100 px-4 py-1.5 text-xs text-slate-400';
          fetch('/admin/agent/prompts/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) })
            .then(function(r) { return r.json().then(function(data) { return { ok: r.ok, data: data }; }); })
            .then(function(o) {
              if (o.ok) { window.location.reload(); return; }
              status.textContent = o.data && o.data.error ? o.data.error : 'Reset failed';
              status.classList.add('text-red-600');
            })
            .catch(function() { status.textContent = 'Reset failed'; status.classList.add('text-red-600'); });
        });
      });
    <\/script>
  `)}
`;
        res.send(`<!DOCTYPE html>
<html lang="en">
<head>${adminHead('Agent prompts')}</head>
<body class="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">${content}</body>
</html>`);
    } catch (err) {
        console.error('Agent prompts page:', err);
        res.status(500).send('Error loading agent prompts.');
    }
});

router.post('/prompts/save', express.json(), async (req, res) => {
    const { id, body } = req.body || {};
    if (!id || !listAgentPromptIds().includes(id)) return res.status(400).json({ error: 'Invalid or missing id.' });
    if (typeof body !== 'string') return res.status(400).json({ error: 'Missing body.' });
    try {
        await saveAgentPrompt(id, body);
        res.json({ ok: true });
    } catch (err) {
        console.error('Agent prompt save:', err);
        res.status(500).json({ error: err.message || 'Save failed.' });
    }
});

router.post('/prompts/reset', express.json(), async (req, res) => {
    const { id } = req.body || {};
    if (!id || !listAgentPromptIds().includes(id)) return res.status(400).json({ error: 'Invalid or missing id.' });
    try {
        await resetAgentPromptToDefault(id);
        res.json({ ok: true });
    } catch (err) {
        console.error('Agent prompt reset:', err);
        res.status(500).json({ error: err.message || 'Reset failed.' });
    }
});

// ----- Repo browser API -----
router.get('/repo/branches', async (req, res) => {
    const result = await listBranches();
    if (!result.ok) return res.status(500).json({ ok: false, error: result.error });
    res.json({ ok: true, current: result.current, branches: result.branches, repoUnavailable: result.repoUnavailable });
});
router.get('/repo/tree', async (req, res) => {
    const branch = req.query.branch || 'main';
    const path = req.query.path || '';
    const result = await getTree(branch, path);
    if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, entries: result.entries });
});
router.get('/repo/file', async (req, res) => {
    const branch = req.query.branch || 'main';
    const path = req.query.path;
    if (!path) return res.status(400).json({ ok: false, error: 'path required' });
    const result = await getFileContent(branch, path);
    if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
    res.json({ ok: true, content: result.content });
});

// ----- GET /admin/agent/runs – list recent in-memory runs -----
router.get('/runs', (req, res) => {
    const limit = Math.min(50, parseInt(req.query.limit, 10) || 20);
    res.json({ runs: listRuns(limit) });
});

// ----- GET /admin/agent/runs/history – list runs persisted to S3 (survives server restart) -----
router.get('/runs/history', async (req, res) => {
    try {
        const keys = await listS3KeysWithPrefix('admin/agent-runs/', 50);
        const sorted = keys
            .sort((a, b) => new Date(b.LastModified || 0) - new Date(a.LastModified || 0))
            .slice(0, 20);
        const runs = await Promise.all(sorted.map(async (k) => {
            const runId = k.Key.replace('admin/agent-runs/', '').replace('.json', '');
            const fallbackTs = k.LastModified ? new Date(k.LastModified).getTime() : 0;
            const meta = await loadRunMetadataFromS3(runId);
            return {
                runId,
                title: meta?.title || '',
                prompt: meta?.prompt || '',
                status: meta?.status || '',
                createdAt: meta?.createdAt || fallbackTs,
                lastModified: fallbackTs,
            };
        }));
        res.json({ runs });
    } catch (_) {
        res.json({ runs: [] });
    }
});

// ----- DELETE /admin/agent/run/:runId – delete run from memory and S3 -----
router.delete('/run/:runId', async (req, res) => {
    const { runId } = req.params;
    const run = getRun(runId);
    if (run) {
        const active = !['done', 'error', 'cancelled'].includes(run.status);
        if (active) return res.status(400).json({ ok: false, error: 'Cannot delete an active run; stop it first.' });
    }
    deleteRun(runId);
    try {
        await deleteFromS3('admin/agent-runs/' + runId + '.json');
    } catch (_) {}
    res.json({ ok: true });
});

// ----- POST /admin/agent/run/:runId/cancel – request run to stop (no more token use after next check) -----
router.post('/run/:runId/cancel', (req, res) => {
    const runId = req.params.runId;
    const run = getRun(runId);
    if (!run) return res.status(404).json({ ok: false, error: 'Run not found' });
    const terminal = ['done', 'error', 'cancelled'].includes(run.status);
    if (terminal) return res.status(400).json({ ok: false, error: 'Run already finished' });
    setRunCancelled(runId);
    persistRunToS3(runId).catch(() => {});
    res.json({ ok: true });
});

// ----- GET /admin/agent/run/:runId – run summary; falls back to S3 if not in memory -----
router.get('/run/:runId', async (req, res) => {
    let run = getRun(req.params.runId);
    if (!run) {
        const snapshot = await loadRunFromS3(req.params.runId);
        if (!snapshot) return res.status(404).json({ error: 'Run not found' });
        hydrateRun(req.params.runId, snapshot);
        run = getRun(req.params.runId);
    }
    if (!run) return res.status(404).json({ error: 'Run not found' });
    const { runId, status, logs, flightPlan, steps, docs, stepResults, prUrl, error, createdAt, prompt, title, edits, model } = run;
    res.json({
        runId,
        status,
        logs,
        flightPlan,
        steps: steps || [],
        docs: docs || { ...DEFAULT_DOCS },
        stepResults: stepResults || [],
        prUrl,
        error,
        createdAt,
        prompt,
        title: title || '',
        edits: edits || [],
        model: model || '',
    });
});

const DOC_SECTIONS = ['overview', 'requirements', 'architecture', 'decisions', 'notes'];

// ----- PATCH /admin/agent/run/:runId/docs – update one doc section -----
router.patch('/run/:runId/docs', express.json(), (req, res) => {
    const runId = req.params.runId;
    const run = getRun(runId);
    if (!run) return res.status(404).json({ ok: false, error: 'Run not found' });
    const { section, content } = req.body || {};
    if (!section || typeof section !== 'string' || !DOC_SECTIONS.includes(section)) {
        return res.status(400).json({ ok: false, error: 'Invalid or missing section; use one of: ' + DOC_SECTIONS.join(', ') });
    }
    updateRun(runId, { docs: { [section]: content != null ? String(content) : '' } });
    persistRunToS3(runId).catch(() => {});
    res.json({ ok: true });
});

// ----- POST /admin/agent/run – start run (returns runId, runs orchestrator in background) -----
router.post('/run', express.json(), (req, res) => {
    const { prompt = '', model = '', maxParallelPlanners = 2, maxParallelCoders = 3, seedDocs } = req.body || {};
    const runId = createRun({ prompt, model });
    if (seedDocs && typeof seedDocs === 'object') {
        updateRun(runId, { docs: seedDocs });
    }
    res.json({ runId });

    setImmediate(() => {
        runPipeline(runId, { prompt, model, maxParallelPlanners, maxParallelCoders });
    });
});

// ----- POST /admin/agent/run/:runId/resume – resume a run (load from S3 if not in memory) -----
router.post('/run/:runId/resume', async (req, res) => {
    const runId = req.params.runId;
    let run = getRun(runId);
    if (!run) {
        const snapshot = await loadRunFromS3(runId);
        if (!snapshot) return res.status(404).json({ ok: false, error: 'Run not found' });
        hydrateRun(runId, snapshot);
        run = getRun(runId);
    }
    const terminal = ['done', 'error', 'cancelled'].includes(run.status);
    if (terminal) return res.status(400).json({ ok: false, error: 'Run already finished; cannot resume' });

    res.json({ ok: true });
    setImmediate(() => runPipeline(runId, { prompt: run.prompt, model: run.model, maxParallelPlanners: 2, maxParallelCoders: 3, resume: true }));
});

// ----- GET /admin/agent/stream/:runId – SSE -----
router.get('/stream/:runId', (req, res) => {
    const { runId } = req.params;
    const run = getRun(runId);
    if (!run) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-store');
        res.write('data: ' + JSON.stringify({ type: 'error', message: 'Run not found' }) + '\n\n');
        res.end();
        return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.flushHeaders?.();

    // Send all existing logs
    run.logs.forEach((entry) => {
        res.write('data: ' + JSON.stringify({ type: 'log', ...entry }) + '\n\n');
    });
    res.write('data: ' + JSON.stringify({ type: 'status', status: run.status, inputTokens: run.inputTokens || 0, outputTokens: run.outputTokens || 0 }) + '\n\n');

    if (run.status === 'done' || run.status === 'error' || run.status === 'cancelled') {
        res.write('data: ' + JSON.stringify({
            type: 'done',
            prUrl: run.prUrl,
            error: run.status === 'cancelled' ? 'Run stopped by user.' : run.error,
            cancelled: run.status === 'cancelled',
            inputTokens: run.inputTokens || 0,
            outputTokens: run.outputTokens || 0,
        }) + '\n\n');
        res.end();
        return;
    }

    const unsub = subscribe((id, entry) => {
        if (id !== runId) return;
        if (entry.type === 'docs') {
            res.write('data: ' + JSON.stringify({ type: 'docs', docs: entry.docs }) + '\n\n');
        } else {
            res.write('data: ' + JSON.stringify({ type: 'log', ...entry }) + '\n\n');
        }
        const r = getRun(runId);
        res.write('data: ' + JSON.stringify({ type: 'status', status: r?.status, inputTokens: r?.inputTokens || 0, outputTokens: r?.outputTokens || 0 }) + '\n\n');
    });

    const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
    }, SSE_HEARTBEAT_MS);

    const checkDone = setInterval(() => {
        const r = getRun(runId);
        if (r && (r.status === 'done' || r.status === 'error' || r.status === 'cancelled')) {
            clearInterval(checkDone);
            clearInterval(heartbeat);
            unsub();
            res.write('data: ' + JSON.stringify({
                type: 'done',
                prUrl: r.prUrl,
                error: r.status === 'cancelled' ? 'Run stopped by user.' : r.error,
                cancelled: r.status === 'cancelled',
                inputTokens: r.inputTokens || 0,
                outputTokens: r.outputTokens || 0,
            }) + '\n\n');
            res.end();
        }
    }, 500);

    req.on('close', () => {
        clearInterval(checkDone);
        clearInterval(heartbeat);
        unsub();
    });
});

export { router as agentRoutes };
