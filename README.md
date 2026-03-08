# Navi Bot 🧚

A full-stack Discord bot for the Zelda competitive community: it exports matchup discussion data, powers AI-driven matchup guides and frame-data lookups, and runs an Express-based admin dashboard with **Missions**—a multi-agent pipeline that turns natural-language prompts into GitHub PRs.

---

## Overview

- **Discord bot:** Commands for exporting channels to S3, AI matchup summaries (`!mu`, `!mq`), frame data (`!fd`, `!fdq`), stats, stage bans (slash commands), tournament checks, and moderation helpers.
- **Express server:** Landing page, health check, admin dashboard (auth, prompts, data, aliases, emojis, commands), GitHub webhook, and proxy of S3-backed assets (e.g. frame data GIFs).
- **Missions (gen code):** In the admin UI, a “mission” prompt is turned into a **flight plan** by a Researcher agent, then implemented by Planner + Coder agents; results are validated and opened as a GitHub PR.

---

## Features

### Bot

- 📤 Export Discord channels (single character or all matchups) to S3
- ☁️ S3-backed storage for exports, prompts, stats, framedata, and character aliases
- 🤖 AI matchup analysis (Google Gemini) for `!mu` / `!mq` / `!q` / `!fdq` / `!sq`
- 🎮 Frame data lookup (`!fd`, `!stats` for moves) with self-hosted GIFs from S3
- 🏆 Tournament checks (Start.gg) for tracked Zelda players; scheduled once daily
- ⚔️ Stage ban flow: `/findmatch`, `/coinflip`, `/ban`, `/result`, `/end` with BO3/BO5
- 📝 Positive reinforcement triggers (e.g. “could” vs “should”) and docs/FAQ/aliases commands

### Express server

- **Public:** `/` (command list + status), `/health`, `/exports/<file>`, `/assets/*` (S3 proxy with long-lived cache), `/robots.txt`
- **Admin (session + optional 2FA):** Dashboard, prompts, stats/framedata CSVs, character aliases, emojis, command reference, cost view
- **Integrations:** GitHub webhook for deploy notifications to Discord
- **Security:** Helmet CSP, CSRF, rate limits on login/webhook, cookie-based session (file store)

### Missions (gen code)

- **Flow:** You submit a mission (e.g. “Add a !logs command that posts last 100 log lines as an embed”). A **Researcher** agent produces a structured flight plan (tasks + hints). **Planners** break tasks into steps; a **Coder** applies edits; a **Validator** checks satisfaction. On success, a **GitHub PR** is created from the mission branch.
- **Location:** `/admin/agent` in the admin UI. Optional: run without local git via `AGENT_NO_LOCAL_GIT=1` (branch/PR via GitHub API only).
- **Models:** Gemini and Claude models selectable in the UI; token usage and cost visible at `/admin/cost`.

---

## Architecture

| Component | Role |
|-----------|------|
| `main.js` | Entry point: Discord client + Express app (single process). |
| `server-admin.js` | Express-only entry point for local admin (no Discord token). |
| `src/app.js` | Express app factory: middleware, static, routes, `/assets` → S3 proxy. |
| `src/admin/*` | Admin routes (login, prompts, data, aliases, emojis, commands, agent, cost). |
| `src/admin/agent/` | Missions pipeline: researcher, planner, coder, validator, run store, GitHub PR. |

The same Express app is created by `createApp()` in `src/app.js` and mounted in both `main.js` and `server-admin.js`; admin routes are under `/admin` with session and CSRF.

---

## Tech stack

| Layer | Technologies |
|-------|---------------|
| **Runtime** | Node.js (ESM) |
| **Bot** | Discord.js |
| **Web** | Express, Helmet, express-session (session-file-store), cookie-parser, csrf-csrf, multer |
| **AI** | Google Generative AI (Gemini), Anthropic (Claude, for Missions) |
| **AWS** | S3 (exports, admin data, assets), DynamoDB (agent run metadata), SES (optional email) |
| **Missions** | @google/genai, @anthropic-ai/sdk, @octokit/rest, simple-git (optional) |
| **Scheduling** | node-cron (weekly export, daily tournament check, America/New_York) |
| **Front-end (admin)** | Tailwind CSS, vanilla JS, Chart.js (cost), Prism (code in agent UI) |

---

## Bot commands (summary)

