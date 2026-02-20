/**
 * Gemini agent roles: Researcher, Planner, Coder.
 * Each uses generateContentStream and optional onChunk for real-time logs.
 */
import { GoogleGenAI } from '@google/genai';
import { getFileTree } from './codebaseTools.js';

const genAI = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    defaultModel: process.env.GEMINI_MODEL || process.env.AGENT_MODEL || 'gemini-2.0-flash-exp',
});

const MODEL = process.env.AGENT_MODEL || process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp';
const GEMINI_TIMEOUT_MS = Number(process.env.AGENT_GEMINI_TIMEOUT_MS) || 120000;

function withTimeout(promise, ms, message = 'Request timed out') {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
    ]);
}

/**
 * Run the Researcher agent: mission prompt -> flight plan (list of high-level tasks).
 * @param {string} missionPrompt - User's mission description.
 * @param {object} opts
 * @param {(chunk: string) => void} [opts.onChunk] - Called with each streamed text chunk.
 * @returns {Promise<{ ok: true, flightPlan: Array<{ id: string, title: string, description: string, hints?: string }> } | { ok: false, error: string }>}
 */
export async function runResearcher(missionPrompt, opts = {}) {
    const { onChunk } = opts;
    let treeInfo = '';
    try {
        const treeResult = await getFileTree('', 2);
        if (treeResult.ok && treeResult.tree) {
            treeInfo = '\n\nRelevant codebase structure (top 2 levels):\n```json\n' + JSON.stringify(treeResult.tree, null, 2) + '\n```';
        }
    } catch (_) {}

    const systemPrompt = `You are a Researcher for a codebase. Your job is to take a high-level mission and produce a "flight plan": a short list of concrete, ordered tasks that together achieve the mission.

The repo is a Node.js/Express app (Discord bot + admin panel). Use the codebase structure below to inform your task list. Output ONLY a valid JSON array of tasks, no other text. Each task must have: "id" (short slug), "title" (one line), "description" (one or two sentences), and "hints" (comma-separated exact file paths when possible, e.g. "src/export/exportHandler.js, src/matchups/matchupHandler.js"). For missions about Discord commands (!mu, !mq, !export) or embed/branding, always include the relevant handler paths in hints (e.g. src/export/exportHandler.js, src/matchups/matchupHandler.js, src/messages/questionHandler.js, src/shared/messageSplitter.js). Example:
[{"id":"add-route","title":"Add health route","description":"Add GET /health that returns { status: 'ok' }.","hints":"src/app.js"}]`;

    const userContent = `Mission:\n${missionPrompt}${treeInfo}\n\nProduce the flight plan as a single JSON array.`;

    try {
        const result = await withTimeout(
            (async () => {
                const response = await genAI.models.generateContentStream({
                    model: MODEL,
                    contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + userContent }] }],
                    config: { maxOutputTokens: 2048 },
                });
                let fullText = '';
                for await (const chunk of response) {
                    const text = chunk.text ?? '';
                    fullText += text;
                    if (onChunk && text) onChunk(text);
                }
                const flightPlan = parseFlightPlan(fullText);
                if (!flightPlan.length) {
                    throw new Error('Could not parse flight plan from response');
                }
                return { ok: true, flightPlan };
            })(),
            GEMINI_TIMEOUT_MS,
            'Researcher timed out'
        );
        return result;
    } catch (err) {
        return { ok: false, error: err.message || String(err) };
    }
}

/**
 * Extract JSON array candidates from text: ```json ... ```, then last [...], then first [...].
 * @param {string} text
 * @returns {string[]}
 */
function extractJsonArrayCandidates(text) {
    const trimmed = text.trim();
    const candidates = [];
    const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlock) candidates.push(codeBlock[1].trim());
    const lastClose = trimmed.lastIndexOf(']');
    const lastOpen = trimmed.lastIndexOf('[');
    if (lastOpen !== -1 && lastClose !== -1 && lastOpen < lastClose) {
        const lastArray = trimmed.slice(lastOpen, lastClose + 1);
        if (!candidates.includes(lastArray)) candidates.push(lastArray);
    }
    const firstMatch = trimmed.match(/\[[\s\S]*\]/);
    if (firstMatch && !candidates.includes(firstMatch[0])) candidates.push(firstMatch[0]);
    return candidates;
}

/**
 * Parse flight plan from model output (extract JSON array). Prefers ```json block, then last [...], then first [...].
 * @param {string} text
 * @returns {Array<{ id: string, title: string, description: string, hints?: string }>}
 */
function parseFlightPlan(text) {
    for (const raw of extractJsonArrayCandidates(text)) {
        try {
            const arr = JSON.parse(raw);
            if (!Array.isArray(arr)) continue;
            const mapped = arr.map((t) => ({
                id: String(t.id ?? t.title ?? '').slice(0, 64) || 'task-' + Math.random().toString(36).slice(2, 8),
                title: String(t.title ?? t.id ?? ''),
                description: String(t.description ?? ''),
                hints: t.hints != null ? String(t.hints) : undefined,
            }));
            if (mapped.length) return mapped;
        } catch (_) {
            /* try next candidate */
        }
    }
    return [];
}

