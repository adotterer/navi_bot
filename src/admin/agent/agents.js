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

The repo is a Node.js/Express app (Discord bot + admin panel). Use the codebase structure below to inform your task list. Output ONLY a valid JSON array of tasks, no other text. Each task must have: "id" (short slug), "title" (one line), "description" (one or two sentences), and "hints" (comma-separated exact file paths when possible, e.g. "src/export/exportHandler.js, src/matchups/matchupHandler.js"). For missions about Discord commands (!mu, !mq, !export) or embed/branding, always include the relevant handler paths in hints (e.g. src/export/exportHandler.js, src/matchups/matchupHandler.js, src/messages/questionHandler.js, src/shared/messageSplitter.js). Never suggest generic filenames like index.js or main.js unless they actually exist in the repo structure. Example:
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
    // 1. Prefer ```json ... ``` or ``` ... ``` blocks (take last one as it's often the actual output after thought)
    const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/g;
    let match;
    const codeBlocks = [];
    while ((match = codeBlockRegex.exec(trimmed)) !== null) {
        const inner = match[1].trim();
        if (inner.length > 2) codeBlocks.push(inner);
    }
    if (codeBlocks.length) candidates.push(codeBlocks[codeBlocks.length - 1]);
    // 2. Last top-level array (from last '[' to last ']') — favors actual output after reasoning
    const lastClose = trimmed.lastIndexOf(']');
    const lastOpen = trimmed.lastIndexOf('[');
    if (lastOpen !== -1 && lastClose !== -1 && lastOpen < lastClose) {
        const lastArray = trimmed.slice(lastOpen, lastClose + 1);
        if (!candidates.includes(lastArray)) candidates.push(lastArray);
    }
    // 3. First top-level array as fallback
    const firstMatch = trimmed.match(/\[[\s\S]*\]/);
    if (firstMatch && firstMatch[0].length > 2 && !candidates.includes(firstMatch[0])) candidates.push(firstMatch[0]);
    return candidates;
}

/** Like extractJsonArrayCandidates but returns every code block (so Coder can try each). Order: last block, first block, rest, then last/first array. */
function extractAllJsonArrayCandidatesForEdits(text) {
    const trimmed = text.trim();
    const seen = new Set();
    const add = (s) => {
        const t = s.trim();
        if (t.length > 2 && !seen.has(t)) { seen.add(t); return t; }
        return null;
    };
    const candidates = [];
    const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/g;
    const codeBlocks = [];
    let m;
    while ((m = codeBlockRegex.exec(trimmed)) !== null) {
        const inner = m[1].trim();
        if (inner.length > 2) codeBlocks.push(inner);
    }
    if (codeBlocks.length) {
        candidates.push(codeBlocks[codeBlocks.length - 1]);
        if (codeBlocks.length > 1) candidates.push(codeBlocks[0]);
        for (let i = 1; i < codeBlocks.length - 1; i++) candidates.push(codeBlocks[i]);
    }
    const lastClose = trimmed.lastIndexOf(']');
    const lastOpen = trimmed.lastIndexOf('[');
    if (lastOpen !== -1 && lastClose !== -1 && lastOpen < lastClose) {
        const lastArray = trimmed.slice(lastOpen, lastClose + 1);
        const a = add(lastArray);
        if (a) candidates.push(a);
    }
    const firstMatch = trimmed.match(/\[[\s\S]*\]/);
    if (firstMatch && firstMatch[0].length > 2) {
        const a = add(firstMatch[0]);
        if (a) candidates.push(a);
    }
    return candidates;
}

/**
 * Parse flight plan from model output (extract JSON array). Prefers ```json block, then last [...], then first [...].
 * Uses relaxed parse (trailing commas, literal newlines in strings) like Coder/Planner.
 * @param {string} text
 * @returns {Array<{ id: string, title: string, description: string, hints?: string }>}
 */
