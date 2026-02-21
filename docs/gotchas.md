# Developer gotchas

Known pitfalls and fixes so future edits (including agent runs) don’t reintroduce bugs.

---

## HTML `<script>` closing tag in template literals

**Where it bites:** Admin UI and any Node code that builds HTML strings (e.g. for `res.send()`) that include `<script>...</script>` inside a JavaScript **template literal**.

**Problem:** In a `.js` file, a literal `</script>` inside a template string can be interpreted as closing the *file’s* script block. Escaping it as `<\\/script>` or `<\/script>` puts a **backslash** into the HTML sent to the browser. The browser only ends a script when it sees the exact sequence `</script>`, so the first script never closes, the rest of the page is parsed as script, and layout/behavior break (e.g. Prism syntax highlighting fails).

**Fix:** Never emit the closing tag from the template literal directly. Use a variable or concatenation so the response body contains the exact characters `</script>`:

```javascript
const S = '</script>';
// Then in the template:
`<script src="..."></script>${S}
...
<script>...</script>${S}`
```

**Reference:** `src/admin/agent/agentPageContent.js` uses this pattern (e.g. `PRISM_TAIL`, variable `S`) for Prism CSS/JS injection.

---

*(Add more gotchas here as they’re discovered.)*
