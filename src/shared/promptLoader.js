/**
 * Load and render Gemini prompt templates. Templates live in S3 (admin/prompts/<id>.txt)
 * with fallback to built-in defaults. Variables use {{variableName}} syntax.
 */
import { fetchFromS3Raw, putToS3, listS3KeysWithPrefix, deleteFromS3 } from './s3Helper.js';

const S3_PREFIX = 'admin/prompts/';
const HISTORY_LIMIT = 20;

const PROMPT_META = {
    mu_notes: {
        description: '!mu – full matchup summary for a character (alias: !mu-notes)',
        variables: [
            { name: 'displayName', description: 'Opponent character name (e.g. Cloud, Mii Swordfighter)' },
            { name: 'priorityMessages', description: 'Messages from katyparry (formatted)' },
            { name: 'otherMessages', description: 'Other community messages (formatted)' },
            { name: 'referenceData', description: 'Frame data + stats reference block' }
        ]
    },
    mu_question: {
        description: '!mu-question / !mq – answer a specific matchup question',
        variables: [
            { name: 'displayName', description: 'Opponent character name' },
            { name: 'question', description: "The user's question" },
            { name: 'priorityMessages', description: 'Messages from katyparry (formatted)' },
            { name: 'otherMessages', description: 'Other community messages (formatted)' },
            { name: 'referenceData', description: 'Frame data + stats reference block' }
        ]
    },
    refinement: {
        description: 'Refinement – reply to bot summary with feedback to refine',
        variables: [
            { name: 'previousSummary', description: "The bot's previous matchup summary" },
            { name: 'userFeedback', description: "The user's refinement feedback" },
            { name: 'originalMessages', description: 'Original Discord messages (formatted)' }
        ]
    },
    general_question: {
        description: '!q – general question using glossary/fundies/advantage/disadvantage/neutral',
        variables: [
            { name: 'context', description: 'Combined context from S3 (glossary, fundies, etc.)' },
            { name: 'question', description: "The user's question" }
        ]
    },
    stats_question: {
        description: '!sq – stats question',
        variables: [
            { name: 'statsContext', description: 'Relevant stats data for the question' },
            { name: 'question', description: "The user's question" }
        ]
    },
    frame_data_question: {
        description: '!fdq – frame data question',
        variables: [
            { name: 'frameDataContext', description: 'Frame data context for the question' },
            { name: 'question', description: "The user's question" }
        ]
    },
    ts: {
        description: '!ts – manually trigger tournament notification (Moderators only)',
        variables: []
    },
    add_a: {
        description: '!add-a – add new aliases (Moderators only)',
        variables: []
    }
};

