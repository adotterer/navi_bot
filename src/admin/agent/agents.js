/**
 * Gemini and Claude agent roles: Researcher, Planner, Coder, etc.
 * Each uses generateContentStream or generateContent with optional onChunk for real-time logs.
 * System prompts are loaded from agentPromptLoader (S3 or built-in defaults).
 * Model selection routes to Google GenAI or Anthropic (ANTHROPIC_SECRET) by model id.
 */
import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import { getFileTree } from './codebaseTools.js';
import { getAgentPrompt } from './agentPromptLoader.js';
import { putToS3 } from '../../shared/s3Helper.js';

let _genAI = null;
function getGenAI() {
    if (!_genAI) {
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
        if (!apiKey) throw new Error('GEMINI_API_KEY must be set for Agent PR.');
        _genAI = new GoogleGenAI({
            apiKey,
            defaultModel: process.env.GEMINI_MODEL || process.env.AGENT_MODEL || 'gemini-3-flash-preview',
        });
    }
    return _genAI;
}

let _anthropic = null;
function getAnthropic() {
    if (!_anthropic) {
        const apiKey = process.env.ANTHROPIC_SECRET;
        if (!apiKey) throw new Error('ANTHROPIC_SECRET must be set to use Claude models.');
        _anthropic = new Anthropic({ apiKey });
    }
    return _anthropic;
}

/** True if model id is a Claude model (e.g. claude-3-5-sonnet-...). */
function isClaudeModel(modelId) {
    return typeof modelId === 'string' && modelId.trim().toLowerCase().startsWith('claude-');
}


const MODEL = process.env.AGENT_MODEL || process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
const DIAGRAM_MODEL = process.env.AGENT_DIAGRAM_MODEL || 'gemini-2.5-flash-image';
const GEMINI_TIMEOUT_MS = Number(process.env.AGENT_GEMINI_TIMEOUT_MS) || 180000;

/** Regex for [DIAGRAM: description] placeholder in agent output (global). */
const DIAGRAM_PLACEHOLDER_RE = /\[DIAGRAM:\s*([^\]]+)\]/g;

/**
 * Generate a single explanatory diagram image via an image-capable Gemini model.
 * @param {string} description - What the diagram should depict (from the agent's placeholder).
 * @param {string} surroundingContext - Nearby text from the report to ground the diagram.
 * @param {string} runId - Run ID (for S3 key).
 * @param {string} type - Determines S3 key and serving route.
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ ok: true, key: string } | { ok: false, warning: string }>}
 */
async function generateDiagramImage(description, surroundingContext, runId, type, signal) {
    const contextBlock = surroundingContext
        ? `\n\nREFERENCE (use ONLY these real names and relationships — do NOT invent any names, routes, files, or endpoints that are not listed here):\n${surroundingContext}`
        : '';
    const prompt = `Generate a single clean, labeled diagram image showing: ${description}${contextBlock}\n\nRULES:\n- Use ONLY the names, files, routes, and relationships explicitly mentioned above.\n- Do NOT invent or hallucinate any file names, routes, endpoints, class names, or functions.\n- If something is not mentioned above, do not include it.\n- Use boxes and arrows in a flowchart or architecture style.\n- Keep it simple, readable, and well-labeled.\n- White or light background.\n- No text outside the diagram.`;
    try {
        const response = await getGenAI().models.generateContent({
            model: DIAGRAM_MODEL,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: { responseModalities: ['IMAGE', 'TEXT'], maxOutputTokens: 4096, abortSignal: signal },
        });
        const parts = response?.candidates?.[0]?.content?.parts;
        let imageBase64, imageMimeType;
        if (Array.isArray(parts)) {
            for (const part of parts) {
                if (part?.inlineData?.data) {
                    imageBase64 = part.inlineData.data;
                    imageMimeType = part.inlineData.mimeType || 'image/png';
                    break;
                }
            }
        }
        if (!imageBase64) {
            return { ok: false, warning: 'Diagram model returned no image for: ' + description };
        }
        const ext = imageMimeType === 'image/jpeg' || imageMimeType === 'image/jpg' ? 'jpg' : 'png';
        const key = `admin/agent-runs/${runId}/${type}-diagram-${Date.now()}.${ext}`;
        await putToS3(key, Buffer.from(imageBase64, 'base64'), imageMimeType);
        return { ok: true, key };
    } catch (e) {
        console.warn(`[generateDiagramImage] Failed for ${type}/${runId}:`, e.message || e);
        return { ok: false, warning: 'Diagram could not be generated: ' + (e.message || String(e)) };
    }
}