/**
 * Run the Planner agent: one flight-plan task -> implementation steps.
 * @param {object} task - { id, title, description, hints? }
 * @param {object} opts
 * @param {(chunk: string) => void} [opts.onChunk]
 * @returns {Promise<{ ok: true, steps: Array<{ what: string, files: string[], changeDescription?: string }> } | { ok: false, error: string }>}
 */
export async function runPlanner(task, opts = {}) {
    const { onChunk, fileContext = '', grepContext = '' } = opts;
    const systemPrompt = `You are a Planner. Given a single task from a flight plan, output an implementation plan: an ordered list of steps. Each step should specify what to do, which file(s) to touch, and optionally a short change description. Each step should be an actionable implementation step (code or config change), not a pure analysis step. Prefer steps that produce file edits.

Prefer steps that EDIT existing files shown in "Relevant file contents" or "Files that match the mission" above; only add steps that create NEW files when the mission explicitly requires a new module. When the mission asks to match existing behavior (e.g. use the same embed style as !mu/!mq), the "files" array must include the existing handler file(s) to modify and you should reference the same imports and patterns (e.g. createSplitEmbeds, EmbedBuilder, SUMMARY_DISCLAIMER, color "#36AAD4") that already appear in the codebase.

Output ONLY a valid JSON array of steps. Each step: "what" (one line), "files" (array of file paths, e.g. ["src/app.js"]), "changeDescription" (optional). Example:
[{"what":"Add GET /health handler","files":["src/app.js"],"changeDescription":"Add app.get('/health', ...) returning { status: 'ok' }"}]`;

    let userContent = `Task: ${task.title}\n${task.description}${task.hints ? '\nHints: ' + task.hints : ''}`;
    if (grepContext) userContent += `\n\nFiles that match the mission (from codebase search):\n${grepContext}`;
    if (fileContext) userContent += `\n\nRelevant file contents (for context only):\n${fileContext}`;
    userContent += '\n\nProduce the implementation steps as a single JSON array.';

    try {
        const result = await withTimeout(
            (async () => {
                const response = await genAI.models.generateContentStream({
                    model: MODEL,
                    contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + userContent }] }],
                    config: { maxOutputTokens: 2048 },
                });
                let fullText = '';
                for await (const chunk of response) {
                    const text = chunk.text ?? '';
                    fullText += text;
                    if (onChunk && text) onChunk(text);
                }
                const steps = parsePlannerSteps(fullText);
                if (!steps.length) throw new Error('Could not parse implementation steps');
                return { ok: true, steps };
            })(),
            GEMINI_TIMEOUT_MS,
            'Planner timed out'
        );
        return result;
    } catch (err) {
        return { ok: false, error: err.message || String(err) };
    }
}

/** Try JSON.parse; if it fails, try again after removing trailing commas before ] or }. */
function tryParseJsonArray(str) {
    try {
        const arr = JSON.parse(str);
        return Array.isArray(arr) ? arr : null;
    } catch (_) {
        const fixed = str.replace(/,\s*]/g, ']').replace(/,\s*}/g, '}');
        try {
            const arr = JSON.parse(fixed);
            return Array.isArray(arr) ? arr : null;
        } catch (_) {
            return null;
        }
    }
}

/** Try to fix JSON with literal newlines inside "content" string values (common in Coder output). */
function tryParseJsonArrayWithNewlineFix(str) {
    let arr = tryParseJsonArray(str);
    if (arr) return arr;
    if (!str.includes('\n')) return null;
    const contentKey = '"content"';
    let fixed = str;
    let idx = 0;
    while ((idx = fixed.indexOf(contentKey, idx)) !== -1) {
        const valueStart = fixed.indexOf('"', idx + contentKey.length);
        if (valueStart === -1) break;
        let end = valueStart + 1;
        let found = false;
        while (end < fixed.length) {
            const next = fixed.indexOf('"', end);
            if (next === -1) { idx = fixed.length; break; }
            if (fixed[next - 1] !== '\\') {
                const segment = fixed.slice(valueStart + 1, next);
                if (segment.includes('\n')) {
                    const escaped = segment.replace(/\r\n/g, '\\n').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
                    fixed = fixed.slice(0, valueStart + 1) + escaped + fixed.slice(next);
                    idx = valueStart + 1 + escaped.length + 1;
                } else {
                    idx = next + 1;
                }
                found = true;
                break;
            }
            end = next + 1;
        }
        if (!found) break;
    }
    arr = tryParseJsonArray(fixed);
    return arr;
}

/**
 * Parse Planner steps from model output. Prefers ```json block, then last [...], then first [...].
 */
function parsePlannerSteps(text) {
    for (const raw of extractJsonArrayCandidates(text)) {
        const arr = tryParseJsonArray(raw);
        if (!arr || !arr.length) continue;
        const mapped = arr.map((s, i) => {
            const what = String(s.what ?? s.description ?? s.name ?? s.step ?? s.task ?? s.title ?? '').trim();
            const files = Array.isArray(s.files) ? s.files.map(String) : [];
            return {
                what: what || (files[0] ? `Edit ${files[0]}` : `Step ${i + 1}`),
                files,
                changeDescription: s.changeDescription != null ? String(s.changeDescription) : undefined,
            };
        });
        if (mapped.length) return mapped;
    }
    return [];
}

