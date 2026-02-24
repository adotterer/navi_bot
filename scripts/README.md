# Scripts (CLI / manual use)

Standalone scripts for tournament and Zelda-list maintenance. Not used by the bot at runtime. Run from project root, e.g. `node scripts/list_all_tournaments.js`.

| Script | Purpose |
|--------|---------|
| `upload-assets-to-s3.js [file ...] [--prefix stage-lists/]` | Upload files from ~/Downloads (or path) to S3; prints public URL(s). Uses `.env` AWS/S3 vars. |
| `list_all_tournaments.js` | List active SSBU tournaments (Start.gg). |
| `search_tournaments_today.js` | Search today’s tournaments with pagination. |
| `show_tournament_participants.js [slug]` | Show participants for a tournament by slug. |
| `addZeldaPlayer.js "Gamer Tag"` | Add a Zelda player by gamer tag (writes local `zelda_players.json`). |
| `findZeldaQuick.js` | Find Zelda players in today’s tournaments (uses local `zelda_players.json`). |

Requires `STARTGG_AUTH_TOKEN` in `.env` for Start.gg scripts. The Discord command `!add-zelda` uses S3 and `src/tournaments/addZeldaCommand.js`, not this script.
