/**
 * Gemini agent roles: Researcher, Planner, Coder.
 * Each uses generateContentStream and optional onChunk for real-time logs.
 */
import { GoogleGenAI } from '@google/genai';
import { getFileTree } from './codebaseTools.js';

let _genAI = null;
function getGenAI() {
    if (!_genAI) {
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
        if (!apiKey) throw new Error('GEMINI_API_KEY must be set for Agent PR.');
        _genAI = new GoogleGenAI({
            apiKey,
            defaultModel: process.env.GEMINI_MODEL || process.env.AGENT_MODEL || 'gemini-2.0-flash-exp',
        });
    }
    return _genAI;
}

const MODEL = process.env.AGENT_MODEL || process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp';
const GEMINI_TIMEOUT_MS = Number(process.env.AGENT_GEMINI_TIMEOUT_MS) || 180000;

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
    const { onChunk, docs, signal } = opts;
    let treeInfo = '';
    try {
        const treeResult = await getFileTree('', 3);
        if (treeResult.ok && treeResult.tree) {
            treeInfo = '\n\nRelevant codebase structure (top 3 levels):\n```json\n' + JSON.stringify(treeResult.tree, null, 2) + '\n```';
        }
    } catch (_) {}

    const systemPrompt = `You are a Researcher for a codebase. Your job is to take a high-level mission and produce a "flight plan": a short list of concrete, ordered tasks that together achieve the mission.

The repo is a Node.js/Express app (Discord bot + admin panel). Use the codebase structure below to inform your task list. Output ONLY a valid JSON array of tasks, no other text. Each task must have: "id" (short slug), "title" (one line), "description" (one or two sentences), and "hints" (comma-separated exact file paths when possible, e.g. "src/export/exportHandler.js, src/matchups/matchupHandler.js").

FILE MAPPING RULES — use these to select the correct hint paths:
- Discord commands (!mu, !mq, !export, !fd, etc.): src/export/exportHandler.js, src/matchups/matchupHandler.js, src/messages/questionHandler.js, src/shared/messageSplitter.js
- Admin panel UI pages: each admin page is rendered server-side in its own routes file. The file that renders the page HTML AND its inline <script> JS is the SAME file. For the Agent PR page: src/admin/agent/agentRoutes.js. For aliases: src/admin/aliasRoutes.js. For prompts: src/admin/promptRoutes.js. For the main dashboard/nav: src/admin/routes.js and src/admin/layout.js.
- Agent pipeline logic: src/admin/agent/orchestrator.js, src/admin/agent/agents.js
- Agent run state: src/admin/agent/runStore.js
- Shared utilities: src/shared/messageSplitter.js, src/shared/s3Helper.js, src/shared/promptLoader.js
- If the mission involves changes to both a backend store AND a UI button/display, always include BOTH the store file AND the UI routes file in hints.
- If the mission introduces a new shared utility module, include it as a hint with a path under src/shared/.

Never suggest generic filenames like index.js or main.js unless they actually exist in the repo structure.
Example:
[{"id":"add-route","title":"Add health route","description":"Add GET /health that returns { status: 'ok' }.","hints":"src/app.js"}]`;

    let docsBlock = '';
    if (docs && typeof docs === 'object') {
        const parts = [];
        if (docs.overview) parts.push('Overview: ' + docs.overview);
        if (docs.requirements) parts.push('Requirements: ' + docs.requirements);
        if (docs.architecture) parts.push('Architecture: ' + docs.architecture);
        if (docs.decisions) parts.push('Decisions: ' + docs.decisions);
        if (docs.notes) parts.push('Notes: ' + docs.notes);
        if (parts.length) docsBlock = '\n\nExisting project docs (for context):\n' + parts.join('\n\n');
    }
    const userContent = `Mission:\n${missionPrompt}${treeInfo}${docsBlock}\n\nProduce the flight plan as a single JSON array.`;

    try {
        const result = await withTimeout(
            (async () => {
                const response = await getGenAI().models.generateContentStream({
                    model: MODEL,
                    contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + userContent }] }],
                    config: { maxOutputTokens: 4096, responseMimeType: 'application/json', abortSignal: signal },
                });
                let fullText = '';
                for await (const chunk of response) {
                    if (signal?.aborted) break;
                    const text = chunk.text ?? '';
                    fullText += text;
                    if (onChunk && text) onChunk(text);
                }
                const usage = response.usageMetadata;
                const flightPlan = parseFlightPlan(fullText);
                if (!flightPlan.length) {
                    const snippet = fullText.trim().slice(0, 400).replace(/\n/g, ' ');
                    throw new Error('Could not parse flight plan from response. Reply was not valid JSON array (or tasks/flightPlan wrapper). First 400 chars: ' + (snippet || '(empty)'));
                }
                return { ok: true, flightPlan, inputTokens: usage?.promptTokenCount, outputTokens: usage?.candidatesTokenCount };
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
 * Find the index of the matching closing ']' for the first '[' in str, respecting double-quoted strings.
 * Returns -1 if not found (e.g. truncated response).
 */