> Most commands require **Moderators** or **Legend**; `!fd`, `!sl`, `!stats`, `!docs`, `!faq`, `!aliases`, `!canonical` are allowed in any channel.

| Command | Description |
|---------|-------------|
| `!export <character>` / `!export matchups` | Export channel(s) to S3. |
| `!mu <character>` / `!mu-notes` | AI matchup summary for a character. |
| `!mu-q <question>` / `!mq` | AI answer using matchup notes + frame data. |
| `!fd <character> <move>` | Frame data for a move (e.g. `!fd mario fair`). |
| `!fdq <question>` | AI frame-data question. |
| `!stats` / `!sq` | Stats lookup / stats question. |
| `!matches-today` | Today’s tournaments for tracked Zelda players. |
| `!add-zelda` / `!list-zelda` | Manage Zelda player list (Start.gg). |
| `!docs` / `!faq` / `!aliases` / `!canonical` | Docs, FAQ, alias list, canonical threads. |
| `/findmatch`, `/coinflip`, `/ban`, `/result`, `/end` | Stage ban matchmaking and flow. |

Full command list and permissions are documented in the admin UI at `/admin/commands` and in [COMMANDS_AND_PROMPTS.md](COMMANDS_AND_PROMPTS.md).

---

## Setup

### Environment variables

```env
# Required for bot + web
DISCORD_TOKEN=...
PORT=8080
APP_BASE_URL=https://your-domain.com   # for Discord embeds and asset URLs

# AWS (S3, optional DynamoDB/SES)
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-west-1
S3_BUCKET_NAME=...

# AI
GOOGLE_API_KEY=...                    # Gemini (bot + Missions)
GEMINI_MODEL=gemini-3-flash-preview    # or your preferred model
ANTHROPIC_SECRET=...                   # optional, for Claude in Missions

# Admin dashboard
SESSION_SECRET=...
ADMIN_USERNAME=...
ADMIN_PASSWORD=...
# Optional: 2FA (e.g. TOTP), SES for email

# Missions (optional)
GITHUB_TOKEN=...                       # for PR creation
GITHUB_REPO=owner/repo
# AGENT_NO_LOCAL_GIT=1                 # use GitHub API only (no local git)
```

### Local development

```bash
npm install
npm run dev          # Discord bot + Express (main.js)
```

### Admin only (Express, no Discord)

```bash
npm run admin        # Express on port 8081; open http://localhost:8081/admin
npm run dev:admin    # same with nodemon
```

Login with `ADMIN_USERNAME` / `ADMIN_PASSWORD`. Set AWS env vars if you want to save prompts/data/aliases to S3. Build admin CSS once (or when you change Tailwind): `npm run build:admin-css`.

### Deployment

- **Elastic Beanstalk:** `eb deploy` (or your preferred Node host). Ensure `PORT` and `APP_BASE_URL` are set in the environment.
- **Data:** Exports and admin data live in S3; local `data/` and `data/exports/` are used when S3 is unavailable or for initial seed.

---

## Data storage

- **Exports:** Uploaded to S3; also served via HTTP at `/exports/{character}.json` when the app has access to the exports directory.
- **Admin:** Prompts, stats CSVs, framedata CSVs, character aliases, and emoji library are stored in S3 (e.g. `admin/prompts/`, `admin/data/stats/`, `admin/character-aliases.json`). The bot reads from local files synced at startup or from S3 overrides.
- **Assets:** Images/GIFs (e.g. frame data) are in S3 under `assets/` and served by the app at `/assets/*` with long-lived cache headers.

---

## Documentation

- **[CODE_STRUCTURE.md](CODE_STRUCTURE.md)** – Module layout, entry points, and API/route table.
- **[COMMANDS_AND_PROMPTS.md](COMMANDS_AND_PROMPTS.md)** – Command behavior and prompt context.
- **[docs/gotchas.md](docs/gotchas.md)** – Pitfalls (e.g. script tags in templates) for contributors and agent runs.

---

## Notes

- The bot fetches messages in batches (e.g. 100) for large channels.
- AI answers are constrained to provided sources (matchup notes, frame data, stats); the bot does not fabricate data.
- Tournament check runs once daily at 2:00 PM America/New_York; results use a 12h cache to limit start.gg API usage.
- Stage ban and matchmaking logic live in `src/bans/` (coinflip, findmatch, ban, result, end).
