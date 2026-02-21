# Diagram as agent tool (Audit / Ask / Review) with inline placement

## Goal

1. **Diagram as a tool, not a model choice:** In Audit, Ask, and Review modes, the agent can "call" a diagram tool. When it does, the backend generates an image (via an image-capable model like Nano Banana), uploads it to S3, and inserts it into the report. The user continues to pick any model (e.g. Gemini Flash, Claude) for the main response; the tool runs server-side with a dedicated image model.
2. **Thoughtful placement:** The graphic appears **inside** the answer or audit report where it fits the narrative (e.g. after "Here's the flow:" and before "Details below"), not only at the top or bottom.

## Approach: placeholder + post-processing

Avoid requiring native tool-calling in the first iteration:

- **Prompt:** Tell the Auditor and Ask (and optionally Review) agents: "When a diagram would help (e.g. code flow, architecture, structure), include a single placeholder on its own line: `[DIAGRAM: brief description of what to draw]`. Put it exactly where the diagram should appear in your narrative. We will replace it with the generated image."
- **After the agent responds:** In `runAuditor` / `runAsk` (and `runTester` for review if desired), detect the placeholder with a regex (e.g. `\[DIAGRAM:\s*([^\]]+)\]`). If found:
  1. Call a new helper that uses an image-capable model (e.g. Nano Banana) with that description to generate an image.
  2. Upload the image to S3 (e.g. `admin/agent-runs/{runId}/audit-image.png` or `ask-image.png`), store the key on the run.
  3. Replace the placeholder in the report text with markdown: `![Diagram](/admin/agent/run/{runId}/audit-image)` (or ask-image / review-image).
- **Restriction:** Only run this diagram flow when `runMode` is `audit`, `ask`, or `review`; do not run it for PR mode.
- **UI:** The report is already rendered as markdown. Add support in the markdown renderer for images (`![alt](url)`) so that the inserted image URL becomes an inline `<img>` and the diagram appears at the right place in the content.

## Implementation plan

### 1. Diagram generation helper (agents.js or new file)

- Add a function, e.g. `generateDiagramImage(description, runId, type)` where `type` is `'audit'` | `'ask'` | `'review'`.
- Use a fixed image-capable model (e.g. from env `AGENT_DIAGRAM_MODEL` or a constant like `gemini-2.5-flash-preview-05-20` if it supports image gen; otherwise use the same Nano Banana model id used elsewhere).
- Call Gemini `generateContent` with a short system prompt: "You generate a single explanatory diagram image for the user. Output only the image." and user content = the description. Parse `candidates[0].content.parts` for `inlineData` (same as current image extraction).
- Upload to S3: `admin/agent-runs/{runId}/{type}-image.png` (or .jpg by mime), return the key.
- Return `{ key }` or `{ key, warning }` on failure (e.g. no image in response or S3 error).

### 2. Auditor: placeholder detection and diagram injection

- In `runAuditor`, after getting the text report (from the main model, no change to model selection):
  - If `runId` and runMode is audit, run a regex on the report: `\[DIAGRAM:\s*([^\]]+)\]`.
  - If there is a match, call `generateDiagramImage(description, runId, 'audit')`. On success, replace the placeholder in the report with `![Diagram](/admin/agent/run/${runId}/audit-image)` (or the correct path). Set `reportImageKey` from the returned key. On failure, optionally replace with a short note like "*Diagram could not be generated.*" or leave the placeholder and set a warning.
- Persist `auditReportImageKey` as today when an image key is set.

### 3. Ask: same for ask mode

- In `runAsk`, same flow: regex for `[DIAGRAM: ...]`, call `generateDiagramImage(..., 'ask')`, replace with `![Diagram](/admin/agent/run/${runId}/ask-image)`, set `reportImageKey` / `askResponseImageKey`.

### 4. Review (optional)

- If Review should support diagrams, add the same placeholder handling in the Tester/review path and a `reviewReportImageKey` (and route to serve it). Otherwise defer Review to a later iteration.

### 5. Prompts: Auditor and Ask

- In the default (or S3) prompts for **auditor** and **ask**, add a short block, e.g.:
  - "When a diagram would help (e.g. code flow, architecture, data flow), include exactly one line: `[DIAGRAM: short description of what to draw]` at the point in your report where the diagram should appear. We will replace it with the generated image. Do not use this for every answer; only when a visual would clearly help."

### 6. Frontend: render markdown images inline

- In [agentPageContentInner.html](src/admin/agent/agentPageContentInner.html), in `renderAuditMarkdown`, after existing replacements and before returning, add support for markdown images: replace `![alt](url)` with `<img src="url" alt="alt" class="max-w-full h-auto rounded border border-slate-200 dark:border-slate-600" />`. Use a regex that does not break on escaped characters (e.g. `!\[([^\]]*)\]\(([^)]+)\)`). Ensure the URL is our own path (e.g. start with `/admin/agent/run/`) if you want to restrict to same-origin; otherwise allow any URL for flexibility.
- The existing separate "audit report image" / "ask report image" block that shows one image above the report can remain as a fallback when there is an image key but no inline placeholder (e.g. legacy runs), or be removed once all flows use inline placement; the plan can leave that as-is to avoid breaking existing runs.

### 7. Model dropdown and image-capable models

- Today, image-capable models appear in the dropdown only for Audit/Ask. After this change, diagrams are produced by the **tool** (fixed image model), not by the user-selected model. You can either:
  - **Option A:** Stop showing image-capable models in the dropdown for Audit/Ask (simplify dropdown; diagrams only via tool), or
  - **Option B:** Keep current behavior (user can still pick an image model and get native image + tool diagram). Recommend Option A for clarity unless you want both.

### 8. Run store and API

- Already have `auditReportImageKey` and `askResponseImageKey` and routes to serve them. When the placeholder is replaced with `![Diagram](/admin/agent/run/{runId}/audit-image)`, the same route serves the image; no change needed. If you add review diagrams, add `reviewReportImageKey` and a GET route for it.

## Summary

| Item | Action |
|------|--------|
| Diagram source | Tool (placeholder + post-process), not user-selected model |
| Modes | Audit, Ask, (optional) Review only; not PR |
| Placement | Agent puts `[DIAGRAM: description]` in the report; we replace with markdown image so it appears inline |
| Image generation | New helper calling image-capable model, upload to S3 |
| UI | Extend `renderAuditMarkdown` to convert `![alt](url)` to `<img>` so the diagram shows in the right place |

## Out of scope / follow-up

- Multiple diagrams per report (multiple placeholders and multiple image keys).
- Native Gemini/Claude tool-calling for the diagram (could be a later refactor for a more "agent calls tool" feel).
- Review mode diagram support can be added in the same way if desired.
