/**
 * Shared layout fragments for admin UI (Tailwind).
 */

const STYLESHEET = '<link href="/admin.css" rel="stylesheet">';
const FONTS =
    '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">';

function adminHead(title) {
    return `<meta charset="utf-8"><title>${escapeHtml(title)} – Navi Admin</title>${FONTS}${STYLESHEET}<script>(function(){var t=localStorage.getItem('theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.classList.add('dark');})();</script>`;
}

function adminNav(active = 'dashboard') {
    const links = [
        { href: '/admin', label: 'Dashboard', key: 'dashboard' },
        { href: '/admin/prompts', label: 'Prompts', key: 'prompts' },
        { href: '/admin/data', label: 'Data', key: 'data' },
        { href: '/admin/aliases', label: 'Aliases', key: 'aliases' },
        { href: '/admin/emojis', label: 'Emojis', key: 'emojis' },
        { href: '/admin/agent', label: 'Missions', key: 'agent' },
        { href: '/admin/cost', label: 'Cost', key: 'cost' },
        { href: '/admin/commands', label: 'Commands', key: 'commands' },
    ];
    const items = links
        .map(
            (l) =>
                `<a href="${l.href}" class="px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    active === l.key
                        ? 'bg-slate-700 text-white dark:bg-slate-600'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                }">${escapeHtml(l.label)}</a>`
        )
        .join('');
    return `
  <header class="border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur">
    <div class="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
      <nav class="flex items-center gap-1">${items}</nav>
      <div class="flex items-center gap-4">
        <button id="theme-toggle" type="button" class="text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1.5 rounded-lg transition-colors border border-slate-200 dark:border-slate-700" title="Toggle theme">
          <svg id="theme-toggle-dark-icon" class="hidden w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"></path></svg>
          <svg id="theme-toggle-light-icon" class="hidden w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" fill-rule="evenodd" clip-rule="evenodd"></path></svg>
        </button>
        <a href="/admin" class="text-sm font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300">Navi Admin</a>
      </div>
    </div>
  </header>
  <script>
    (function() {
      var d = document.getElementById('theme-toggle-dark-icon');
      var l = document.getElementById('theme-toggle-light-icon');
      var b = document.getElementById('theme-toggle');
      if (!b || !d || !l) return;
      function up() {
        if (document.documentElement.classList.contains('dark')) { d.classList.add('hidden'); l.classList.remove('hidden'); }
        else { d.classList.remove('hidden'); l.classList.add('hidden'); }
      }
      up();
      b.addEventListener('click', function() {
        var is = document.documentElement.classList.toggle('dark');
        localStorage.setItem('theme', is ? 'dark' : 'light');
        up();
      });
    })();
  </script>`;
}

function adminContainer(innerHtml) {
    return `<main class="max-w-5xl mx-auto px-4 py-8 font-sans">${innerHtml}</main>`;
}

function breadcrumb(items) {
    const parts = items
        .map((item, i) => {
            if (i === items.length - 1) {
                return `<span class="text-slate-900 dark:text-slate-100 font-medium">${escapeHtml(item.label)}</span>`;
            }
            return `<a href="${item.href}" class="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300">${escapeHtml(item.label)}</a>`;
        })
        .join('<span class="text-slate-300 dark:text-slate-600 mx-2">/</span>');
    return `<nav class="text-sm mb-6 flex items-center" aria-label="Breadcrumb">${parts}</nav>`;
}

function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Green checkmark badge indicating this resource is in S3 (bot uses uploaded version, not default). */
function s3Badge() {
    return '<span class="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-400 text-xs font-medium px-2 py-0.5" title="In S3 – bot is using uploaded version">✓ S3</span>';
}

/** Chevron-down SVG (bar expanded: click to collapse). */
const saveBarIconDown = '<svg class="save-bar-icon-down" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';

/** Chevron-up SVG (bar minimized: click to expand). */
const saveBarIconUp = '<svg class="save-bar-icon-up" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>';

/** Toggle button for save bar minimize/expand. Place as sibling of save-bar-content (not inside it). */
function saveBarToggleButton() {
    return `<button type="button" class="save-bar-toggle" aria-label="Minimize save bar" title="Minimize save bar">${saveBarIconDown}${saveBarIconUp}</button>`;
}

/** Inline script to wire save bar minimize toggle and persist in localStorage. barId = element id, storageKey = short key (e.g. "aliases"). */
function saveBarMinimizeScript(barId, storageKey) {
    const key = 'navi-save-bar-' + storageKey + '-minimized';
    return `<script>
(function(){
  var bar = document.getElementById(${JSON.stringify(barId)});
  if (!bar) return;
  var toggle = bar.querySelector('.save-bar-toggle');
  var storageKey = ${JSON.stringify(key)};
  function setMinimized(minimized) {
    if (minimized) {
      bar.classList.add('save-bar-minimized');
      if (toggle) { toggle.setAttribute('aria-label', 'Expand save bar'); toggle.setAttribute('title', 'Expand save bar'); }
      try { localStorage.setItem(storageKey, '1'); } catch (_) {}
    } else {
      bar.classList.remove('save-bar-minimized');
      if (toggle) { toggle.setAttribute('aria-label', 'Minimize save bar'); toggle.setAttribute('title', 'Minimize save bar'); }
      try { localStorage.setItem(storageKey, '0'); } catch (_) {}
    }
  }
  try {
    if (localStorage.getItem(storageKey) === '1') setMinimized(true);
  } catch (_) {}
  if (toggle) toggle.addEventListener('click', function() { setMinimized(!bar.classList.contains('save-bar-minimized')); });
})();
</script>`;
}

export { adminHead, adminNav, adminContainer, breadcrumb, escapeHtml, s3Badge, saveBarToggleButton, saveBarMinimizeScript };
