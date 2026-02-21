# Why the “Model dropdown icons” Mission Run Failed (Deep Dive)

This doc explains how the Missions pipeline works and why your test prompt (“add icons to the Model dropdown in /admin/agent”) produced **no edits** and messages like “no edits provided” / “no source code provided”.

## Pipeline in 30 seconds

1. **Researcher** – Turns the mission into a **flight plan**: JSON array of tasks with `id`, `title`, `description`, **`hints`** (file paths).
2. **Planner** – For each task, turns it into **implementation steps**: each step has `what`, **`files`** (paths to touch), `changeDescription`.
3. **Coder** – For each step, gets **only** the contents of `step.files` (or, if empty, files from **task.hints**). It must output a JSON array of **patch edits** `{ path, search, replace }` or `{ path, content }`.
4. **Validator** – Another LLM call: “Do these edits satisfy the step?” → `done` or `failed: <reason>`.
5. Only **validated** edits are aggregated and sent to the PR.

So: **no file context → Coder has nothing to copy `search` from → no valid edits.** And **wrong/empty steps → Validator says “no edits” or “no source code provided”.**

---

## Where your run likely broke

### 1. Step design (Planner)

Your run had steps like:

- “Define model icon mapping”
- “Render icons in model dropdown options”

Problems:

- **“Define model icon mapping”** sounds like a data-structure task. The Planner may have set **`files: []`** (nothing to “edit”), so the Coder got **no file context** for that step (unless the **task** had `hints` with `src/admin/agent/agentRoutes.js`).
- If the **Researcher** didn’t put `src/admin/agent/agentRoutes.js` in **task hints**, then:
  - `buildFileContextForTask` still gets it for the **Planner** if **grep** found it (e.g. keyword “model” or “dropdown” in `src/`).
  - But **Coder** file context is built only from **`step.files`** and, if empty, **`parseHintPaths(task)`** (i.e. task hints). So if the task had no hints, Coder got **empty** file context for a step with `files: []`.

So: **empty or wrong `step.files`** plus **missing or weak task hints** → Coder sees no “Current file contents” → it can’t produce valid `search`/`replace` patches → parse or validation fails.

### 2. Coder output (parse failure)

The Coder is instructed to output **only** a JSON array of edits (or an object with `edits` / `changes` / `files`). If it:

- Outputs prose (“I will add icons by…”) and then JSON in an unexpected shape, or
- Outputs JSON with literal newlines inside strings (the parser is relaxed but not perfect), or
- Outputs an empty array `[]` because it had no file content to base patches on,

then:

- **`parseCoderEdits`** returns `[]` → the pipeline throws **“Could not parse edits from response”** → step fails with that error (or “No result”).

So: **“no edits provided”** in the UI can mean **parse failed** (Coder never produced a valid edits array).

### 3. Validator (validation failure)

If the Coder **did** return something parseable but:

- **Edits were empty** (`edits: []`), or  
- **Edits had wrong path** (e.g. not in `allowedPaths` → “edit targets path not in allowed list”), or  
- **Edits didn’t look like real code** (e.g. empty `content`, or placeholder text),

then the **Validator** LLM is asked: “Do these edits satisfy the step and mission?” It can reply e.g.:

- **“failed: no edits provided”**
- **“failed: no source code provided”**

So: **“no source code provided”** is almost certainly the **Validator’s** free-form reason, not a literal string from the pipeline code. It means: “Coder gave edits, but they don’t satisfy the step” (e.g. no real code, or wrong file).

---

## Root causes (concise)

| What you saw              | Likely cause |
|---------------------------|--------------|
| “no edits provided”       | Parse failed (Coder output not a valid edits array) **or** Validator said edits are missing. |
| “no source code provided” | Validator decided the Coder’s edits don’t contain real code (empty/wrong/placeholder). |
| “Run complete (no edits approved)” | All Coder steps either failed parse, failed validation, or were rejected by allowedPaths. |

Underlying chain:

1. **Researcher** may not have put **`src/admin/agent/agentRoutes.js`** in **hints** for the “dropdown/icons” task (mission said “Missions control panel” and “Model dropdown” but didn’t name the file).
2. **Planner** produced steps that were either **abstract** (“Define model icon mapping”) with **`files: []`**, or steps that did list files but Coder still got empty context due to how context is built only from `step.files` + task hints.
3. **Coder** with **empty file context** cannot produce valid **search/replace** patches (it’s told to copy “search” EXACTLY from “Current file contents”). So it either returned invalid JSON, an empty array, or edits that the Validator rejected as “no source code”.

---

## How the fix you have now would have been produced

A human (or a direct Coder call) that:

1. **Knows the file**: `src/admin/agent/agentRoutes.js` (model dropdown and `modelMeta`).
2. **Gets full file content** so it can emit exact `search`/`replace` or full `content`.
3. **Outputs strict JSON** edits (path + search/replace or path + content).

So the fix was **file location + context + correct output format**. The Mission run failed because at least one of those was missing in the chain (hints → step.files → Coder context → parse/validation).

---

## What could be improved (for future Missions)

1. **Researcher prompt / FILE MAPPING**  
   Already says: “For the Agent PR page: **src/admin/agent/agentRoutes.js**”. Strengthen that when the mission mentions “dropdown”, “model menu”, “Missions control panel”, or “admin/agent” so the Researcher consistently adds this file to **hints**.

2. **Planner**  
   Already says: “If the mission requires any visible UI change … you MUST include the file that renders that HTML or contains its inline JavaScript in the **files** array.” For “Model dropdown … icons”, that file is `agentRoutes.js`. So the Planner should list it in **every** step that touches the dropdown. Making step titles more concrete (e.g. “Add icon field to modelMeta and render in agentRoutes.js dropdown”) may help.

3. **Coder file context when step.files is empty**  
   Today Coder falls back to **task hints** only. Optionally: when the mission clearly refers to the admin Agent page (e.g. “/admin/agent”, “Missions control panel”, “model dropdown”), **inject** `src/admin/agent/agentRoutes.js` into Coder context (similar to how Discord command steps get `promptLoader.js` and `main.js`). That way even one abstract step with `files: []` would still see the right file.

4. **Logging**  
   When a Coder step fails, the run could store **last Coder raw response** (e.g. first 1–2k chars) in the run or logs (with PII/sensitivity in mind). That would make it obvious whether the failure was parse (bad JSON) vs validation (“no source code provided”).

---

## Summary

The Mission failed because:

- The **Coder** likely had **no (or wrong) file context** for the steps (due to abstract step names, `files: []`, and/or missing task hints for `agentRoutes.js`).
- Without file content it can’t emit valid **search/replace** patches, so either **parsing** failed or the **Validator** rejected the edits as “no edits” / “no source code provided”.

The fix you have (icons in `modelMeta` + API + dropdown) is exactly what the pipeline would need to produce if the same mission were run with the right hints, concrete step.files, and the same file content we used when applying the change by hand.