function parseFlightPlan(text) {
    const tryCandidates = (raw) => {
        let arr = tryParseJsonArray(raw);
        if (!arr) arr = tryParseJsonArrayWithNewlineFix(raw);
        if (!arr || !Array.isArray(arr)) return [];
        return arr.map((t) => ({
            id: String(t.id ?? t.title ?? '').slice(0, 64) || 'task-' + Math.random().toString(36).slice(2, 8),
            title: String(t.title ?? t.id ?? ''),
            description: String(t.description ?? ''),
            hints: t.hints != null ? String(t.hints) : undefined,
        }));
    };
    for (const raw of extractJsonArrayCandidates(text)) {
        const mapped = tryCandidates(raw);
        if (mapped.length) return mapped;
    }
    const trimmed = text.trim();
    const firstBracket = trimmed.indexOf('[');
    const lastBracket = trimmed.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
        const mapped = tryCandidates(trimmed.slice(firstBracket, lastBracket + 1));
        if (mapped.length) return mapped;
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
    const systemPrompt = `You are a Planner. Technical project planner: read shared context findings, then decompose goals into a small number of substantial coding tasks. Prefer fewer larger tasks over many small ones — each Coder agent can handle significant multi-file changes. Define dependencies between tasks. Write descriptions specific enough that a coder can implement without guessing intent.

Given a single task from a flight plan, output an implementation plan: an ordered list of steps. Each step should specify what to do, which file(s) to touch, and optionally a short change description. Each step should be an actionable implementation step (code or config change), not a pure analysis step. Prefer steps that produce file edits.

Prefer steps that EDIT existing files shown in "Relevant file contents" or "Files that match the mission" above; only add steps that create NEW files when the mission explicitly requires a new module. When the mission asks to match existing behavior (e.g. use the same embed style as !mu/!mq), the "files" array must include the existing handler file(s) to modify and you should reference the same imports and patterns (e.g. createSplitEmbeds, EmbedBuilder, SUMMARY_DISCLAIMER, color "#36AAD4") that already appear in the codebase. The "files" array must only contain paths that appear in the "Relevant file contents" or "Files that match the mission" above. Do not use index.js, main.js, or paths not listed.

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

/** Replace literal newlines inside double-quoted string values so JSON can parse. */
function escapeNewlinesInJsonStrings(str) {
    let out = '';
    let i = 0;
    let inString = false;
    let escape = false;
    while (i < str.length) {
        const c = str[i];
        if (escape) {
            out += c;
            escape = false;
            i++;
            continue;
        }
        if (c === '\\') {
            out += c;
            escape = true;
            i++;
            continue;
        }
        if (c === '"' && !escape) {
            inString = !inString;
            out += c;
            i++;
            continue;
        }
        if (inString && (c === '\n' || c === '\r')) {
            out += c === '\r' && str[i + 1] === '\n' ? '\\n' : (c === '\r' ? '\\r' : '\\n');
            if (c === '\r' && str[i + 1] === '\n') i++;
            i++;
            continue;
        }
        out += c;
        i++;
    }
    return out;
}

/** Try to fix JSON with literal newlines inside string values (common in Coder output). */
function tryParseJsonArrayWithNewlineFix(str) {
    let arr = tryParseJsonArray(str);
    if (arr) return arr;
    const fixed = escapeNewlinesInJsonStrings(str);
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
            let what = String(s.what ?? s.description ?? s.name ?? s.step ?? s.task ?? s.title ?? '').trim();
            const files = Array.isArray(s.files) ? s.files.map(String) : [];
            const changeDesc = s.changeDescription != null ? String(s.changeDescription).trim() : '';
            if (!what || /^step\s*\d+$/i.test(what) || what.length < 4) {
                what = changeDesc ? changeDesc.slice(0, 80) + (changeDesc.length > 80 ? '…' : '') : (files[0] ? `Edit ${files[0]}` : `Step ${i + 1}`);
            }
            return {
                what,
                files,
                changeDescription: changeDesc || undefined,
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
    const { onChunk, reviewFeedback } = opts;
    const fileSection = Object.entries(fileContext).length
        ? '\n\nCurrent file contents (use these to produce the full new content):\n' +
          Object.entries(fileContext)
              .map(([p, c]) => `--- ${p} ---\n${c}\n`)
              .join('')
        : '';

    const systemPrompt = `You are a Coder. Senior software engineer: read existing code before changing it; match existing patterns, naming, and structure; write focused minimal diffs — only what the task requires; verify changes compile and work before committing.

Given one implementation step, output the exact file change(s). You MUST output a single JSON array of edits only. Each edit: "path" (file path relative to repo root), "content" (the COMPLETE new file content for that file).

CRITICAL parsing rules:
- Output ONLY the JSON array. Do not wrap it in a markdown code block (no \`\`\`json). Start your response with [ and end with ].
- Inside "content" strings use escaped newlines: \\n (not literal line breaks), or the response cannot be parsed.

When "Current file contents" are provided above, you MUST base your edit on that content: preserve unchanged parts and only modify what the step asks; do not replace entire files with unrelated code. Do not invent content that does not match this codebase. For NEW files (no current contents), create minimal content that fulfills the step and matches the repo's style. Only output edits for files that were listed in "Files to consider" or whose contents were provided in "Current file contents". Do not create or edit index.js or other files not in that list.

Preserve existing code where no change is needed; only include files that change. Example (output exactly this format, no other text):
[{"path":"src/app.js","content":"// full file content here\\n"}]`;

    let userContent = `Step: ${step.what}\n${step.changeDescription || ''}\nFiles to consider: ${(step.files || []).join(', ')}${fileSection}\n\nProduce the edits array (full file content for each changed file).`;
    if (reviewFeedback && reviewFeedback.trim()) {
        userContent += `\n\nReviewer feedback (you must address this): ${reviewFeedback.trim()}`;
    }

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
 * Extract edits array from Coder output. Tries object wrappers, every code block, last/first array, and single-edit object.
 * Uses relaxed parse (trailing commas + literal newlines in strings).
 */
function parseCoderEdits(text) {
    const normalizeEdits = (arr) => {
        if (!Array.isArray(arr)) return [];
        return arr
            .filter((e) => e && typeof e === 'object' && (e.path || e.file))
            .map((e) => ({ path: String(e.path || e.file), content: String(e.content ?? e.text ?? '') }));
    };

    const tryParseObject = (raw) => {
        try {
            return JSON.parse(escapeNewlinesInJsonStrings(raw).replace(/,\s*]/g, ']').replace(/,\s*}/g, '}'));
        } catch (_) { return null; }
    };

    const trimmedForObj = text.trim();
    const firstBrace = trimmedForObj.indexOf('{');
    const lastBrace = trimmedForObj.lastIndexOf('}');
    const objCandidates = [
        trimmedForObj,
        ...(firstBrace !== -1 && lastBrace > firstBrace ? [trimmedForObj.slice(firstBrace, lastBrace + 1)] : []),
    ];
    for (const raw of objCandidates) {
        if (!raw.startsWith('{')) continue;
        const parsed = tryParseObject(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
        const arr = parsed.edits ?? parsed.changes ?? parsed.files;
        if (Array.isArray(arr)) {
            const edits = normalizeEdits(arr);
            if (edits.length) return edits;
        }
        if ((parsed.path || parsed.file) && (parsed.content != null || parsed.text != null)) {
            const edits = normalizeEdits([parsed]);
            if (edits.length) return edits;
        }
    }

    const stripToJson = (s) => {
        const t = s.trim();
        const start = Math.min(t.indexOf('[') >= 0 ? t.indexOf('[') : 1e9, t.indexOf('{') >= 0 ? t.indexOf('{') : 1e9);
        if (start < 1e9) return t.slice(start).trim();
        return t;
    };

    for (const raw of extractAllJsonArrayCandidatesForEdits(text)) {
        const arr = tryParseJsonArrayWithNewlineFix(stripToJson(raw));
        if (!arr || !Array.isArray(arr)) continue;
        const edits = normalizeEdits(arr);
        if (edits.length) return edits;
    }

    const trimmed = text.trim();
    const firstBracket = trimmed.indexOf('[');
    const lastBracket = trimmed.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
        const arr = tryParseJsonArrayWithNewlineFix(trimmed.slice(firstBracket, lastBracket + 1));
        if (arr && Array.isArray(arr)) {
            const edits = normalizeEdits(arr);
            if (edits.length) return edits;
        }
    }

    const firstBrace2 = trimmed.indexOf('{');
    const lastBrace2 = trimmed.lastIndexOf('}');
    if (firstBrace2 !== -1 && lastBrace2 > firstBrace2) {
        const single = tryParseObject(trimmed.slice(firstBrace2, lastBrace2 + 1));
        if (single && (single.path || single.file) && (single.content != null || single.text != null)) {
            const edits = normalizeEdits([single]);
            if (edits.length) return edits;
        }
    }
    return [];
}