/**
 * Run the Coder agent: one implementation step -> structured file edit.
 * @param {object} step - { what, files, changeDescription? }
 * @param {object} fileContext - Map of path -> content for files the coder can use.
 * @param {object} opts
 * @param {(chunk: string) => void} [opts.onChunk]
 * @returns {Promise<{ ok: true, edits: Array<{ path: string, content: string }> } | { ok: false, error: string }>}
 */
export async function runCoder(step, fileContext, opts = {}) {
    const { onChunk } = opts;
    const fileSection = Object.entries(fileContext).length
        ? '\n\nCurrent file contents (use these to produce the full new content):\n' +
          Object.entries(fileContext)
              .map(([p, c]) => `--- ${p} ---\n${c}\n`)
              .join('')
        : '';

    const systemPrompt = `You are a Coder. Given one implementation step, output the exact file change(s). You must output ONLY a single JSON array of edits. Each edit: "path" (file path relative to repo root), "content" (the COMPLETE new file content for that file).

CRITICAL: In the JSON, use \\n for newlines inside "content" strings (no literal line breaks), or the response cannot be parsed. Example: "content": "line1\\nline2\\n".

When "Current file contents" are provided above, you MUST base your edit on that content: preserve unchanged parts and only modify what the step asks; do not replace entire files with unrelated code. Do not invent content that does not match this codebase (e.g. wrong project names, unrelated constants). For NEW files (no current contents), create minimal content that fulfills the step and matches the repo's style (imports, naming, structure).

Preserve existing code where no change is needed; only include files that change. Output nothing but the JSON array. Example:
[{"path":"src/app.js","content":"// full file content here\\n"}]`;

    const userContent = `Step: ${step.what}\n${step.changeDescription || ''}\nFiles to consider: ${(step.files || []).join(', ')}${fileSection}\n\nProduce the edits array (full file content for each changed file).`;

    try {
        const result = await withTimeout(
            (async () => {
                const response = await genAI.models.generateContentStream({
                    model: MODEL,
                    contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + userContent }] }],
                    config: { maxOutputTokens: 8192 },
                });
                let fullText = '';
                for await (const chunk of response) {
                    const text = chunk.text ?? '';
                    fullText += text;
                    if (onChunk && text) onChunk(text);
                }
                const edits = parseCoderEdits(fullText);
                if (!edits.length) throw new Error('Could not parse edits from response');
                return { ok: true, edits };
            })(),
            GEMINI_TIMEOUT_MS,
            'Coder timed out'
        );
        return result;
    } catch (err) {
        return { ok: false, error: err.message || String(err) };
    }
}

/**
 * Extract edits array from Coder output. Prefers ```json ... ``` block, then last [...], then first [...].
 * Uses relaxed parse (trailing commas + literal newlines in strings) so Coder output is more likely to parse.
 */
function parseCoderEdits(text) {
    for (const raw of extractJsonArrayCandidates(text)) {
        const arr = tryParseJsonArrayWithNewlineFix(raw);
        if (!arr || !Array.isArray(arr)) continue;
        const edits = arr
            .filter((e) => e && (e.path || e.file) && (e.content != null))
            .map((e) => ({ path: String(e.path || e.file), content: String(e.content) }));
        if (edits.length) return edits;
    }
    return [];
}

/**
 * Validate Coder output against the step and mission. Returns done or failed so only approved edits go to the PR.
 * @param {object} step - { what, files?, changeDescription? }
 * @param {string} missionSummary - Mission prompt or short flight plan summary
 * @param {Array<{ path: string, content: string }>} edits - Coder's proposed edits
 * @returns {Promise<{ ok: true, status: 'done'|'failed', reason?: string }>}
 */
export async function validateCoderStep(step, missionSummary, edits) {
    const editSummary = (edits || []).map((e) => e.path + (e.content ? ` (${e.content.length} chars)` : '')).join(', ') || 'none';
    const prompt = `Step: ${step.what}\n${step.changeDescription || ''}\nMission context: ${(missionSummary || '').slice(0, 500)}\n\nCoder produced edits for: ${editSummary}.\n\nDo these edits satisfy the step and mission? Reply with exactly one word: done or failed. Optionally add a short reason after a colon (e.g. "failed: edits change wrong file").`;
    try {
        const response = await genAI.models.generateContent({
            model: MODEL,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: { maxOutputTokens: 128 },
        });
        const raw = response && (typeof response.text === 'function' ? response.text() : response.text);
        const text = String(raw ?? '').trim().toLowerCase();
        const done = text.startsWith('done');
        const failed = text.startsWith('failed');
        const reason = (text.includes(':') ? text.split(':').slice(1).join(':').trim() : '') || undefined;
        return {
            ok: true,
            status: done ? 'done' : (failed ? 'failed' : 'done'),
            reason: failed ? reason : undefined,
        };
    } catch (_) {
        return { ok: true, status: 'done' };
    }
}