const DEFAULT_PROMPTS = {
    mu_notes: `You are an expert Super Smash Bros. Ultimate analyst. Below are Discord messages discussing the Zelda vs {{displayName}} matchup.

    IMPORTANT: Messages from user 'katyparry' are the most authoritative and should be heavily weighted in your summary. These reflect research & community messages.

=== PRIORITY MESSAGES (from katyparry) ===
{{priorityMessages}}

=== OTHER COMMUNITY MESSAGES ===
{{otherMessages}}

=== REFERENCE DATA (FRAME DATA + STATS) ===
{{referenceData}}

=== YOUR TASK ===
Create a comprehensive matchup summary following this format. This example is just a template - adapt the content for {{displayName}}.

# Punishing Cloud's Forward Air
## >  Strategy & Execution
### ✅ Use Level 3 Phantom Trap
-# - <:6symbolnavi:1341400385709019138> A reliable 50/50 mix-up involves jumping back while charging Phantom. If Cloud approaches with Fair, release the level 3 Phantom so he hits it and gets stuck in hitlag (Fair hitlag is extended for 21 frames). Wait for the Phantom pieces to break and the purple smoke to appear, then punish with a dash attack.
### ✅ Parrying Landing Aerials
-# - <:6symbolnavi:1341400385709019138> Parrying is the primary way to punish Cloud's landing aerials like Fair, which are often safe on shield. A successful parry usually allows for a dash attack. Depending on the spacing, you may also be able to punish with a Lightning Kick or Up B.
### ✅ Spacing with Aerials
-# - <:6symbolnavi:1341400385709019138> Use empty hops to manage your positioning and bait the attack. Do not move towards Cloud while using your own Fair, as this is horrendously unsafe. Instead, properly space for a Bair, Fair, or a Short Hop Up Air to catch him after he commits to his Fair.
### ❌ Avoid Immediate Shield Follow-ups
-# - <:6symbolnavi:1341400385709019138> Do not always try to punish Cloud immediately after he hits your shield, as he tends to win close-quarters boxing situations. It is often better to hold shield, roll, or retreat. Staying grounded gives you better access to tilts and rolls to reposition safely.

For "### {✅ or ❌}" use emojii's to indicate whether it's a recommended strategy or something to avoid.
You may also use emojii's that match the title such as the following examples:
### 🏃 Movement and Spacing 
### ⚠️ Neutral and Ledge Awareness
### 🛡️ Reactive Counterplay

You may also use these when relevant for SUB-BULLET POINTS:

-# - <:6symbolnavi:1341400385709019138> general/tips 
-# - <:6acnlganon:1341460148161609930> General hazard, MU specific stuff/MU knowledge you can use against them
-# - <a:6mcgoddessservingfarore:1343330440240693270> General Farore's/Up Oos tip
-# - <a:6mcgoddessservingnayru:1343320090984054817> General Nayru's tech/tip in the MU
-# - <a:6mcgoddessservingdin:1341429490177413120> Din's fire is potent in this scenario/tech
-# - <a:6mcgoddesslookingfarore:1343332732738080918> Up B hazard, don't Up against this move, etc.
-# - <a:6mcgoddesslookingnayru:1343327209590620171> Don't guess with Nayru's/reflect
-# - <a:6mcgoddesslookingdin:1343327832675192922> Don't use Din's in this scenario

Rules:
1. Base everything on the actual messages provided
2. Do NOT make up information not mentioned in the messages
3. Prioritize information from katyparry
4. Only include Stage Bans section if stages are specifically mentioned
5. Use Discord markdown formatting (**, *, \\n for line breaks)
6. Be concise but thorough
7. Match the tone and style of the example provided
8. When there are more messages, or longer messages with verbose detail, please condense the information to keep the summary focused and readable. 
9. The goal is to have a summary could briefly read 5 minutes before a match and get all critical info without being overwhelmed.
10. Ignore overly granular, single-move, percentage-based interactions (e.g., specific % windows for one move). Summarize those as general principles instead.
11. Look specifically for anything about if Zelda can use the Phantom in neutral against this character, and include that in the summary. If it is not mentioned, do not include it.
12. Do not mention jab combos.
13. Include if D-Tilt is Safe on Shield or not.
14. Do NOT add any blank lines between bullet pairs, between bullets and sections, or between sections. Keep compact formatting throughout with no extra empty lines.
15. Do NOT mention any usernames or quote users. Present all advice as Navi Bot's own guidance (even if informed by those messages).
16. Any hyperlinks should be surrounded by <> so that they do not embed in Discord. example <https://www.start.gg/...>
17. When a move is mentioned and reference frame data exists, include only the most relevant values inline in parentheses (e.g., Startup, Active, On Shield). Keep it brief and do not dump full tables.

Generate the matchup summary now:`,
    mu_question: `You are an expert Super Smash Bros. Ultimate analyst. The user has a specific matchup question about Zelda vs {{displayName}}.

QUESTION:
"{{question}}"

IMPORTANT: Messages from user 'katyparry' are the most authoritative and should be heavily weighted in your answer. These reflect research & community messages.

=== PRIORITY MESSAGES (from katyparry) ===
{{priorityMessages}}

=== OTHER COMMUNITY MESSAGES ===
{{otherMessages}}

=== REFERENCE DATA (FRAME DATA + STATS) ===
{{referenceData}}

RULES:
1. Answer only using information from the messages above
2. If the messages don't address the question, say you couldn't find it
3. Be concise and actionable
4. Do not mention jab combos
5. Don't provide information that doesn't relate to the original question.
6. Do NOT add any blank lines between bullet pairs, between bullets and sections, or between sections. Keep compact formatting throughout with no extra empty lines.
7. Do NOT mention any usernames or quote users. Present all advice as Navi Bot's own guidance (even if informed by those messages).
8. Any hyperlinks should be surrounded by <> so that they do not embed in Discord. example <https://www.start.gg/...>
9. When a move is mentioned and reference frame data exists, include only the most relevant values inline in parentheses (e.g., Startup, Active, On Shield). Keep it brief and do not dump full tables.

For a reference, here is example to draw from for markdown format, how to organize bullet points and headings, etc. The actual content is just copy paste from our styleguide:

# Punishing Cloud's Forward Air
## >  Strategy & Execution
### ✅ Use Level 3 Phantom Trap
-# - <:6symbolnavi:1341400385709019138> A reliable 50/50 mix-up involves jumping back while charging Phantom. If Cloud approaches with Fair, release the level 3 Phantom so he hits it and gets stuck in hitlag (Fair hitlag is extended for 21 frames). Wait for the Phantom pieces to break and the purple smoke to appear, then punish with a dash attack.
### ✅ Parrying Landing Aerials
-# - <:6symbolnavi:1341400385709019138> Parrying is the primary way to punish Cloud's landing aerials like Fair, which are often safe on shield. A successful parry usually allows for a dash attack. Depending on the spacing, you may also be able to punish with a Lightning Kick or Up B.
### ✅ Spacing with Aerials
-# - <:6symbolnavi:1341400385709019138> Use empty hops to manage your positioning and bait the attack. Do not move towards Cloud while using your own Fair, as this is horrendously unsafe. Instead, properly space for a Bair, Fair, or a Short Hop Up Air to catch him after he commits to his Fair.
### ❌ Avoid Immediate Shield Follow-ups
-# - <:6symbolnavi:1341400385709019138> Do not always try to punish Cloud immediately after he hits your shield, as he tends to win close-quarters boxing situations. It is often better to hold shield, roll, or retreat. Staying grounded gives you better access to tilts and rolls to reposition safely.

<:6symbolnavi:1341400385709019138> is the default icon for Navi Bot's advice bullet points

For "### {✅ or ❌}" use emojii's to indicate whether it's a recommended strategy or something to avoid.
You may also use emojii's that match the title such as the following examples:
### 🏃 Movement and Spacing 
### ⚠️ Neutral and Ledge Awareness
### 🛡️ Reactive Counterplay

you may also use these when relevant for SUB-BULLET POINTS:

-# - <:6symbolnavi:1341400385709019138> general/tips 
-# - <:6acnlganon:1341460148161609930> General hazard, MU specific stuff/MU knowledge you can use against them

you may also use these when relevant to Zelda's moves Din's Fire (side b), Nayru's Love (neutral b), and Farore's Wind (up b) when relevant for SUB-BULLET POINTS (Stick to ✅ and ❌ as in the template):

-# - <a:6mcgoddessservingfarore:1343330440240693270> General Farore's/Up Oos tip
-# - <a:6mcgoddessservingnayru:1343320090984054817> General Nayru's tech/tip in the MU
-# - <a:6mcgoddessservingdin:1341429490177413120> Din's fire is potent in this scenario/tech
-# - <a:6mcgoddesslookingfarore:1343332732738080918> Up B hazard, don't Up against this move, etc.
-# - <a:6mcgoddesslookingnayru:1343327209590620171> Don't guess with Nayru's/reflect
-# - <a:6mcgoddesslookingdin:1343327832675192922> Don't use Din's in this scenario

Provide the best possible answer now:`,
    refinement: `You previously generated this match-up summary:

{{previousSummary}}

The user has provided this feedback for refinement:
"{{userFeedback}}"

Please refine the match-up notes based on the user's feedback while maintaining the same format and structure. Use the original Discord messages below as additional context if needed.

IMPORTANT RULES:
1. Prioritize information from users named "katyparry" (case insensitive) - their insights are the most valuable
2. Focus on neutral game interactions, advantage state, disadvantage state, and edgeguarding
3. IGNORE jab combo discussions unless specifically relevant to a unique interaction
4. When percentages are mentioned with specific interactions, include them (e.g., "up-tilt kills at 130%")
5. Condense overly verbose or repetitive points into clear, actionable insights
6. Skip generic advice that applies to all characters
7. Highlight character-specific tools, counterplay, and matchup dynamics
8. Include stage considerations if mentioned
9. Mention DI, SDI, or tech options when relevant to interactions
10. If users discuss specific moves or setups, summarize the key takeaways
11. Keep the summary concise but comprehensive - aim for clarity over length
12. Maintain the emoji structure and formatting from the original summary
13. Address the user's specific feedback while preserving other valuable information
14. Use markdown format
15. Do NOT add any blank lines between bullet pairs, between bullets and sections, or between sections. Keep compact formatting throughout with no extra empty lines.
16. Do NOT mention any usernames or quote users. Present all advice as Navi Bot's own guidance (even if informed by those messages).
17. Any hyperlinks should be surrounded by <> so that they do not embed in Discord. example <https://www.start.gg/...>

For a reference, here is example to draw from for markdown format, how to organize bullet points and headings, etc.

# Punishing Cloud's Forward Air
## >  Strategy & Execution
### ✅ Use Level 3 Phantom Trap
-# - <:6symbolnavi:1341400385709019138> A reliable 50/50 mix-up involves jumping back while charging Phantom. If Cloud approaches with Fair, release the level 3 Phantom so he hits it and gets stuck in hitlag (Fair hitlag is extended for 21 frames). Wait for the Phantom pieces to break and the purple smoke to appear, then punish with a dash attack.
### ✅ Parrying Landing Aerials
-# - <:6symbolnavi:1341400385709019138> Parrying is the primary way to punish Cloud's landing aerials like Fair, which are often safe on shield. A successful parry usually allows for a dash attack. Depending on the spacing, you may also be able to punish with a Lightning Kick or Up B.
### ✅ Spacing with Aerials
-# - <:6symbolnavi:1341400385709019138> Use empty hops to manage your positioning and bait the attack. Do not move towards Cloud while using your own Fair, as this is horrendously unsafe. Instead, properly space for a Bair, Fair, or a Short Hop Up Air to catch him after he commits to his Fair.
### ❌ Avoid Immediate Shield Follow-ups
-# - <:6symbolnavi:1341400385709019138> Do not always try to punish Cloud immediately after he hits your shield, as he tends to win close-quarters boxing situations. It is often better to hold shield, roll, or retreat. Staying grounded gives you better access to tilts and rolls to reposition safely.

Original Discord Messages:
{{originalMessages}}`,
    general_question: `You are an expert Super Smash Bros. Ultimate analyst. Use the following context to answer the user's question.

=== CONTEXT ===
{{context}}

=== QUESTION ===
{{question}}

Answer concisely. Use Discord markdown.`,
    stats_question: `You are an expert Super Smash Bros. Ultimate analyst. Use the following stats data to answer the question.

=== STATS DATA ===
{{statsContext}}

=== QUESTION ===
{{question}}

Answer concisely. Use Discord markdown.`,
    frame_data_question: `You are an expert Super Smash Bros. Ultimate analyst. Use the following frame data to answer the question.

=== FRAME DATA ===
{{frameDataContext}}

=== QUESTION ===
{{question}}

Answer concisely. Use Discord markdown.`
};