/**
 * Extract ~800 chars of report text surrounding a match position to give the image model grounding context.
 */
function extractSurroundingContext(report, matchIndex, matchLength) {
    const RADIUS = 600;
    const start = Math.max(0, matchIndex - RADIUS);
    const end = Math.min(report.length, matchIndex + matchLength + RADIUS);
    let snippet = report.slice(start, end);
    if (start > 0) snippet = '...' + snippet;
    if (end < report.length) snippet = snippet + '...';
    return snippet.replace(DIAGRAM_PLACEHOLDER_RE, '').trim();
}

/**
 * Scan report text for [DIAGRAM: description] placeholders, generate each diagram,
 * and replace with inline markdown images.
 * @param {string} report - Raw report text from the agent.
 * @param {string} runId
 * @param {'audit'|'ask'|'review'} type
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ processedReport: string, diagramKeys: string[], warnings: string[] }>}
 */
async function processDiagramPlaceholders(report, runId, type, signal) {
    const diagramKeys = [];
    const warnings = [];
    const matches = [...report.matchAll(DIAGRAM_PLACEHOLDER_RE)];
    if (matches.length === 0) return { processedReport: report, diagramKeys, warnings };

    let processedReport = report;
    for (let i = 0; i < matches.length; i++) {
        const m = matches[i];
        const description = m[1].trim();
        const surrounding = extractSurroundingContext(report, m.index, m[0].length);
        const result = await generateDiagramImage(description, surrounding, runId, `${type}-${i}`, signal);
        if (result.ok) {
            diagramKeys.push(result.key);
            const imgUrl = `/admin/agent/run/${encodeURIComponent(runId)}/diagram/${diagramKeys.length - 1}`;
            processedReport = processedReport.replace(m[0], `![${description}](${imgUrl})`);
        } else {
            warnings.push(result.warning);
            processedReport = processedReport.replace(m[0], `*(Diagram unavailable: ${result.warning})*`);
        }
    }
    return { processedReport, diagramKeys, warnings };
}

/** Anthropic rate limit: wait 65s then retry (per-minute limits). */
const ANTHROPIC_429_DELAY_MS = 65000;
const ANTHROPIC_429_MAX_RETRIES = 2;

function isRateLimitError(err) {
    if (!err) return false;
    if (typeof Anthropic?.RateLimitError !== 'undefined' && err instanceof Anthropic.RateLimitError) return true;
    if (err.status === 429) return true;
    const msg = err.message && String(err.message);
    if (msg && (msg.includes('rate_limit') || msg.includes('30,000 input tokens per minute'))) return true;
    if (err.error && (err.error.type === 'rate_limit_error' || err.error.type === 'rate_limit')) return true;
    return false;
}

async function withRetry429(fn) {
    let lastErr;
    for (let attempt = 0; attempt <= ANTHROPIC_429_MAX_RETRIES; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            if (isRateLimitError(err) && attempt < ANTHROPIC_429_MAX_RETRIES) {
                await new Promise((r) => setTimeout(r, ANTHROPIC_429_DELAY_MS));
                continue;
            }
            throw err;
        }
    }
    throw lastErr;
}