function findMatchingArrayClose(str) {
    const start = str.indexOf('[');
    if (start === -1) return -1;
    let depth = 1;
    let inString = false;
    let escape = false;
    let i = start + 1;
    while (i < str.length) {
        const c = str[i];
        if (escape) {
            escape = false;
            i++;
            continue;
        }
        if (c === '\\' && inString) {
            escape = true;
            i++;
            continue;
        }
        if (c === '"') {
            inString = !inString;
            i++;
            continue;
        }
        if (!inString) {
            if (c === '[') depth++;
            else if (c === ']') {
                depth--;
                if (depth === 0) return i;
            }
        }
        i++;
    }
    return -1;
}

/**
 * Extract JSON array candidates from text: ```json ... ```, bracket-matched [...], last [...], first [...], and truncated [...].
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
    // 2. Bracket-matched array from first '[' (handles ']' inside string values and truncated)
    const firstOpen = trimmed.indexOf('[');
    if (firstOpen !== -1) {
        const close = findMatchingArrayClose(trimmed);
        if (close !== -1) {
            const bracketMatched = trimmed.slice(firstOpen, close + 1);
            if (bracketMatched.length > 2 && !candidates.includes(bracketMatched)) candidates.push(bracketMatched);
        } else {
            const truncated = trimmed.slice(firstOpen);
            if (truncated.length > 2 && !candidates.includes(truncated)) candidates.push(truncated);
        }
    }
    // 3. Last top-level array (from last '[' to last ']') — favors actual output after reasoning
    const lastClose = trimmed.lastIndexOf(']');
    const lastOpen = trimmed.lastIndexOf('[');
    if (lastOpen !== -1 && lastClose !== -1 && lastOpen < lastClose) {
        const lastArray = trimmed.slice(lastOpen, lastClose + 1);
        if (!candidates.includes(lastArray)) candidates.push(lastArray);
    }
    // 4. First top-level array as fallback (greedy regex)
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
    } else {
        // Fallback: unclosed opening fence (response truncated before closing ```)
        const openFenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*)/);
        if (openFenceMatch) {
            const inner = openFenceMatch[1].trim();
            const a = add(inner);
            if (a) candidates.push(a);
        }
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
 * Also tries wrapper objects like { "tasks": [...] } or { "flightPlan": [...] }.
 * @param {string} text
 * @returns {Array<{ id: string, title: string, description: string, hints?: string }>}
 */