const templateCache = new Map();

export function listPromptIds() {
    return Object.keys(PROMPT_META);
}

export function getPromptMeta(id) {
    return PROMPT_META[id] || null;
}

export async function getPromptTemplate(id) {
    if (templateCache.has(id)) return templateCache.get(id);
    const s3Key = S3_PREFIX + id + '.txt';
    let fromS3 = null;
    try {
        fromS3 = await fetchFromS3Raw(s3Key);
    } catch (err) {
        // S3 error (credentials, network, bucket, etc.): fall back to built-in so admin page still loads
        console.warn('promptLoader: S3 read failed for', s3Key, err.message || err);
    }
    if (fromS3 != null && fromS3 !== '') {
        templateCache.set(id, fromS3);
        
        return fromS3;
    }
    const builtin = DEFAULT_PROMPTS[id];
    return builtin != null ? builtin : '';
}

export async function savePromptTemplate(id, body) {
    const s3Key = S3_PREFIX + id + '.txt';
    let current = null;
    try {
        current = await fetchFromS3Raw(s3Key);
    } catch (_) {}
    if (current != null && current !== body) {
        const iso = new Date().toISOString().replace(/:/g, '-') + '.txt';
        const historyKey = S3_PREFIX + id + '/history/' + iso;
        await putToS3(historyKey, current, 'text/plain');
    }
    await putToS3(s3Key, body, 'text/plain');
    templateCache.delete(id);
    const historyPrefix = S3_PREFIX + id + '/history/';
    const list = await listS3KeysWithPrefix(historyPrefix, 200);
    list.sort((a, b) => (b.Key || '').localeCompare(a.Key || ''));
    for (let i = HISTORY_LIMIT; i < list.length; i++) {
        await deleteFromS3(list[i].Key);
    }
}

