/**
 * Heuristic truncation checks for Coder outputs.
 * We prefer permissive checks with warnings over hard parser failures.
 */

const TRUNCATION_MARKERS = [
    '... (truncated)',
    '... truncated',
    'rest of file',
    'rest unchanged',
    'file unchanged',
    'unchanged sections',
];

function hasSuspiciousMarker(text) {
    const lower = String(text || '').toLowerCase();
    if (!lower) return false;
    if (/\.\.\.\s*$/.test(lower.trim())) return true;
    return TRUNCATION_MARKERS.some((m) => lower.includes(m));
}

function isBalanced(text, openChar, closeChar) {
    let depth = 0;
    let inString = false;
    let quoteChar = '';
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (c === '\\') {
            escaped = true;
            continue;
        }
        if (inString) {
            if (c === quoteChar) {
                inString = false;
                quoteChar = '';
            }
            continue;
        }
        if (c === '"' || c === "'" || c === '`') {
            inString = true;
            quoteChar = c;
            continue;
        }
        if (c === openChar) depth++;
        if (c === closeChar) depth--;
        if (depth < 0) return false;
    }
    return depth === 0;
}

/**
 * @param {{ path?: string, content?: string, search?: string, replace?: string }} edit
 * @param {string} [sourceContent] current known file content before edit
 * @returns {{ truncated: boolean, reason?: string }}
 */
export function detectTruncation(edit, sourceContent = '') {
    if (!edit || typeof edit !== 'object') return { truncated: false };
    const isPatch = edit.search !== undefined || edit.replace !== undefined;
    const candidate = isPatch ? String(edit.replace ?? '') : String(edit.content ?? '');
    if (!candidate) return { truncated: false };

    if (hasSuspiciousMarker(candidate)) {
        return { truncated: true, reason: 'contains truncation marker or trailing ellipsis' };
    }

    if (!isBalanced(candidate, '{', '}') || !isBalanced(candidate, '[', ']')) {
        return { truncated: true, reason: 'unbalanced braces or brackets in output' };
    }

    const baselineLen = String(sourceContent || '').length;
    const isNewFile = isPatch && String(edit.search ?? '') === '';
    if (!isNewFile && baselineLen > 200 && candidate.length < Math.floor(baselineLen * 0.5)) {
        return { truncated: true, reason: 'output significantly shorter than source file' };
    }

    return { truncated: false };
}