function parseFlightPlan(text) {
    const tryCandidates = (raw) => {
        let arr = tryParseJsonArray(raw);
        if (!arr) arr = tryParseJsonArrayWithNewlineFix(raw);
        if (arr && Array.isArray(arr)) {
            return arr.map((t) => ({
                id: String(t.id ?? t.title ?? '').slice(0, 64) || 'task-' + Math.random().toString(36).slice(2, 8),
                title: String(t.title ?? t.id ?? ''),
                description: String(t.description ?? ''),
                hints: t.hints != null ? String(t.hints) : undefined,
            }));
        }
        const obj = tryParseJsonObject(raw);
        if (obj && typeof obj === 'object') {
            const nested = obj.tasks ?? obj.flightPlan ?? obj.flight_plan ?? obj.items ?? obj.steps;
            if (Array.isArray(nested) && nested.length) {
                return nested.map((t) => ({
                    id: String(t.id ?? t.title ?? '').slice(0, 64) || 'task-' + Math.random().toString(36).slice(2, 8),
                    title: String(t.title ?? t.id ?? ''),
                    description: String(t.description ?? ''),
                    hints: t.hints != null ? String(t.hints) : undefined,
                }));
            }
        }
        return [];
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
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        const mapped = tryCandidates(trimmed.slice(firstBrace, lastBrace + 1));
        if (mapped.length) return mapped;
    }
    return [];
}

/** Try to parse a JSON object (for wrapper shapes like { "tasks": [...] }). */
function tryParseJsonObject(str) {
    try {
        const o = JSON.parse(str);
        return typeof o === 'object' && o !== null ? o : null;
    } catch (_) {
        const fixed = str.replace(/,\s*]/g, ']').replace(/,\s*}/g, '}');
        try {
            const o = JSON.parse(fixed);
            return typeof o === 'object' && o !== null ? o : null;
        } catch (_) {
            return null;
        }
    }
}

/**
 * Run the Planner agent: one flight-plan task -> implementation steps.
 * @param {object} task - { id, title, description, hints? }
 * @param {object} opts
 * @param {(chunk: string) => void} [opts.onChunk]
 * @returns {Promise<{ ok: true, steps: Array<{ what: string, files: string[], changeDescription?: string }> } | { ok: false, error: string }>}
 */
