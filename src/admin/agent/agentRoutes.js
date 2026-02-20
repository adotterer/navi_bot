/**
 * Agent PR routes: main page, start run, SSE stream.
 */
import express from 'express';
import { adminHead, adminNav, adminContainer, breadcrumb, escapeHtml } from '../layout.js';
import { createRun, getRun, updateRun, subscribe, listRuns, setRunCancelled } from './runStore.js';
import { runPipeline } from './orchestrator.js';
import { listBranches, getTree, getFileContent } from './repoBrowser.js';

const router = express.Router();
const SSE_HEARTBEAT_MS = 15000;

// ----- GET /admin/agent – main page -----
router.get('/', (req, res) => {
    const content = `
  ${adminNav('agent')}
  ${adminContainer(`
    ${breadcrumb([{ href: '/admin', label: 'Dashboard' }, { label: 'Agent PR' }])}
    <div class="flex items-center justify-between mb-8">
      <h1 class="text-2xl font-semibold text-slate-800">Agent PR</h1>
    </div>
    <p class="text-slate-600 mb-6">Describe a mission; the AI will create a flight plan, implementation steps, and open a PR for you to review.</p>
    <div class="agent-split flex gap-4 min-h-[420px] mb-8">
      <div class="agent-prompt-column flex flex-col min-w-0 flex-1 rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div class="border-b border-slate-200 px-4 py-2.5 bg-slate-50 text-sm font-medium text-slate-700">Mission prompt</div>
        <form id="agent-form" class="flex flex-col flex-1 min-h-0 p-4">
          <textarea id="prompt" name="prompt" rows="10" placeholder="e.g. Add a health check endpoint at GET /health that returns { status: 'ok' }"
            class="w-full flex-1 min-h-[200px] rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none font-mono text-sm resize-y"></textarea>
          <div class="flex flex-wrap gap-6 items-center mt-4 flex-shrink-0">
            <div>
              <label for="maxPlanners" class="block text-sm font-medium text-slate-700 mb-1">Max parallel planners</label>
              <input type="number" id="maxPlanners" name="maxPlanners" min="1" max="5" value="2"
                class="w-20 rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none" />
            </div>
            <div>
              <label for="maxCoders" class="block text-sm font-medium text-slate-700 mb-1">Max parallel coders</label>
              <input type="number" id="maxCoders" name="maxCoders" min="1" max="10" value="3"
                class="w-20 rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none" />
            </div>
            <div class="pt-6">
              <button type="button" id="start-btn" class="rounded-lg bg-emerald-600 text-white font-medium py-2.5 px-5 hover:bg-emerald-700 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 transition-colors">Start run</button>
            </div>
          </div>
        </form>
      </div>
      <div class="agent-progress-column flex flex-col min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 overflow-hidden min-h-[320px]">
        <div id="run-area" class="hidden flex flex-col flex-1 min-h-0 overflow-hidden">
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-0 overflow-auto p-4">
            <div class="space-y-4 min-w-0">
              <section class="rounded-lg border border-slate-200 bg-white overflow-hidden flex-shrink-0">
                <div class="border-b border-slate-200 px-4 py-2 bg-slate-50 text-sm font-medium text-slate-700">Mission</div>
                <div id="run-mission" class="p-4 text-sm text-slate-700 whitespace-pre-wrap break-words bg-white min-h-[4rem]"></div>
              </section>
              <section class="rounded-lg border border-slate-200 bg-white p-4 space-y-3 flex-shrink-0">
                <div class="flex items-center gap-3 flex-wrap">
                  <span id="run-status" class="text-sm font-medium text-slate-700">Running…</span>
                  <span id="run-stage" class="text-sm text-slate-500"></span>
                  <button type="button" id="stop-btn" class="hidden rounded-lg bg-red-600 text-white font-medium py-1.5 px-4 text-sm hover:bg-red-700 focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors">Stop run</button>
                </div>
                <div id="pipeline-area" class="rounded border border-slate-200 bg-slate-50 px-3 py-2">
                  <div class="flex flex-wrap items-center gap-3 text-sm">
                    <span id="phase-researcher" class="phase px-2 py-1 rounded border border-slate-200 text-slate-500">Researcher</span>
                    <span class="text-slate-300">\u2192</span>
                    <span id="phase-planner" class="phase px-2 py-1 rounded border border-slate-200 text-slate-500">Planner</span>
                    <span class="text-slate-300">\u2192</span>
                    <span id="phase-coder" class="phase px-2 py-1 rounded border border-slate-200 text-slate-500">Coder</span>
                    <span class="text-slate-300">\u2192</span>
                    <span id="phase-pr" class="phase px-2 py-1 rounded border border-slate-200 text-slate-500">Create PR</span>
                  </div>
                </div>
                <div id="result-area" class="rounded-lg border border-slate-200 bg-emerald-50/50 p-4 hidden">
                  <a id="pr-link" href="#" target="_blank" rel="noopener" class="text-emerald-700 hover:text-emerald-800 font-medium underline">Open PR</a>
                  <p id="error-msg" class="text-red-600 text-sm mt-2 hidden"></p>
                  <p id="result-note" class="text-slate-500 text-xs mt-2 hidden"></p>
                </div>
              </section>
            </div>
            <div class="space-y-4 min-w-0 flex flex-col min-h-0">
              <section class="rounded-lg border border-slate-200 bg-white overflow-hidden flex flex-col flex-1 min-h-0">
                <div class="border-b border-slate-200 px-4 py-2 bg-slate-50 text-sm font-medium text-slate-700 flex-shrink-0">Audit log</div>
                <div id="log-container" class="bg-slate-900 text-slate-100 p-4 font-mono text-sm flex-1 min-h-0 overflow-y-auto whitespace-pre-wrap break-words rounded-b max-h-[280px]"></div>
              </section>
              <section id="step-results-area" class="rounded-lg border border-slate-200 bg-white overflow-hidden hidden flex-shrink-0">
                <div class="border-b border-slate-200 px-4 py-2 bg-slate-50 text-sm font-medium text-slate-700">Step results</div>
                <ul id="step-results-list" class="p-4 list-disc list-inside text-sm text-slate-600 space-y-1"></ul>
              </section>
            </div>
          </div>
          <div id="files-area" class="mt-4 hidden border border-slate-200 rounded-lg bg-white overflow-hidden flex-shrink-0">
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

  var filesArea = document.getElementById('files-area');
  var filesList = document.getElementById('files-list');
  var filesContentHeader = document.getElementById('files-content-header');
  var filesContent = document.getElementById('files-content');

  var repoBranch = document.getElementById('repo-branch');
  var repoTree = document.getElementById('repo-tree');
  var repoContentHeader = document.getElementById('repo-content-header');
  var repoContent = document.getElementById('repo-content');
  var repoExpanded = {};
  var repoTreeCache = {};

  function updatePipeline(status, runData) {
    runData = runData || {};
    var statusToPhase = { research: 'researcher', planning: 'planning', coding: 'coding', creating_pr: 'creating_pr', done: 'creating_pr', error: 'creating_pr', cancelled: 'creating_pr' };
    var current = statusToPhase[status] || status;
    var labels = {
      researcher: 'Researcher',
      planning: runData.flightPlan && runData.flightPlan.length ? 'Planner (' + runData.flightPlan.length + ' tasks)' : 'Planner',
      coding: runData.stepResults && runData.stepResults.length ? 'Coder (' + runData.stepResults.length + ' steps)' : 'Coder',
      creating_pr: 'Create PR'
    };
    var order = ['researcher', 'planning', 'coding', 'creating_pr'];
    order.forEach(function(phase, i) {
      var el = document.getElementById('phase-' + (phase === 'planning' ? 'planner' : phase === 'creating_pr' ? 'pr' : phase));
      if (!el) return;
      el.textContent = labels[phase] || el.textContent;
      el.className = 'phase px-2 py-1 rounded border text-sm ';
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
      if (err) {
        errorMsg.classList.add('hidden');
        if (resultNote) {
          resultNote.textContent = 'Some steps failed. You can still review the PR.';
          resultNote.classList.remove('hidden');
        }
      } else {
        errorMsg.classList.add('hidden');
        if (resultNote) resultNote.classList.add('hidden');
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
          updatePipeline(data.status || 'done', { flightPlan: data.flightPlan, stepResults: data.stepResults });
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
    startBtn.disabled = true;
    runArea.classList.remove('hidden');
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
    runStatus.textContent = 'Starting…';
    runStage.textContent = '';
    updatePipeline('research');

    fetch('/admin/agent/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        prompt: promptEl.value.trim(),
        maxParallelPlanners: parseInt(maxPlanners, 10) || 2,
        maxParallelCoders: parseInt(maxCoders, 10) || 3
      })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.runId) throw new Error(data.error || 'No runId');
      currentRunId = data.runId;
      runStatus.textContent = 'Running…';
      stopBtn.classList.remove('hidden');
      stopBtn.disabled = false;
      stopBtn.textContent = 'Stop run';
      closeStream();
      eventSource = new EventSource('/admin/agent/stream/' + encodeURIComponent(data.runId));
      eventSource.onmessage = function(ev) {
        try {
          var entry = JSON.parse(ev.data);
          if (entry.type === 'log') {
            var prefix = '[' + (entry.role || 'system') + '] ';
            var msg = (entry.message || '').replace(/\\n/g, '\\n');
            logContainer.textContent += prefix + msg + '\\n';
            logContainer.scrollTop = logContainer.scrollHeight;
          } else if (entry.type === 'status') {
            runStage.textContent = entry.status || '';
            updatePipeline(entry.status || '');
          } else if (entry.type === 'done') {
            runStatus.textContent = entry.cancelled ? 'Cancelled' : 'Done';
            runStage.textContent = '';
            closeStream();
            startBtn.disabled = false;
            stopBtn.classList.add('hidden');
            showResult(entry.prUrl, entry.error);
          } else if (entry.type === 'error') {
            runStatus.textContent = 'Error';
            closeStream();
            startBtn.disabled = false;
            stopBtn.classList.add('hidden');
            showResult(null, entry.message || 'Run failed');
          }
        } catch (_) {}
      };
      eventSource.onerror = function() {
        if (currentRunId) {
          runStatus.textContent = 'Stream closed (run may still be in progress)';
          startBtn.disabled = false;
          stopBtn.classList.add('hidden');
        }
        closeStream();
      };
    })
    .catch(function(err) {
      runStatus.textContent = 'Error';
      startBtn.disabled = false;
      stopBtn.classList.add('hidden');
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
<head>${adminHead('Agent PR')}${prismHead}</head>
<body class="min-h-screen bg-slate-50 text-slate-900">${content}</body>
</html>`);
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

// ----- GET /admin/agent/runs – list recent runs -----
router.get('/runs', (req, res) => {
    const limit = Math.min(50, parseInt(req.query.limit, 10) || 20);
    res.json({ runs: listRuns(limit) });
});

// ----- POST /admin/agent/run/:runId/cancel – request run to stop (no more token use after next check) -----
router.post('/run/:runId/cancel', (req, res) => {
    const run = getRun(req.params.runId);
    if (!run) return res.status(404).json({ ok: false, error: 'Run not found' });
    const terminal = ['done', 'error', 'cancelled'].includes(run.status);
    if (terminal) return res.status(400).json({ ok: false, error: 'Run already finished' });
    setRunCancelled(req.params.runId);
    res.json({ ok: true });
});

// ----- GET /admin/agent/run/:runId – run summary (for re-open / refresh, includes edits for file browser) -----
router.get('/run/:runId', (req, res) => {
    const run = getRun(req.params.runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    const { runId, status, logs, flightPlan, stepResults, prUrl, error, createdAt, prompt, edits } = run;
    res.json({ runId, status, logs, flightPlan, stepResults: stepResults || [], prUrl, error, createdAt, prompt, edits: edits || [] });
});

// ----- POST /admin/agent/run – start run (returns runId, runs orchestrator in background) -----
router.post('/run', express.json(), (req, res) => {
    const { prompt = '', maxParallelPlanners = 2, maxParallelCoders = 3 } = req.body || {};
    const runId = createRun({ prompt });
    res.json({ runId });

    setImmediate(() => {
        runPipeline(runId, { prompt, maxParallelPlanners, maxParallelCoders });
    });
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
    res.write('data: ' + JSON.stringify({ type: 'status', status: run.status }) + '\n\n');

    if (run.status === 'done' || run.status === 'error' || run.status === 'cancelled') {
        res.write('data: ' + JSON.stringify({
            type: 'done',
            prUrl: run.prUrl,
            error: run.status === 'cancelled' ? 'Run stopped by user.' : run.error,
            cancelled: run.status === 'cancelled',
        }) + '\n\n');
        res.end();
        return;
    }

    const unsub = subscribe((id, entry) => {
        if (id !== runId) return;
        res.write('data: ' + JSON.stringify({ type: 'log', ...entry }) + '\n\n');
        res.write('data: ' + JSON.stringify({ type: 'status', status: getRun(runId)?.status }) + '\n\n');
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
