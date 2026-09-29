# Navi 🧚

**Live: [navi.adotterer.com](https://navi.adotterer.com)**

A web app that turns years of a Super Smash Bros. Ultimate Discord community's matchup discussion into AI-generated, cached matchup guides — with Discord OAuth2 for access control instead of a separate account system, and a deploy pipeline built around actually needing to run on a $5/month box.

This started as an always-on Discord bot on Elastic Beanstalk. EB auto-provisions a load balancer and NAT Gateway, which billed 24/7 for a side project with well under 20 active users — so the bot was rebuilt as a small on-demand web app instead, and the always-on infrastructure was retired entirely. That rewrite is the current, actively maintained part of this repo; the original bot's commands are parked (not deleted) and documented separately below.

---

## What it does

- **`/zelda/<character>`** — a cached, AI-generated summary of the Zelda-vs-`<character>` matchup, sourced from the Discord community's own discussion in that character's thread.
- **No AI call on page view.** Every page renders whatever was last saved. Anyone with the Coaching Pass role can click **"Fetch latest & regenerate"** to pull fresh Discord messages and re-run the summary — the only time an AI call or a Discord fetch happens is on that explicit click.
- **Discord OAuth2 for access, not a login system.** Visiting a guide, and clicking "Fetch latest & regenerate", both require signing in with Discord; the app checks (via the bot's own token, live, at login time) whether that account holds a paid **"Coaching Pass"** role in the server. Every login and every guide view/regenerate is posted to the server's `#audit-logs` channel — who accessed what, and when.
- A gated **demo-access code** bypasses Discord OAuth entirely for portfolio/interview review — same access level as a real login, without needing a Discord account with the right role.

---

## Why this is interesting from an infra standpoint

- **No persistent Discord connection in production.** Discord message history and role membership don't require a Gateway/websocket session — they're plain REST calls (`GET /channels/{id}/messages`, `GET /guilds/{id}/members/{id}`) authenticated with the bot token. `server.js`, the production entry point, never calls `client.login()`.
- **One tiny box, not serverless, and not EB.** A $5/month AWS Lightsail instance (512MB, no load balancer, no NAT Gateway) runs the whole thing under `pm2`, behind `Caddy` for automatic Let's Encrypt HTTPS. Chosen over serverless specifically because the app needs a stateful session (Discord OAuth + role cache) and running that behind Lambda@Edge/Cognito would've been more infra for less benefit at this scale.
- **Push-to-deploy via SSH, not an API-based deploy.** GitHub Actions SSHes into the box and does `git fetch` + hard reset + `npm ci --omit=dev` + `pm2 restart` — found and fixed a real production bug this way: `npm ci` OOM-killed itself on the 512MB box (zero swap by default on a fresh Lightsail image), corrupting `node_modules` mid-deploy. Fixed with a 1GB swap file, persisted in `/etc/fstab`.
- **Generated content is cached in S3**, the same pattern already used for prompts/aliases/stats in the original bot — no database, one storage layer for everything regeneratable.

---

## Architecture

| Component | Role |
|-----------|------|
| `server.js` | **Production entry point.** Express-only, no Discord Client/Gateway ever instantiated. |
| `src/app.js` | Express app factory: middleware, static assets, mounts `/zelda` and `/admin`. |
| `src/zelda/` | Routes, S3-backed guide cache, Gemini-output-to-HTML renderer, slug handling. |
| `src/shared/discordRest.js` | Stateless bot-token REST helpers (channels, roles, member lookup, message history). |
| `src/shared/discordOAuth.js` | User-facing Discord OAuth2 login (`identify` scope only). |
| `src/shared/siteAuth.js` | Session gate: Coaching Pass role required to view and regenerate. |
| `main.js` | **Legacy.** The original always-on Discord bot (Gateway client + slash commands) — parked, not deleted. |
| `server-admin.js` | Express-only entry point for local admin-panel testing (no Discord token). |
| `src/admin/*` | Admin dashboard: login, prompts, data, aliases, emojis, commands, Missions, cost. |

`createApp()` in `src/app.js` is shared by `server.js`, `main.js`, and `server-admin.js` — same middleware, same `/admin` panel, regardless of which entry point is running.

---

## Tech stack

| Layer | Technologies |
|-------|---------------|
| **Runtime** | Node.js (ESM) |
| **Web** | Express, Helmet, express-session (file store), cookie-parser |
| **Auth** | Discord OAuth2 (`identify`), live role verification via bot token REST calls |
| **AI** | Google Gemini (`@google/genai`) |
| **AWS** | S3 (guide cache, exports, prompts, aliases), DynamoDB (optional multi-admin), SES (optional 2FA email) |
| **Infra** | AWS Lightsail ($5/mo, 512MB + 1GB swap), Caddy (automatic HTTPS), pm2 (process supervision) |
| **CI/CD** | GitHub Actions → SSH deploy (`appleboy/ssh-action`) |
| **Legacy bot** | Discord.js (Gateway client, slash commands, stage-ban flow) |

---

## Setup

### Environment variables

```env
# Discord (REST-only in production; same token used for the legacy Gateway bot if revived)
DISCORD_TOKEN=...
GUILD_ID=...
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_OAUTH_REDIRECT_URI=https://your-domain.com/zelda/oauth/callback
COACHING_PASS_ROLE_NAME=Coaching Pass
RECRUITER_PASSWORD=...            # demo-access bypass; keep this out of git, share it directly

# AWS
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-west-1
S3_BUCKET_NAME=...

# AI
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3-flash-preview

# Web
PORT=8080
NODE_ENV=production
SESSION_SECRET=...

# Admin dashboard (legacy features live here too)
ADMIN_USERNAME=...
ADMIN_PASSWORD=...
```

### Local development

```bash
npm install
npm run admin        # Express only, port 8081 — no Discord token needed, safest for local dev
node server.js        # Full production entry point (needs DISCORD_TOKEN + GEMINI_API_KEY for /zelda)
```

Build admin CSS once (or whenever Tailwind classes change), then commit the output — the deploy pipeline doesn't rebuild it (Tailwind's a devDependency, not installed in production):

```bash
npm run build:admin-css
```

### Deployment

Push to `main` — GitHub Actions SSHes into the Lightsail box and runs `git fetch` + `git reset --hard origin/main` + `npm ci --omit=dev` + `pm2 restart navi-web`. See `.github/workflows/deploy.yml`.

---

## Legacy: the original Discord bot

Before the rewrite, this was an always-on Discord bot: AI matchup summaries and frame-data lookups triggered by typing commands directly in Discord, plus a stage-ban matchmaking flow, tournament tracking, and an admin dashboard with **Missions** (a multi-agent pipeline that turns natural-language prompts into GitHub PRs). None of it was deleted — `main.js` still runs the full Gateway-connected bot if started directly, it's just not part of the production deploy anymore.

- 📤 Export Discord channels (single character or all matchups) to S3
- 🤖 AI matchup analysis (`!mu` / `!mq` / `!q` / `!fdq` / `!sq`) — the same Gemini prompt the new `/zelda/<character>` pages now use
- 🎮 Frame data lookup (`!fd`, `!stats`) with self-hosted GIFs from S3
- 🏆 Daily tournament checks (Start.gg) for tracked players
- ⚔️ Stage ban flow: `/findmatch`, `/coinflip`, `/ban`, `/result`, `/end` (BO3/BO5)
- 🧠 **Missions:** natural-language prompt → Researcher/Planner/Coder/Validator agent pipeline → GitHub PR, in the admin UI at `/admin/agent`

Full command list and permissions: `/legacy` on the live site, `/admin/commands` in the admin UI, and [COMMANDS_AND_PROMPTS.md](COMMANDS_AND_PROMPTS.md). Module layout: [CODE_STRUCTURE.md](CODE_STRUCTURE.md). Known pitfalls: [docs/gotchas.md](docs/gotchas.md).

To run the legacy bot locally: `npm run dev` (nodemon + `main.js`, needs `DISCORD_TOKEN`).
