/**
 * Shared Prism CDN fragment for admin pages that need syntax highlighting.
 * Uses the S = '</script>' pattern (see docs/gotchas.md) so the script tags
 * are not interpreted as closing the surrounding template literal.
 * Import PRISM_TAIL and inject before </body> in server-rendered HTML.
 */
const S = '</script>';
export const PRISM_TAIL = `
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
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-python.min.js">` + S + `
`;
