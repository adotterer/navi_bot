/**
 * Shared layout fragments for admin UI (Tailwind).
 */

const STYLESHEET = '<link href="/admin.css" rel="stylesheet">';
const FONTS =
    '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">';

function adminHead(title) {
    return `<meta charset="utf-8"><title>${escapeHtml(title)} – Navi Admin</title>${FONTS}${STYLESHEET}`;
}

function adminNav(active = 'dashboard') {
    const links = [
        { href: '/admin', label: 'Dashboard', key: 'dashboard' },
        { href: '/admin/prompts', label: 'Prompts', key: 'prompts' },
        { href: '/admin/data', label: 'Data', key: 'data' },
        { href: '/admin/aliases', label: 'Aliases', key: 'aliases' },
        { href: '/admin/emojis', label: 'Emojis', key: 'emojis' },
    ];
    const items = links
        .map(
            (l) =>
                `<a href="${l.href}" class="px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    active === l.key
                        ? 'bg-slate-700 text-white'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }">${escapeHtml(l.label)}</a>`
        )
        .join('');
    return `
  <header class="border-b border-slate-200 bg-white/80 backdrop-blur">
    <div class="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
      <nav class="flex items-center gap-1">${items}</nav>
      <a href="/admin" class="text-sm font-medium text-slate-500 hover:text-slate-700">Navi Admin</a>
    </div>
  </header>`;
}

function adminContainer(innerHtml) {
    return `<main class="max-w-5xl mx-auto px-4 py-8 font-sans">${innerHtml}</main>`;
}

function breadcrumb(items) {
    const parts = items
        .map((item, i) => {
            if (i === items.length - 1) {
                return `<span class="text-slate-900 font-medium">${escapeHtml(item.label)}</span>`;
            }
            return `<a href="${item.href}" class="text-slate-500 hover:text-slate-700">${escapeHtml(item.label)}</a>`;
        })
        .join('<span class="text-slate-300 mx-2">/</span>');
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
    return '<span class="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-medium px-2 py-0.5" title="In S3 – bot is using uploaded version">✓ S3</span>';
}

export { adminHead, adminNav, adminContainer, breadcrumb, escapeHtml, s3Badge };
