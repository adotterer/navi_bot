/**
 * Renders a Gemini-generated mu_notes summary (see DEFAULT_PROMPTS.mu_notes in promptLoader.js) as
 * safe HTML. The prompt's output surface is narrow and known: #/##/### headings, **bold**, "-# "
 * small-text sub-bullets, "- " bullets, and literal Discord custom-emoji shortcodes. A small
 * dedicated line-based transform (not a general markdown library) matches the codebase's existing
 * "no templating engine" convention and avoids sanitizing arbitrary markdown from user input —
 * the only input source is Gemini's own constrained output.
 */
import { escapeHtml } from '../admin/layout.js';
import { emojiCodeToUrl } from '../shared/emojiCodeToUrl.js';

function renderInline(text) {
    // Split on emoji shortcodes first (keeping them via the capture group) so each non-emoji
    // segment can be escaped safely without also mangling the shortcode delimiters themselves.
    const parts = String(text).split(/(<a?:[^:]+:\d+>)/g);
    let html = parts
        .map((part) => {
            if (/^<a?:[^:]+:\d+>$/.test(part)) {
                const url = emojiCodeToUrl(part);
                return url ? `<img src="${url}" alt="" class="inline-block w-5 h-5 align-text-bottom">` : escapeHtml(part);
            }
            return escapeHtml(part);
        })
        .join('');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // The prompt wraps hyperlinks in <> so Discord doesn't auto-embed them; that convention
    // doesn't apply on a webpage, so turn them into real links instead of showing literal brackets.
    // URLs with query strings (e.g. YouTube's ?v=...&t=28s) contain a & that escapeHtml already
    // turned into &amp; — allow that escaped form inside the match, not just bare non-& characters,
    // or the lazy quantifier stops short at the first & and leaves the brackets unconverted.
    html = html.replace(/&lt;(https?:\/\/(?:&amp;|[^\s&])+?)&gt;/g, '<a href="$1" class="underline" target="_blank" rel="noopener">$1</a>');
    return html;
}

export function renderGuideHtml(summary) {
    if (!summary) return '';
    const lines = summary.split('\n');
    const out = [];
    let inList = false;

    const closeList = () => {
        if (inList) {
            out.push('</ul>');
            inList = false;
        }
    };

    for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (!line.trim()) {
            closeList();
            continue;
        }

        const heading = line.match(/^(#{1,3})\s+(.*)$/);
        if (heading) {
            closeList();
            const level = heading[1].length + 2; // # -> h3, ## -> h4, ### -> h5 (keeps page's own h1/h2)
            out.push(`<h${level} class="mt-4 mb-2 font-semibold">${renderInline(heading[2])}</h${level}>`);
            continue;
        }

        const smallBullet = line.match(/^-#\s*-?\s*(.*)$/);
        if (smallBullet) {
            closeList();
            out.push(`<p class="text-sm text-slate-500 dark:text-slate-400 ml-4">${renderInline(smallBullet[1])}</p>`);
            continue;
        }

        const bullet = line.match(/^-\s+(.*)$/);
        if (bullet) {
            if (!inList) {
                out.push('<ul class="list-disc ml-6 space-y-1">');
                inList = true;
            }
            out.push(`<li>${renderInline(bullet[1])}</li>`);
            continue;
        }

        closeList();
        out.push(`<p>${renderInline(line)}</p>`);
    }
    closeList();
    return out.join('\n');
}