/**
 * Unified non-streaming generate. Returns Gemini-style { text, usageMetadata }.
 * Routes to Gemini or Claude based on model id.
 * Call sites use (response.text === 'function' ? response.text() : response.text); both must be supported.
 */
async function generateContent({ model, systemPrompt, userContent, maxOutputTokens, responseMimeType, signal }) {
    const m = (model || '').trim();
    if (isClaudeModel(m)) {
        const client = getAnthropic();
        const system = responseMimeType === 'application/json'
            ? (systemPrompt + '\n\nRespond with a single JSON array only, no markdown fences or extra text.')
            : systemPrompt;
        const message = await withRetry429(() =>
            client.messages.create(
                {
                    model: m,
                    max_tokens: maxOutputTokens || 4096,
                    system: system || undefined,
                    messages: [{ role: 'user', content: userContent || '' }],
                },
                signal ? { signal } : undefined
            )
        );
        const text = (message.content || [])
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join('');
        const usage = message.usage || {};
        return {
            text: () => text,
            usageMetadata: {
                promptTokenCount: usage.input_tokens ?? 0,
                candidatesTokenCount: usage.output_tokens ?? 0,
            },
        };
    }
    const response = await getGenAI().models.generateContent({
        model: m,
        contents: [{ role: 'user', parts: [{ text: (systemPrompt || '') + '\n\n' + (userContent || '') }] }],
        config: { maxOutputTokens: maxOutputTokens || 4096, responseMimeType, abortSignal: signal },
    });
    return response;
}

/**
 * Unified streaming generate. Returns async iterable and normalizes to Gemini-style response with .text and .usageMetadata.
 * Routes to Gemini or Claude based on model id. Calls onChunk with each text delta.
 */
async function generateContentStream({ model, systemPrompt, userContent, maxOutputTokens, responseMimeType, signal, onChunk }) {
    const m = (model || '').trim();
    if (isClaudeModel(m)) {
        const client = getAnthropic();
        const system = responseMimeType === 'application/json'
            ? (systemPrompt + '\n\nRespond with a single JSON array only, no markdown fences or extra text.')
            : systemPrompt;
        const stream = await withRetry429(() =>
            client.messages.create(
                {
                    model: m,
                    max_tokens: maxOutputTokens || 4096,
                    system: system || undefined,
                    messages: [{ role: 'user', content: userContent || '' }],
                    stream: true,
                },
                signal ? { signal } : undefined
            )
        );
        const result = { usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0 } };
        result[Symbol.asyncIterator] = async function* () {
            for await (const event of stream) {
                // usage comes from message_delta and may be absent until the end of the stream
                if (signal?.aborted) break;
                if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta?.text) {
                    if (onChunk) onChunk(event.delta.text);
                    yield { text: event.delta.text };
                }
                if (event.type === 'message_delta' && event.usage) {
                    result.usageMetadata = {
                        promptTokenCount: event.usage.input_tokens ?? 0,
                        candidatesTokenCount: event.usage.output_tokens ?? 0,
                    };
                }
            }
        };
        return result;
    }
    const response = await getGenAI().models.generateContentStream({
        model: m,
        contents: [{ role: 'user', parts: [{ text: (systemPrompt || '') + '\n\n' + (userContent || '') }] }],
        config: { maxOutputTokens: maxOutputTokens || 4096, responseMimeType, abortSignal: signal },
    });
    return response;
}

/**
 * List Gemini models that support generateContent (for Missions model dropdown).
 * Uses the same SDK/client as the rest of the app. Returns [] when API key is missing or request fails.
 * @returns {Promise<Array<{ id: string, displayName: string }>>}
 */
