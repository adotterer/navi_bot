/**
 * Missions main page HTML + inline script. Split out so agentRoutes.js stays short and Coder-friendly.
 * The inner template is in agentPageContentInner.html (form, run area, repo browser, script).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INNER_PATH = path.join(__dirname, 'agentPageContentInner.html');

/** Prism CSS + scripts; load at end of body so <head> matches other admin pages and nav styles are unchanged. */
const PRISM_FOOTER = `
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/themes/prism-tomorrow.min.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/plugins/line-numbers/prism-line-numbers.min.css">
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/prism.min.js"><\\/script>
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/plugins/line-numbers/prism-line-numbers.min.js"><\\/script>
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-javascript.min.js"><\\/script>
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-json.min.js"><\\/script>
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-markdown.min.js"><\\/script>
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-css.min.js"><\\/script>
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-markup.min.js"><\\/script>
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-yaml.min.js"><\\/script>
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-bash.min.js"><\\/script>
`;

/**
 * @param {{ adminNav: (s: string) => string, adminContainer: (s: string) => string, breadcrumb: (arr: Array<{ href?: string, label: string }>) => string }} helpers
 * @returns {{ content: string, prismFooter: string }}
 */
export function getAgentPageContent(helpers) {
    const { adminNav, adminContainer, breadcrumb } = helpers;
    let inner = fs.readFileSync(INNER_PATH, 'utf8');
    const breadcrumbHtml = breadcrumb([{ href: '/admin', label: 'Dashboard' }, { label: 'Missions' }]);
    inner = inner.replace('__BREADCRUMB__', breadcrumbHtml);
    // Wrapper with explicit page background so main content area is dark in dark mode (main itself has no bg)
    const wrapped = `<div class="min-h-full bg-slate-50 dark:bg-slate-900 -mx-4 -my-8 px-4 py-8">${inner}</div>`;
    const content = `${adminNav('agent')}\n  ${adminContainer(wrapped)}`;
    return { content, prismFooter: PRISM_FOOTER };
}