export async function runPlanner(task, opts = {}) {
    const { onChunk, fileContext = '', grepContext = '', docs, flightPlan, steps, signal } = opts;
    const systemPrompt = `You are a Planner. Technical project planner: read shared context findings, then decompose goals into a small number of substantial coding tasks. Prefer fewer larger tasks over many small ones — each Coder agent can handle significant multi-file changes. Define dependencies between tasks. Write descriptions specific enough that a coder can implement without guessing intent.

Given a single task from a flight plan, output an implementation plan: an ordered list of steps. Each step should specify what to do, which file(s) to touch, and optionally a short change description. Each step should be an actionable implementation step (code or config change), not a pure analysis step. Prefer steps that produce file edits.

Prefer steps that EDIT existing files shown in "Relevant file contents" or "Files that match the mission" above; only add steps that create NEW files when the mission explicitly requires a new module. When the mission asks to match existing behavior (e.g. use the same embed style as !mu/!mq), the "files" array must include the existing handler file(s) to modify and you should reference the same imports and patterns (e.g. createSplitEmbeds, EmbedBuilder, SUMMARY_DISCLAIMER, color "#36AAD4") that already appear in the codebase. The "files" array must only contain paths that appear in the "Relevant file contents" or "Files that match the mission" above. Do not use index.js, main.js, or paths not listed.

CRITICAL RULES — violating any of these causes broken code:
1. UI CHANGES: If the mission requires any visible UI change (adding a button, replacing a link, showing data, modifying click behavior), you MUST include the file that renders that HTML or contains its inline JavaScript in the "files" array. In this codebase, admin UI pages are rendered server-side in their route handler files (e.g. agentRoutes.js renders the Agent PR page including all its <script> JS). Never stop at a backend store or helper file if the UI itself must change.
2. NEW IMPORTS: If a step adds an import from a new utility file (e.g. "import { foo } from '../shared/myUtil.js'"), you MUST either (a) include a separate step that creates that file, or (b) only import from files shown in "Relevant file contents". Never instruct the Coder to import a module that does not exist and is not being created.
3. WIRING: If a step introduces a new flag or function (e.g. setAborted()), include a step that wires it into the running process that should check it (e.g. the orchestrator loop). A flag that is set but never read is dead code.
4. EXPORTS: If a step adds a new function that other files will call, include updating the export statement of that file in the same step's changeDescription.

Output ONLY a valid JSON array of steps. Each step: "what" (one line), "files" (array of file paths, e.g. ["src/app.js"]), "changeDescription" (optional, ONE sentence max — do not write multi-line prose). Example:
[{"what":"Add GET /health handler","files":["src/app.js"],"changeDescription":"Add app.get('/health', ...) returning { status: 'ok' }"}]`;

    let userContent = `Task: ${task.title}\n${task.description}${task.hints ? '\nHints: ' + task.hints : ''}`;
    if (docs && typeof docs === 'object') {
        const parts = [];
        if (docs.overview) parts.push('Overview: ' + docs.overview);
        if (docs.requirements) parts.push('Requirements: ' + docs.requirements);
        if (docs.architecture) parts.push('Architecture: ' + docs.architecture);
        if (docs.decisions) parts.push('Decisions: ' + docs.decisions);
        if (docs.notes) parts.push('Notes: ' + docs.notes);
        if (parts.length) userContent += '\n\nExisting project docs (read-only context):\n' + parts.join('\n\n');
    }
    if (flightPlan && flightPlan.length) userContent += '\n\nFlight plan (other tasks): ' + flightPlan.map((t) => t.title).join('; ');
    if (steps && steps.length) userContent += '\n\nExisting implementation steps (other steps): ' + steps.map((s) => (s.step && s.step.what) || s.what).join('; ');
    if (grepContext) userContent += `\n\nFiles that match the mission (from codebase search):\n${grepContext}`;
    if (fileContext) userContent += `\n\nRelevant file contents (for context only):\n${fileContext}`;
    userContent += '\n\nProduce the implementation steps as a single JSON array.';

    try {
        const result = await withTimeout(
            (async () => {
                const response = await getGenAI().models.generateContentStream({
                    model: MODEL,
                    contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + userContent }] }],
                    config: { maxOutputTokens: 8192, responseMimeType: 'application/json', abortSignal: signal },
                });
                let fullText = '';
                for await (const chunk of response) {
                    if (signal?.aborted) break;
                    const text = chunk.text ?? '';
                    fullText += text;
                    if (onChunk && text) onChunk(text);
                }
                const usage = response.usageMetadata;
                const steps = parsePlannerSteps(fullText);
                if (!steps.length) {
                    console.error('[Planner] Parse failed. Raw response (first 400):', fullText.slice(0, 400));
                    throw new Error('Could not parse implementation steps');
                }
                return { ok: true, steps, inputTokens: usage?.promptTokenCount, outputTokens: usage?.candidatesTokenCount };
            })(),
            GEMINI_TIMEOUT_MS,
            'Planner timed out'
        );
        return result;
    } catch (err) {
        return { ok: false, error: err.message || String(err) };
    }
}

