/**
 * Missions main page HTML + inline script. Split out so agentRoutes.js stays short and Coder-friendly.
 * The inner template is in agentPageContentInner.html (form, run area, repo browser, script).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INNER_PATH = path.join(__dirname, 'agentPageContentInner.html');

/** Prism: line-numbers CSS + scripts. Use placeholder for closing tag so scripts actually run (no backslash in </script>). */
const S = '</script>';
const PRISM_TAIL = `
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/plugins/line-numbers/prism-line-numbers.min.css">
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/prism.min.js">` + S + `
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/plugins/line-numbers/prism-line-numbers.min.js">` + S + `
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-javascript.min.js">` + S + `
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-json.min.js">` + S + `
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-markdown.min.js">` + S + `
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-css.min.js">` + S + `
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-markup.min.js">` + S + `
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-yaml.min.js">` + S + `
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-bash.min.js">` + S + `
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-typescript.min.js">` + S + `
`;

/**
 * @param {{ adminNav: (s: string, isSuperAdmin?: boolean, nonce?: string) => string, adminContainer: (s: string) => string, breadcrumb: (arr: Array<{ href?: string, label: string }>) => string, nonce?: string }} helpers
 * @returns {{ content: string, prismTail: string }}
 */
export function getAgentPageContent(helpers) {
    const { adminNav, adminContainer, breadcrumb, nonce = '' } = helpers;
    let inner = fs.readFileSync(INNER_PATH, 'utf8');
    const breadcrumbHtml = breadcrumb([{ href: '/admin', label: 'Dashboard' }, { label: 'Missions' }]);
    inner = inner.replace('__BREADCRUMB__', breadcrumbHtml);
    inner = inner.replace(/__NONCE__/g, nonce);
    // Wrapper with explicit page background so main content area is dark in dark mode (main itself has no bg)
    const wrapped = `<div class="min-h-full bg-slate-50 dark:bg-slate-900 -mx-4 -my-8 px-4 py-8">${inner}</div>`;
    const content = `${adminNav('agent', false, nonce)}\n  ${adminContainer(wrapped)}`;
    return { content, prismTail: PRISM_TAIL };
}
