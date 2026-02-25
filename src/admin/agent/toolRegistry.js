/**
 * Modular tool registry for agent codebase (and future MCP) tools.
 * Each tool: name, description, parameters (optional), invoke(args).
 * Use callTool(name, args) so the orchestrator and agents use a single interface;
 * MCP servers can register tools here later (optionally per role).
 */
import * as codebaseTools from './codebaseTools.js';

/** @typedef {{ name: string, description: string, parameters?: object, invoke: (args: object) => Promise<{ ok: true, result: any } | { ok: false, error: string }> }} Tool */

/** @type {Map<string, Tool>} */
const tools = new Map();

/** @type {Map<string, Set<string>>} role -> set of tool names (optional; when empty, tool is global) */
const roleTools = new Map();

function registerBuiltIn() {
    register({
        name: 'list_directory',
        description: 'List direct children (files and folders) of a directory path.',
        parameters: { dirPath: { type: 'string', description: 'Path relative to repo root (e.g. "src" or "")' } },
        async invoke(args) {
            const r = await codebaseTools.listDirectory(args.dirPath ?? '');
            if (!r.ok) return { ok: false, error: r.error };
            return { ok: true, result: r.entries };
        },
    });
    register({
        name: 'read_file',
        description: 'Read full text contents of a file.',
        parameters: {
            path: { type: 'string', description: 'File path relative to repo root' },
            forCoderContext: { type: 'boolean', description: 'Use larger read limits for coder context' },
        },
        async invoke(args) {
            const r = await codebaseTools.readFile(args.path ?? '', { forCoderContext: !!args.forCoderContext });
            if (!r.ok) return { ok: false, error: r.error };
            return { ok: true, result: r.content };
        },
    });
    register({
        name: 'get_file_tree',
        description: 'Get a shallow file tree (e.g. first 2 levels) for a path prefix.',
        parameters: {
            prefix: { type: 'string', description: 'Path prefix (e.g. "src" or "")' },
            maxDepth: { type: 'number', description: 'Max depth (default 2)' },
        },
        async invoke(args) {
            const r = await codebaseTools.getFileTree(args.prefix ?? '', args.maxDepth ?? 2);
            if (!r.ok) return { ok: false, error: r.error };
            return { ok: true, result: r.tree };
        },
    });
    register({
        name: 'grep_search',
        description: 'Search for a pattern in text files under a path prefix. Returns matching lines with path, lineNumber, line.',
        parameters: {
            pattern: { type: 'string', description: 'Search pattern (substring, case-insensitive)' },
            pathPrefix: { type: 'string', description: 'Path prefix to search under (default "")' },
        },
        async invoke(args) {
            const r = await codebaseTools.grepSearch(
                args.pattern ?? '',
                args.pathPrefix ?? '',
                { maxTotal: args.maxTotal ?? 100, maxPerFile: args.maxPerFile ?? 10 }
            );
            if (!r.ok) return { ok: false, error: r.error };
            return { ok: true, result: r.matches };
        },
    });
}

/**
 * Register a tool. Overwrites if name already exists.
 * @param {Tool} tool
 */
export function register(tool) {
    tools.set(tool.name, tool);
}

/**
 * List registered tools, optionally filtered by role.
 * @param {string} [role] - If provided, return only tools registered for this role (future use); today returns all.
 * @returns {Tool[]}
 */
export function listTools(role) {
    if (role && roleTools.has(role)) {
        const names = roleTools.get(role);
        return Array.from(names).map((n) => tools.get(n)).filter(Boolean);
    }
    return Array.from(tools.values());
}

/**
 * Call a tool by name.
 * @param {string} name
 * @param {object} args
 * @returns {Promise<{ ok: true, result: any } | { ok: false, error: string }>}
 */
export async function callTool(name, args = {}) {
    const tool = tools.get(name);
    if (!tool) return { ok: false, error: 'Unknown tool: ' + name };
    try {
        return await tool.invoke(args);
    } catch (err) {
        return { ok: false, error: err.message || String(err) };
    }
}

/**
 * Register a tool for a specific role (optional). Used when MCP or per-agent tools are added.
 * @param {string} role - e.g. 'researcher', 'planner', 'coder'
 * @param {string} toolName
 */
export function registerToolForRole(role, toolName) {
    if (!roleTools.has(role)) roleTools.set(role, new Set());
    roleTools.get(role).add(toolName);
}

registerBuiltIn();
