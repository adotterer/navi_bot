import { escapeHtml } from '../admin/layout.js';

const FONTS =
    '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">';
const STYLESHEET = '<link href="/admin.css" rel="stylesheet">';

// Add to Home Screen: manifest + platform icon/meta tags so the installed app gets a real icon
// and opens without browser chrome (display: standalone in manifest.json).
const A2HS_TAGS =
    '<link rel="manifest" href="/manifest.json">' +
    '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">' +
    '<link rel="icon" href="/icons/icon.png">' +
    '<meta name="theme-color" content="#4f46e5">' +
    '<meta name="apple-mobile-web-app-capable" content="yes">' +
    '<meta name="mobile-web-app-capable" content="yes">' +
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">' +
    '<meta name="apple-mobile-web-app-title" content="Navi">';

export function zeldaHead(title, nonce = '') {
    const n = nonce ? ` nonce="${escapeHtml(nonce)}"` : '';
    return `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${escapeHtml(title)} – Zelda MU Guides</title>${FONTS}${STYLESHEET}${A2HS_TAGS}<script${n}>(function(){var t=localStorage.getItem('theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.classList.add('dark');})();</script>`;
}

export function zeldaPage({ title, nonce, body }) {
    const n = nonce ? ` nonce="${escapeHtml(nonce)}"` : '';
    return `<!DOCTYPE html>
<html lang="en" class="antialiased">
<head>${zeldaHead(title, nonce)}</head>
<body class="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-50">
${body}
<script${n}>if ('serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js').catch(function(){}); }</script>
</body>
</html>`;
}

export function zeldaHeader(userLabel) {
    return `<header class="border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur">
    <div class="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
        <a href="/zelda" class="inline-flex items-center gap-2 text-xl font-semibold text-slate-900 dark:text-slate-100"><img src="/icons/icon.png" alt="" class="w-6 h-6">Zelda MU Guides</a>
        ${userLabel ? `<div class="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400"><span>${escapeHtml(userLabel)}</span><form method="POST" action="/zelda/logout"><button class="underline" type="submit">Log out</button></form></div>` : ''}
    </div>
</header>`;
}
