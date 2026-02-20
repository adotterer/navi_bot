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
    <form id="agent-form" class="space-y-6 mb-8">
      <div>
        <label for="prompt" class="block text-sm font-medium text-slate-700 mb-2">Mission prompt</label>
        <textarea id="prompt" name="prompt" rows="4" placeholder="e.g. Add a health check endpoint at GET /health that returns { status: 'ok' }"
          class="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none font-mono text-sm"></textarea>
      </div>
      <div class="flex flex-wrap gap-6 items-center">
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
        <div class="pt-6 flex items-center gap-3">
          <button type="submit" id="start-btn" class="rounded-lg bg-emerald-600 text-white font-medium py-2.5 px-5 hover:bg-emerald-700 focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 transition-colors">Start run</button>
          <button type="button" id="stop-btn" class="hidden rounded-lg bg-red-600 text-white font-medium py-2.5 px-5 hover:bg-red-700 focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors">Stop run</button>
        </div>
      </div>
    </form>
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
    <div id="run-area" class="hidden">
      <div class="flex items-center gap-2 mb-2">
        <span id="run-status" class="text-sm font-medium text-slate-700">Running…</span>
        <span id="run-stage" class="text-sm text-slate-500"></span>
      </div>
      <div id="log-container" class="rounded-lg border border-slate-200 bg-slate-900 text-slate-100 p-4 font-mono text-sm max-h-96 overflow-y-auto whitespace-pre-wrap break-words"></div>
      <div id="step-results-area" class="mt-4 hidden">
        <div class="text-sm font-medium text-slate-700 mb-2">Step results</div>
        <ul id="step-results-list" class="list-disc list-inside text-sm text-slate-600 space-y-1"></ul>
      </div>
      <div id="result-area" class="mt-4 hidden">
        <a id="pr-link" href="#" target="_blank" rel="noopener" class="text-emerald-600 hover:text-emerald-700 font-medium">Open PR</a>
        <p id="error-msg" class="text-red-600 text-sm mt-2 hidden"></p>
      </div>
      <div id="files-area" class="mt-6 hidden border border-slate-200 rounded-lg bg-white overflow-hidden">
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
    if (prUrl) {
      prLink.href = prUrl;
      prLink.textContent = 'Open PR';
      prLink.classList.remove('hidden');
      errorMsg.classList.add('hidden');
    } else if (err) {
      prLink.classList.add('hidden');
      errorMsg.textContent = err;
      errorMsg.classList.remove('hidden');
    }
    if (currentRunId) {
      fetch('/admin/agent/run/' + encodeURIComponent(currentRunId), { credentials: 'same-origin' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
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

  form.addEventListener('submit', function(e) {
    e.preventDefault();
    var promptEl = document.getElementById('prompt');
    var maxPlanners = document.getElementById('maxPlanners').value || '2';
    var maxCoders = document.getElementById('maxCoders').value || '3';
    startBtn.disabled = true;
    runArea.classList.remove('hidden');
    logContainer.textContent = '';
    document.getElementById('step-results-area').classList.add('hidden');
    document.getElementById('step-results-list').innerHTML = '';
    resultArea.classList.add('hidden');
    filesArea.classList.add('hidden');
    prLink.classList.add('hidden');
    errorMsg.classList.add('hidden');
    runStatus.textContent = 'Starting…';
    runStage.textContent = '';

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
            logContainer.textContent += prefix + (entry.message || '').replace(/\\n/g, '\\x0A');
            logContainer.scrollTop = logContainer.scrollHeight;
          } else if (entry.type === 'status') {
            runStage.textContent = entry.status || '';
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