/** Try JSON.parse; if it fails, try trailing-comma fix, truncation recovery, and last-complete-object recovery. */
function tryParseJsonArray(str) {
    const fixCommas = (s) => s.replace(/,\s*]/g, ']').replace(/,\s*}/g, '}');
    try {
        const arr = JSON.parse(str);
        return Array.isArray(arr) ? arr : null;
    } catch (_) {
        try {
            const arr = JSON.parse(fixCommas(str));
            return Array.isArray(arr) ? arr : null;
        } catch (_) {
            const trimmed = str.trimEnd();
            if (!trimmed.startsWith('[')) return null;

            // Case 1: array not closed — try appending ']'
            if (!trimmed.endsWith(']')) {
                for (const attempt of [trimmed.replace(/,\s*$/, '') + ']', trimmed + ']']) {
                    try {
                        const arr = JSON.parse(fixCommas(attempt));
                        if (Array.isArray(arr)) return arr;
                    } catch (_) {}
                }
            }

            // Case 2: truncated mid-string — find last complete object by scanning backwards for '}'
            let pos = trimmed.length;
            let tries = 0;
            while (tries < 8) {
                pos = trimmed.lastIndexOf('}', pos - 1);
                if (pos < 0) break;
                const slice = trimmed.slice(0, pos + 1).replace(/,\s*$/, '') + ']';
                try {
                    const arr = JSON.parse(fixCommas(slice));
                    if (Array.isArray(arr) && arr.length) return arr;
                } catch (_) {}
                tries++;
            }
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
 * Uses relaxed parse (trailing commas, literal newlines in strings) like flight plan / Coder.
 */
function parsePlannerSteps(text) {
    const tryCandidates = (raw) => {
        let arr = tryParseJsonArray(raw);
        if (!arr) arr = tryParseJsonArrayWithNewlineFix(raw);
        if (!arr || !arr.length) return [];
        return arr.map((s, i) => {
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
 * Run the Coder agent: one implementation step -> structured file edit.
 * @param {object} step - { what, files, changeDescription? }
 * @param {object} fileContext - Map of path -> content for files the coder can use.
 * @param {object} opts
 * @param {(chunk: string) => void} [opts.onChunk]
 * @returns {Promise<{ ok: true, edits: Array<{ path: string, content: string }> } | { ok: false, error: string }>}
 */
export async function runCoder(step, fileContext, opts = {}) {
    const { onChunk, reviewFeedback, signal } = opts;
    const fileSection = Object.entries(fileContext).length
        ? '\n\nCurrent file contents (copy "search" text EXACTLY from here):\n' +
          Object.entries(fileContext)
              .map(([p, c]) => `--- ${p} ---\n${c}\n`)
              .join('')
        : '';

    const systemPrompt = `You are a Coder. Senior software engineer: make focused, minimal changes — only what the step requires.

Given one implementation step, output a JSON array of patch edits. Each edit has:
- "path": file path relative to repo root
- "search": the EXACT existing lines to replace (copy verbatim from "Current file contents" — whitespace must match exactly)
- "replace": the new lines to substitute in place of "search"

RULES:
- Output ONLY the JSON array. Do not use markdown code fences. Start with [ and end with ].
- "search" must be unique within the file and copy the existing text character-for-character.
- "replace" may be empty string "" to delete lines.
- For a NEW file (not in "Current file contents"), use "search": "" and "replace": "<full new file content>".
- Only edit files listed in "Files to consider" or shown in "Current file contents". Do not touch index.js or unlisted files.
- Use escaped newlines (\\n) inside all string values — never literal line breaks.
- KEEP SEARCH STRINGS SHORT: "search" must be 2–6 lines maximum — just enough to uniquely identify the insertion/replacement point. Never copy large blocks of existing code into "search". Find the smallest unique anchor near your change.
- KEEP REPLACE STRINGS FOCUSED: only include lines that are changing plus minimal context. Do not re-emit large unchanged sections of the file.

IMPORT PATH RULES — incorrect imports will break the app:
- Import paths must be relative to the file you are editing. To compute the correct path: find the file being edited in "Current file contents", note its directory, then write the path relative to that directory. Example: editing "src/admin/routes.js" (directory: src/admin/) and importing from "src/admin/agent/runStore.js" → use "./agent/runStore.js". Editing "src/admin/agent/orchestrator.js" (directory: src/admin/agent/) and importing from "src/admin/agent/runStore.js" → use "./runStore.js".
- Before adding any import, verify the module being imported is either (a) shown in "Current file contents" at the path you are importing, or (b) a file you are creating in this same edit. Never import a module that does not exist.
- Only import named exports that are explicitly listed in the export statement of the source file shown in "Current file contents".
- When you add a new exported function to a file that uses a named export list (e.g. "export { foo, bar }"), you MUST also patch that export line to include the new function name.

Example (imports change + function change in one file, two separate patches):
[{"path":"src/app.js","search":"const old = require('old');","replace":"const newMod = require('new');"},{"path":"src/app.js","search":"function foo() { return 1; }","replace":"function foo() { return 2; }"}]`;

    let userContent = `Step: ${step.what}\n${step.changeDescription || ''}\nFiles to consider: ${(step.files || []).join(', ')}${fileSection}\n\nProduce the patch edits array.`;
    if (reviewFeedback && reviewFeedback.trim()) {
        userContent += `\n\nReviewer feedback (you must address this): ${reviewFeedback.trim()}`;
    }

    try {
        const result = await withTimeout(
            (async () => {
                const response = await getGenAI().models.generateContentStream({
                    model: MODEL,
                    contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + userContent }] }],
                    config: { maxOutputTokens: 16384, responseMimeType: 'application/json', abortSignal: signal },
                });
                let fullText = '';
                for await (const chunk of response) {
                    if (signal?.aborted) break;
                    const text = chunk.text ?? '';
                    fullText += text;
                    if (onChunk && text) onChunk(text);
                }
                const usage = response.usageMetadata;
                const edits = parseCoderEdits(fullText);
                if (!edits.length) {
                    console.error('[Coder] Parse failed. Raw response (first 400):', fullText.slice(0, 400));
                    console.error('[Coder] Raw response (last 200):', fullText.slice(-200));
                    throw new Error('Could not parse edits from response');
                }
                return { ok: true, edits, inputTokens: usage?.promptTokenCount, outputTokens: usage?.candidatesTokenCount };
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
 * Extract edits array from Coder output. Accepts both full-content format {path, content}
 * and patch format {path, search, replace}. Tries object wrappers, code blocks, last/first array.
 * Uses relaxed parse (trailing commas + literal newlines in strings).
 */
function parseCoderEdits(text) {
    const normalizeEdits = (arr) => {
        if (!Array.isArray(arr)) return [];
        return arr
            .filter((e) => e && typeof e === 'object' && (e.path || e.file))
            .map((e) => {
                const path = String(e.path || e.file);
                if (e.search !== undefined || e.replace !== undefined) {
                    // Patch format: {path, search, replace}
                    return { path, search: String(e.search ?? ''), replace: String(e.replace ?? '') };
                }
                // Full-content format: {path, content}
                return { path, content: String(e.content ?? e.text ?? '') };
            });
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
        if ((parsed.path || parsed.file) && (parsed.content != null || parsed.text != null || parsed.search !== undefined)) {
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
        if (single && (single.path || single.file) && (single.content != null || single.text != null || single.search !== undefined)) {
            const edits = normalizeEdits([single]);
            if (edits.length) return edits;
        }
    }

    // Truncation recovery: JSON array was cut off mid-stream. Extract every complete {...} object
    // and salvage the ones that look like valid patch edits.
    const recovered = [];
    const escapedForRecovery = escapeNewlinesInJsonStrings(trimmed);
    // Match balanced single-depth objects (handles nested quotes via escape-newline pass above)
    const objRe = /\{[^{}]*\}/g;
    let objMatch;
    while ((objMatch = objRe.exec(escapedForRecovery)) !== null) {
        try {
            const obj = JSON.parse(objMatch[0].replace(/,\s*}/g, '}'));
            if (obj && (obj.path || obj.file) && (obj.content != null || obj.text != null || obj.search !== undefined)) {
                recovered.push(obj);
            }
        } catch (_) { /* skip unparseable objects */ }
    }
    if (recovered.length) {
        const edits = normalizeEdits(recovered);
        if (edits.length) return edits;
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
    const { allowedPaths, signal } = opts;
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
        const response = await getGenAI().models.generateContent({
            model: MODEL,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: { maxOutputTokens: 128, abortSignal: signal },
        });
        const usage = response.usageMetadata;
        const raw = response && (typeof response.text === 'function' ? response.text() : response.text);
        const text = String(raw ?? '').trim().toLowerCase();
        const done = text.startsWith('done');
        const failed = text.startsWith('failed');
        const reason = (text.includes(':') ? text.split(':').slice(1).join(':').trim() : '') || undefined;
        return {
            ok: true,
            status: done ? 'done' : (failed ? 'failed' : 'done'),
            reason: failed ? reason : undefined,
            inputTokens: usage?.promptTokenCount,
            outputTokens: usage?.candidatesTokenCount,
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
    const { importWarnings = [], signal } = opts;
    const editSummary = (aggregatedEdits || [])
        .map((e) => `--- ${e.path} ---\n${(e.content || '').slice(0, 8000)}${(e.content || '').length > 8000 ? '\n... (truncated)' : ''}`)
        .join('\n\n');
    const systemPrompt = `You are a Reviewer. You see proposed code changes for a mission. Check each of the following in order and stop at the first problem:

1. IMPORT PATHS — For every new import added in these edits, verify the module path is correct relative to the file being edited. A file at "src/admin/routes.js" importing from "src/admin/agent/runStore.js" must use "./agent/runStore.js", NOT "../agent/runStore.js". If any import path is wrong, report FIX.
2. MISSING MODULES — For every new import added, verify the module either (a) already exists in the codebase at the stated path, or (b) is being created in these same edits. If an import references a file that is not shown in the proposed changes and likely does not exist (e.g. a utility file with a novel name), report FIX.
3. MISSING EXPORTS — If a function or value is imported by name (e.g. "import { abortRun } from ..."), verify that the source file in these edits actually exports it. If the function exists in the file but is not in the export statement, report FIX.
4. UI COMPLETENESS — If the mission requires a visible UI change (adding a button, replacing a link, showing new data), verify that the file containing the rendered HTML or inline JavaScript was actually modified in these edits. Backend-only changes are incomplete if the mission required a frontend change. Report FIX if the UI file is missing.
5. WIRING — If a new flag or function is introduced (e.g. "abortRun"), verify it is actually called somewhere in the pipeline (e.g. the orchestrator or equivalent loop checks it). A flag that is set but never read is a FIX.

If ALL checks pass, reply with exactly: OK
If any check fails, reply with FIX: followed by ONE short, actionable sentence describing the most critical issue (e.g. "Fix: import path in routes.js should be './agent/runStore.js' not '../agent/runStore.js'").
Output nothing else.`;
    const warningsSection = importWarnings.length > 0
        ? `\n\nSTATIC ANALYSIS WARNINGS (pre-detected issues you must address):\n${importWarnings.map((w) => '- ' + w).join('\n')}`
        : '';
    const userContent = `Mission: ${(prompt || '').slice(0, 1000)}${warningsSection}\n\nProposed changes:\n${editSummary}`;
    try {
        const response = await withTimeout(
            (async () => {
                const res = await getGenAI().models.generateContent({
                    model: MODEL,
                    contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + userContent }] }],
                    config: { maxOutputTokens: 256, abortSignal: signal },
                });
                return res;
            })(),
            GEMINI_TIMEOUT_MS,
            'Reviewer timed out'
        );
        const usage = response.usageMetadata;
        const raw = response && (typeof response.text === 'function' ? response.text() : response.text);
        const text = String(raw ?? '').trim();
        const fixPrefix = /^fix\s*:\s*/i;
        if (fixPrefix.test(text)) {
            const feedback = text.replace(fixPrefix, '').trim();
            return { ok: true, feedback: feedback || null, inputTokens: usage?.promptTokenCount, outputTokens: usage?.candidatesTokenCount };
        }
        return { ok: true, feedback: null, inputTokens: usage?.promptTokenCount, outputTokens: usage?.candidatesTokenCount };
    } catch (err) {
        return { ok: false, error: err.message || String(err) };
    }
}