/**
 * Validate Coder output against the step and mission. Returns done or failed so only approved edits go to the PR.
 * @param {object} step - { what, files?, changeDescription? }
 * @param {string} missionSummary - Mission prompt or short flight plan summary
 * @param {Array<{ path: string, content: string }>} edits - Coder's proposed edits
 * @param {object} [opts] - Optional: { allowedPaths: Set<string> } to enforce path allowlist
 * @returns {Promise<{ ok: true, status: 'done'|'failed', reason?: string }>}
 */
export async function validateCoderStep(step, missionSummary, edits, opts = {}) {
    const { allowedPaths } = opts;
    if (allowedPaths && allowedPaths.size > 0) {
        for (const e of edits || []) {
            if (e.path && !allowedPaths.has(e.path)) {
                return {
                    ok: true,
                    status: 'failed',
                    reason: `edit targets path not in allowed list: ${e.path}`,
                };
            }
        }
    }
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

/**
 * Run the Reviewer agent: inspect aggregated edits and return OK or actionable feedback for the Coder.
 * @param {Array<{ path: string, content: string }>} aggregatedEdits - Proposed file edits
 * @param {string} prompt - Mission prompt
 * @param {object} opts
 * @param {(chunk: string) => void} [opts.onChunk]
 * @returns {Promise<{ ok: true, feedback: string|null } | { ok: false, error: string }>}
 */
export async function runReviewer(aggregatedEdits, prompt, opts = {}) {
    const editSummary = (aggregatedEdits || [])
        .map((e) => `--- ${e.path} ---\n${(e.content || '').slice(0, 8000)}${(e.content || '').length > 8000 ? '\n... (truncated)' : ''}`)
        .join('\n\n');
    const systemPrompt = `You are a Reviewer. You see the proposed code changes for a mission. Check for correctness and consistency (e.g. API usage, types, existing patterns). If everything looks good, reply with exactly: OK. If something must be fixed, reply with FIX: followed by one short, actionable sentence for the coder (e.g. "EmbedBuilder.setColor expects a string; use a quoted hex string."). Output nothing else.`;
    const userContent = `Mission: ${(prompt || '').slice(0, 1000)}\n\nProposed changes:\n${editSummary}`;
    try {
        const response = await withTimeout(
            (async () => {
                const res = await genAI.models.generateContent({
                    model: MODEL,
                    contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + userContent }] }],
                    config: { maxOutputTokens: 256 },
                });
                return res;
            })(),
            GEMINI_TIMEOUT_MS,
            'Reviewer timed out'
        );
        const raw = response && (typeof response.text === 'function' ? response.text() : response.text);
        const text = String(raw ?? '').trim();
        const fixPrefix = /^fix\s*:\s*/i;
        if (fixPrefix.test(text)) {
            const feedback = text.replace(fixPrefix, '').trim();
            return { ok: true, feedback: feedback || null };
        }
        return { ok: true, feedback: null };
    } catch (err) {
        return { ok: false, error: err.message || String(err) };
    }
}