export async function listModelsForMissions() {
    try {
        const genAI = getGenAI();
        const pager = await genAI.models.list();
        const out = [];
        for await (const m of pager) {
            const name = (m.name || '').replace(/^models\//, '');
            if (!name.startsWith('gemini')) continue;
            const methods = m.supportedGenerationMethods || m.supportedActions || [];
            if (methods.length > 0 && !methods.includes('generateContent')) continue;
            out.push({ id: name, displayName: m.displayName || name });
        }
        out.sort((a, b) => a.id.localeCompare(b.id));
        return out;
    } catch (_) {
        return [];
    }
}

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
    const { onChunk, docs, signal, model: modelOverride } = opts;
    const model = modelOverride && modelOverride.trim() ? modelOverride.trim() : MODEL;
    let treeInfo = '';
    try {
        const treeResult = await getFileTree('', 3);
        if (treeResult.ok && treeResult.tree) {
            treeInfo = '\n\nRelevant codebase structure (top 3 levels):\n```json\n' + JSON.stringify(treeResult.tree, null, 2) + '\n```';
        }
    } catch (_) {}

    const systemPrompt = await getAgentPrompt('researcher');
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
                const response = await generateContentStream({
                    model,
                    systemPrompt,
                    userContent,
                    maxOutputTokens: 4096,
                    responseMimeType: 'application/json',
                    signal,
                    onChunk,
                });
                let fullText = '';
                let lastChunkUsage = null;
                for await (const chunk of response) {
                    if (signal?.aborted) break;
                    const text = chunk.text ?? '';
                    fullText += text;
                    if (onChunk && text) onChunk(text);
                    if (chunk.usageMetadata) lastChunkUsage = chunk.usageMetadata;
                }
                const flightPlan = parseFlightPlan(fullText);
                if (!flightPlan.length) {
                    const snippet = fullText.trim().slice(0, 400).replace(/\n/g, ' ');
                    throw new Error('Could not parse flight plan from response. Reply was not valid JSON array (or tasks/flightPlan wrapper). First 400 chars: ' + (snippet || '(empty)'));
                }
                const usage = lastChunkUsage ?? response.usageMetadata;
                return { ok: true, flightPlan, inputTokens: usage?.promptTokenCount ?? 0, outputTokens: usage?.candidatesTokenCount ?? 0 };
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
    const { onChunk, fileContext = '', grepContext = '', docs, flightPlan, steps, signal, model: modelOverride } = opts;
    const model = modelOverride && modelOverride.trim() ? modelOverride.trim() : MODEL;
    const systemPrompt = await getAgentPrompt('planner');
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
                const response = await generateContentStream({
                    model,
                    systemPrompt,
                    userContent,
                    maxOutputTokens: 8192,
                    responseMimeType: 'application/json',
                    signal,
                    onChunk,
                });
                let fullText = '';
                let lastChunkUsage = null;
                for await (const chunk of response) {
                    if (signal?.aborted) break;
                    const text = chunk.text ?? '';
                    fullText += text;
                    if (onChunk && text) onChunk(text);
                    if (chunk.usageMetadata) lastChunkUsage = chunk.usageMetadata;
                }
                const steps = parsePlannerSteps(fullText);
                if (!steps.length) {
                    console.error('[Planner] Parse failed. Raw response (first 400):', fullText.slice(0, 400));
                    throw new Error('Could not parse implementation steps');
                }
                const usage = lastChunkUsage ?? response.usageMetadata;
                return { ok: true, steps, inputTokens: usage?.promptTokenCount ?? 0, outputTokens: usage?.candidatesTokenCount ?? 0 };
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
    const { onChunk, reviewFeedback, signal, missionPrompt, model: modelOverride } = opts;
    const model = modelOverride && modelOverride.trim() ? modelOverride.trim() : MODEL;
    const fileSection = Object.entries(fileContext).length
        ? '\n\nCurrent file contents (copy "search" text EXACTLY from here):\n' +
          Object.entries(fileContext)
              .map(([p, c]) => `--- ${p} ---\n${c}\n`)
              .join('')
        : '';

    const systemPrompt = await getAgentPrompt('coder');
    const missionBlock = missionPrompt ? `\n\nMISSION PROMPT (authoritative source — copy any names, descriptions, or values verbatim from here):\n${missionPrompt}` : '';
    let userContent = `Step: ${step.what}\n${step.changeDescription || ''}\nFiles to consider: ${(step.files || []).join(', ')}${missionBlock}${fileSection}\n\nProduce the patch edits array.`;
    if (reviewFeedback && reviewFeedback.trim()) {
        userContent += `\n\nReviewer feedback (you must address this): ${reviewFeedback.trim()}`;
    }

    try {
        const result = await withTimeout(
            (async () => {
                const response = await generateContentStream({
                    model,
                    systemPrompt,
                    userContent,
                    maxOutputTokens: 16384,
                    responseMimeType: 'application/json',
                    signal,
                    onChunk,
                });
                let fullText = '';
                let lastChunkUsage = null;
                for await (const chunk of response) {
                    if (signal?.aborted) break;
                    const text = chunk.text ?? '';
                    fullText += text;
                    if (onChunk && text) onChunk(text);
                    if (chunk.usageMetadata) lastChunkUsage = chunk.usageMetadata;
                }
                const edits = parseCoderEdits(fullText);
                const usage = lastChunkUsage ?? response?.usageMetadata;
                if (edits.length) {
                    return { ok: true, edits, inputTokens: usage?.promptTokenCount ?? 0, outputTokens: usage?.candidatesTokenCount ?? 0 };
                }
                const trimmed = fullText.trim();
                const isEmptyArray = /^\s*\[\s*\]\s*$/.test(trimmed)
                    || (() => { try { const p = JSON.parse(trimmed); return Array.isArray(p); } catch (_) { return false; } })();
                if (isEmptyArray) {
                    return { ok: true, edits: [], inputTokens: usage?.promptTokenCount ?? 0, outputTokens: usage?.candidatesTokenCount ?? 0 };
                }
                console.error('[Coder] Parse failed. Raw response (first 400):', fullText.slice(0, 400));
                console.error('[Coder] Raw response (last 200):', fullText.slice(-200));
                throw new Error('Could not parse edits from response');
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
            })
            .filter((e) => {
                // Reject edits with no substantive content so we fail parse instead of validation "failed: no"
                if (e.search !== undefined) return true; // patch format: allow replace === '' (deletion)
                return (e.content && e.content.trim().length > 0);
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

    // Truncation recovery: JSON array was cut off mid-stream. Extract every complete top-level
    // {...} object using a string-aware depth tracker so that {} inside string values (e.g.
    // JS code in "replace") don't confuse the extractor.
    const recovered = [];
    const escapedForRecovery = escapeNewlinesInJsonStrings(trimmed);
    let ri = 0;
    while (ri < escapedForRecovery.length) {
        const start = escapedForRecovery.indexOf('{', ri);
        if (start < 0) break;
        let depth = 0, inStr = false, escape = false, pos = start;
        while (pos < escapedForRecovery.length) {
            const c = escapedForRecovery[pos];
            if (escape) { escape = false; pos++; continue; }
            if (c === '\\' && inStr) { escape = true; pos++; continue; }
            if (c === '"') { inStr = !inStr; pos++; continue; }
            if (!inStr) {
                if (c === '{') depth++;
                else if (c === '}') { depth--; if (depth === 0) { pos++; break; } }
            }
            pos++;
        }
        if (depth === 0) {
            const candidate = escapedForRecovery.slice(start, pos);
            try {
                const obj = JSON.parse(candidate.replace(/,\s*}/g, '}'));
                if (obj && (obj.path || obj.file) && (obj.content != null || obj.text != null || obj.search !== undefined)) {
                    recovered.push(obj);
                }
            } catch (_) { /* skip unparseable objects */ }
        }
        ri = pos;
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
    const { allowedPaths, signal, model: modelOverride } = opts;
    const model = modelOverride && modelOverride.trim() ? modelOverride.trim() : MODEL;
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
        const response = await generateContent({
            model,
            systemPrompt: '',
            userContent: prompt,
            maxOutputTokens: 128,
            signal,
        });
        const raw = response && (typeof response.text === 'function' ? response.text() : response.text);
        const text = String(raw ?? '').trim().toLowerCase();
        const done = text.startsWith('done');
        const failed = text.startsWith('failed');
        const reason = (text.includes(':') ? text.split(':').slice(1).join(':').trim() : '') || undefined;
        const usage = response.usageMetadata;
        return {
            ok: true,
            status: done ? 'done' : (failed ? 'failed' : 'done'),
            reason: failed ? reason : undefined,
            inputTokens: usage?.promptTokenCount ?? 0,
            outputTokens: usage?.candidatesTokenCount ?? 0,
        };
    } catch (err) {
        return {
            ok: true,
            status: 'failed',
            reason: err.message || String(err),
            inputTokens: 0,
            outputTokens: 0,
        };
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
    const { importWarnings = [], signal, model: modelOverride } = opts;
    const model = modelOverride && modelOverride.trim() ? modelOverride.trim() : MODEL;
    const editSummary = (aggregatedEdits || [])
        .map((e) => `--- ${e.path} ---\n${(e.content || '').slice(0, 8000)}${(e.content || '').length > 8000 ? '\n... (truncated)' : ''}`)
        .join('\n\n');
    const systemPrompt = await getAgentPrompt('reviewer');
    const warningsSection = importWarnings.length > 0
        ? `\n\nSTATIC ANALYSIS WARNINGS (pre-detected issues you must address):\n${importWarnings.map((w) => '- ' + w).join('\n')}`
        : '';
    const userContent = `Mission: ${(prompt || '').slice(0, 1000)}${warningsSection}\n\nProposed changes:\n${editSummary}`;
    try {
        const response = await withTimeout(
            (async () => {
                return await generateContent({
                    model,
                    systemPrompt,
                    userContent,
                    maxOutputTokens: 256,
                    signal,
                });
            })(),
            GEMINI_TIMEOUT_MS,
            'Reviewer timed out'
        );
        const raw = response && (typeof response.text === 'function' ? response.text() : response.text);
        const text = String(raw ?? '').trim();
        const fixPrefix = /^fix\s*:\s*/i;
        const usage = response?.usageMetadata;
        const tokenCounts = { inputTokens: usage?.promptTokenCount ?? 0, outputTokens: usage?.candidatesTokenCount ?? 0 };
        if (fixPrefix.test(text)) {
            const feedback = text.replace(fixPrefix, '').trim();
            return { ok: true, feedback: feedback || null, ...tokenCounts };
        }
        return { ok: true, feedback: null, ...tokenCounts };
    } catch (err) {
        return { ok: false, error: err.message || String(err) };
    }
}

/**
 * Run the Ask agent: question + codebase context -> markdown answer (no code edits).
 * Used when run mode is "ask". The agent may embed [DIAGRAM: ...] placeholders which
 * are resolved into inline images via the diagram generation tool.
 * @param {string} question - User's question about the codebase.
 * @param {object} opts
 * @param {string} [opts.grepContext] - Relevant grep snippets (path:line: content).
 * @param {string} [opts.treeContext] - File tree or structure summary.
 * @param {string} [opts.flightPlanSummary] - Optional scope from Researcher.
 * @param {AbortSignal} [opts.signal]
 * @param {string} [opts.model]
 * @param {string} [opts.runId] - When set, [DIAGRAM:] placeholders are resolved into images stored in S3.
 * @returns {Promise<{ ok: true, report: string, diagramKeys?: string[], warnings?: string[], inputTokens?: number, outputTokens?: number } | { ok: false, error: string }>}
 */
export async function runAsk(question, opts = {}) {
    const { grepContext = '', treeContext = '', flightPlanSummary = '', signal, model: modelOverride, runId } = opts;
    const model = modelOverride && modelOverride.trim() ? modelOverride.trim() : MODEL;
    const systemPrompt = await getAgentPrompt('ask');
    if (!systemPrompt) {
        return { ok: false, error: 'Ask prompt not configured' };
    }
    const contextParts = [];
    if (treeContext) contextParts.push('Codebase structure:\n' + treeContext);
    if (grepContext) contextParts.push('Relevant snippets (path:line: content):\n' + grepContext);
    if (flightPlanSummary) contextParts.push('Scope from research:\n' + flightPlanSummary);
    const userContent = `Question:\n${question}\n\n${contextParts.join('\n\n')}\n\nAnswer in markdown now.`;
    try {
        const response = await withTimeout(
            (async () => {
                return await generateContent({
                    model,
                    systemPrompt,
                    userContent,
                    maxOutputTokens: 8192,
                    signal,
                });
            })(),
            GEMINI_TIMEOUT_MS,
            'Ask timed out'
        );
        const raw = response && (typeof response.text === 'function' ? response.text() : response.text);
        let report = String(raw ?? '').trim();
        const diagramKeys = [];
        const diagramWarnings = [];
        if (runId) {
            const diagramResult = await processDiagramPlaceholders(report, runId, 'ask', signal);
            report = diagramResult.processedReport;
            diagramKeys.push(...diagramResult.diagramKeys);
            diagramWarnings.push(...diagramResult.warnings);
        }
        const usage = response?.usageMetadata;
        return {
            ok: true,
            report,
            ...(diagramKeys.length && { diagramKeys }),
            ...(diagramWarnings.length && { warnings: diagramWarnings }),
            inputTokens: usage?.promptTokenCount ?? 0,
            outputTokens: usage?.candidatesTokenCount ?? 0,
        };
    } catch (err) {
        return { ok: false, error: err.message || String(err) };
    }
}

/**
 * Run the Auditor agent: mission + codebase context -> markdown report (no code edits).
 * Used when run mode is "audit". The agent may embed [DIAGRAM: ...] placeholders which
 * are resolved into inline images via the diagram generation tool.
 * @param {string} missionPrompt - User's audit request (e.g. "audit dark-mode hover and active states").
 * @param {object} opts
 * @param {string} [opts.grepContext] - Relevant grep snippets (path:line: content).
 * @param {string} [opts.treeContext] - File tree or structure summary.
 * @param {string} [opts.flightPlanSummary] - Optional task list from Researcher (scope).
 * @param {AbortSignal} [opts.signal]
 * @param {string} [opts.model]
 * @param {string} [opts.runId] - When set, [DIAGRAM:] placeholders are resolved into images stored in S3.
 * @returns {Promise<{ ok: true, report: string, diagramKeys?: string[], warnings?: string[], inputTokens?: number, outputTokens?: number } | { ok: false, error: string }>}
 */
export async function runAuditor(missionPrompt, opts = {}) {
    const { grepContext = '', treeContext = '', flightPlanSummary = '', signal, model: modelOverride, runId } = opts;
    const model = modelOverride && modelOverride.trim() ? modelOverride.trim() : MODEL;
    const systemPrompt = await getAgentPrompt('auditor');
    if (!systemPrompt) {
        return { ok: false, error: 'Auditor prompt not configured' };
    }
    const contextParts = [];
    if (treeContext) contextParts.push('Codebase structure:\n' + treeContext);
    if (grepContext) contextParts.push('Relevant snippets (path:line: content):\n' + grepContext);
    if (flightPlanSummary) contextParts.push('Scope / tasks from Researcher:\n' + flightPlanSummary);
    const userContent = `Audit request:\n${missionPrompt}\n\n${contextParts.join('\n\n')}\n\nProduce the markdown report now.`;
    try {
        const response = await withTimeout(
            (async () => {
                return await generateContent({
                    model,
                    systemPrompt,
                    userContent,
                    maxOutputTokens: 8192,
                    signal,
                });
            })(),
            GEMINI_TIMEOUT_MS,
            'Auditor timed out'
        );
        const raw = response && (typeof response.text === 'function' ? response.text() : response.text);
        let report = String(raw ?? '').trim();
        const diagramKeys = [];
        const diagramWarnings = [];
        if (runId) {
            const diagramResult = await processDiagramPlaceholders(report, runId, 'audit', signal);
            report = diagramResult.processedReport;
            diagramKeys.push(...diagramResult.diagramKeys);
            diagramWarnings.push(...diagramResult.warnings);
        }
        const usage = response?.usageMetadata;
        return {
            ok: true,
            report,
            ...(diagramKeys.length && { diagramKeys }),
            ...(diagramWarnings.length && { warnings: diagramWarnings }),
            inputTokens: usage?.promptTokenCount ?? 0,
            outputTokens: usage?.candidatesTokenCount ?? 0,
        };
    } catch (err) {
        return { ok: false, error: err.message || String(err) };
    }
}

/**
 * Run the Tester agent: branch name + diff -> markdown review report (Merge / Request changes / Reject).
 * Used when run mode is "review".
 * @param {string} branchName - Head branch being reviewed (e.g. agent/run-xyz).
 * @param {object} opts
 * @param {string} opts.diffText - Full or truncated diff vs base.
 * @param {string} [opts.baseBranch] - Base branch (e.g. main).
 * @param {string} [opts.headBranch] - Same as branchName, for clarity.
 * @param {AbortSignal} [opts.signal]
 * @param {string} [opts.model]
 * @param {string} [opts.runId] - When set, [DIAGRAM:] placeholders are resolved into images stored in S3.
 * @returns {Promise<{ ok: true, report: string, diagramKeys?: string[], warnings?: string[], inputTokens?: number, outputTokens?: number } | { ok: false, error: string }>}
 */
export async function runTester(branchName, opts = {}) {
    const { diffText = '', baseBranch = 'main', headBranch = branchName, signal, model: modelOverride, runId } = opts;
    const model = modelOverride && modelOverride.trim() ? modelOverride.trim() : MODEL;
    const systemPrompt = await getAgentPrompt('tester');
    if (!systemPrompt) {
        return { ok: false, error: 'Tester prompt not configured' };
    }
    const userContent = `Branch: ${headBranch}\nBase: ${baseBranch}\n\nDiff:\n\`\`\`\n${diffText}\n\`\`\`\n\nProduce the markdown review report now.`;
    try {
        const response = await withTimeout(
            (async () => {
                return await generateContent({
                    model,
                    systemPrompt,
                    userContent,
                    maxOutputTokens: 8192,
                    signal,
                });
            })(),
            GEMINI_TIMEOUT_MS,
            'Tester timed out'
        );
        const raw = response && (typeof response.text === 'function' ? response.text() : response.text);
        let report = String(raw ?? '').trim();
        const diagramKeys = [];
        const diagramWarnings = [];
        if (runId) {
            const diagramResult = await processDiagramPlaceholders(report, runId, 'review', signal);
            report = diagramResult.processedReport;
            diagramKeys.push(...diagramResult.diagramKeys);
            diagramWarnings.push(...diagramResult.warnings);
        }
        const usage = response?.usageMetadata;
        return {
            ok: true,
            report,
            ...(diagramKeys.length && { diagramKeys }),
            ...(diagramWarnings.length && { warnings: diagramWarnings }),
            inputTokens: usage?.promptTokenCount ?? 0,
            outputTokens: usage?.candidatesTokenCount ?? 0,
        };
    } catch (err) {
        return { ok: false, error: err.message || String(err) };
    }
}