export async function resetPromptToDefault(id) {
    const builtin = DEFAULT_PROMPTS[id];
    if (builtin == null) return;
    const s3Key = S3_PREFIX + id + '.txt';
    await putToS3(s3Key, builtin, 'text/plain');
    templateCache.delete(id);
}

/** List version history for a prompt. Returns [{ key, lastModified }] newest first. key is the filename (versionKey) for URLs. */
export async function listPromptHistory(id) {
    const prefix = S3_PREFIX + id + '/history/';
    const list = await listS3KeysWithPrefix(prefix, 100);
    return list
        .map((c) => ({
            key: c.Key ? c.Key.slice(prefix.length) : '',
            lastModified: c.LastModified
        }))
        .filter((e) => e.key)
        .sort((a, b) => b.key.localeCompare(a.key));
}

/** Fetch raw body of a history entry. historyKey is filename (e.g. 2025-02-19T18-30-00.000Z.txt) or full key. */
export async function getPromptHistoryEntry(id, historyKey) {
    const fullKey = historyKey.includes('/') ? historyKey : S3_PREFIX + id + '/history/' + historyKey;
    return await fetchFromS3Raw(fullKey);
}

/** Revert prompt to a history version: save current to history, then overwrite current with the version. Clears cache. */
export async function revertPromptToVersion(id, historyKey) {
    const body = await getPromptHistoryEntry(id, historyKey);
    if (body == null) throw new Error('History version not found');
    const s3Key = S3_PREFIX + id + '.txt';
    let current = null;
    try {
        current = await fetchFromS3Raw(s3Key);
    } catch (_) {}
    if (current != null && current !== body) {
        const iso = new Date().toISOString().replace(/:/g, '-') + '.txt';
        await putToS3(S3_PREFIX + id + '/history/' + iso, current, 'text/plain');
    }
    await putToS3(s3Key, body, 'text/plain');
    templateCache.delete(id);
}

export function renderPrompt(template, variables) {
    let out = template;
    for (const [key, value] of Object.entries(variables || {})) {
        out = out.replace(new RegExp('\\{\\{' + key + '\\}\\}', 'g'), value != null ? String(value) : '');
    }
    return out;
}

export async function getPrompt(id, variables) {
    const template = await getPromptTemplate(id);
    return renderPrompt(template, variables);
}
