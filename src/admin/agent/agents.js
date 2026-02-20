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
        const treeResult = getFileTree('', 2);
        if (treeResult.ok && treeResult.tree) {
            treeInfo = '\n\nRelevant codebase structure (top 2 levels):\n```json\n' + JSON.stringify(treeResult.tree, null, 2) + '\n```';
        }
    } catch (_) {}

    const systemPrompt = `You are a Researcher for a codebase. Your job is to take a high-level mission and produce a "flight plan": a short list of concrete, ordered tasks that together achieve the mission.

The repo is a Node.js/Express app (Discord bot + admin panel). Use the codebase structure below only to inform your task list. Output ONLY a valid JSON array of tasks, no other text. Each task must have: "id" (short slug, e.g. "add-route"), "title" (one line), "description" (one or two sentences), and optionally "hints" (suggested files or areas, e.g. "src/admin/"). Example:
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
 * Parse flight plan from model output (extract JSON array).
 * @param {string} text
 * @returns {Array<{ id: string, title: string, description: string, hints?: string }>}
 */
function parseFlightPlan(text) {
    const trimmed = text.trim();
    const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    try {
        const arr = JSON.parse(jsonMatch[0]);
        if (!Array.isArray(arr)) return [];
        return arr.map((t) => ({
            id: String(t.id ?? t.title ?? '').slice(0, 64) || 'task-' + Math.random().toString(36).slice(2, 8),
            title: String(t.title ?? t.id ?? ''),
            description: String(t.description ?? ''),
            hints: t.hints != null ? String(t.hints) : undefined,
        }));
    } catch (_) {
        return [];
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
    const { onChunk } = opts;
    const systemPrompt = `You are a Planner. Given a single task from a flight plan, output an implementation plan: an ordered list of steps. Each step should specify what to do, which file(s) to touch, and optionally a short change description.

Output ONLY a valid JSON array of steps. Each step: "what" (one line), "files" (array of file paths, e.g. ["src/app.js"]), "changeDescription" (optional). Example:
[{"what":"Add GET /health handler","files":["src/app.js"],"changeDescription":"Add app.get('/health', ...) returning { status: 'ok' }"}]`;

    const userContent = `Task: ${task.title}\n${task.description}${task.hints ? '\nHints: ' + task.hints : ''}\n\nProduce the implementation steps as a single JSON array.`;

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

function parsePlannerSteps(text) {
    const trimmed = text.trim();
    const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    try {
        const arr = JSON.parse(jsonMatch[0]);
        if (!Array.isArray(arr)) return [];
        return arr.map((s) => ({
            what: String(s.what ?? s.description ?? ''),
            files: Array.isArray(s.files) ? s.files.map(String) : [],
            changeDescription: s.changeDescription != null ? String(s.changeDescription) : undefined,
        }));
    } catch (_) {
        return [];
    }
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

    const systemPrompt = `You are a Coder. Given one implementation step, output the exact file change(s). You must output ONLY a single JSON array of edits. Each edit: "path" (file path relative to repo root), "content" (the COMPLETE new file content for that file). Preserve existing code where no change is needed; only include files that change. Output nothing but the JSON array. Example:
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

function parseCoderEdits(text) {
    const trimmed = text.trim();
    const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    try {
        const arr = JSON.parse(jsonMatch[0]);
        if (!Array.isArray(arr)) return [];
        return arr
            .filter((e) => e && (e.path || e.file) && (e.content != null))
            .map((e) => ({ path: String(e.path || e.file), content: String(e.content) }));
    } catch (_) {
        return [];
    }
}
