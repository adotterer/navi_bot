# Corrected mission: !logs command with Discord Embeds

Use this mission text when requesting or reviewing the !logs implementation. It matches the existing codebase so the Quality agent won’t reject for spec deviation.

---

## Mission

Implement the **!logs** command using Discord Embeds: last 100 lines of the system log, sent as embed(s) with code-block formatting, respecting Discord’s embed description limit and Moderators/Legend-only access.

## Implementation (aligned with codebase)

- **Entry point:** `main.js` already listens for `!logs` and calls the handler; no change needed there.
- **Handler:** `src/messages/logHandler.js` must export **`handleGetLogs(message)`** (this name is what `main.js` imports and calls).
- **Permissions:** At the top of the handler, enforce Moderators/Legend only; reply with a clear error if the user is not allowed.
- **Log source:** Use `process.env.LOG_PATH` with a fallback default (e.g. `/var/log/web.stdout.log`). Obtain the last 100 lines by any appropriate method (e.g. `tail -n 100` or reading the file and taking the last 100 lines in code). On failure (missing file, permission denied, etc.), reply with a clear error message; no need to require a specific phrase like “Log file not found.”
- **Chunking:** Embed descriptions have a 4096-character limit. Split the log text into chunks of about 4000 characters to leave room for the code-block markers (triple backticks).
- **Embeds:** For each chunk:
  - Use `EmbedBuilder` from `discord.js`.
  - Set color with **`INFO_EMBED_COLOR`** imported from `src/messages/faqAndAliasHandler.js`.
  - Set description to the chunk wrapped in a code block, e.g. `` ```text\n${chunk}\n``` ``.
  - Set a title: e.g. “📋 System Logs (Last 100 Lines)” for the first embed and “📋 System Logs (Continued)” for the rest.
  - Set a footer, e.g. “Part X of Y”.
  - Call **`.setTimestamp()`** for consistency with other bot embeds.
- **Sending:** Send each embed with `message.channel.send({ embeds: [embed] })`, with error handling (e.g. `.catch`) so one failed send doesn’t break the rest.

## Key points (for Quality review)

- **Export name:** The handler must export **`handleGetLogs`** (not `handleLogs`), because `main.js` uses that name.
- **Import:** Use `INFO_EMBED_COLOR` from `faqAndAliasHandler.js`; that module exports it.
- **No strict “read file in JS” requirement:** Obtaining the last 100 lines via `tail` or via `fs` is acceptable as long as behavior and error handling are correct.
- **`.setTimestamp()`:** Include it on each embed so the implementation matches this spec and stays consistent with other info embeds.

---

## Summary for agent

In `src/messages/logHandler.js`:

1. Keep or add permission check (Moderators/Legend) at the top; reply with an error if unauthorized.
2. Resolve log path from `process.env.LOG_PATH` (with default); get last 100 lines (e.g. `tail -n 100` or `fs` + slice); on error, reply with a clear message.
3. Chunk the result into ~4000-character segments; for each chunk, build an `EmbedBuilder` with `INFO_EMBED_COLOR`, code-block description, title, footer “Part X of Y”, and `.setTimestamp()`; send with `message.channel.send({ embeds: [embed] })` and handle send errors.

No changes to `main.js` are required; it already routes `!logs` to `handleGetLogs`.
