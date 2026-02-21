# Code Structure Overview

## Directory Layout

```
navi_bot2/
├── main.js                          # Bot setup & handler imports (clean entry point)
├── src/
│   ├── admin/                       # Admin UI (Express routes, auth, prompts, data, agent/Missions)
│   ├── app.js                       # Express app (mounts admin, webhooks, static)
│   ├── shared/                      # S3, scheduler, messageSplitter, aliasSync, etc.
│   ├── export/                      # !export falco, !export matchups
│   ├── matchups/                    # characterAliases, matchupHandler (!mu, !mq)
│   ├── messages/                    # messageHandlers, questionHandler, faqAndAliasHandler, dmHandler
│   ├── stats/                       # statsHandler, frameDataHelper
│   └── tournaments/                 # dailyTournamentCheck, tournamentEmbed, addZeldaCommand, startggClient
├── scripts/                         # CLI tools (tournaments, Zelda list); not used at bot runtime
├── local_app_only/                  # Ad-hoc dev/test scripts; not a formal test suite
├── package.json
└── README.md
```

## Module Breakdown

### `main.js` (Entry Point)
- Express server setup
- Discord bot initialization
- Message event listeners that delegate to handlers
- No business logic - just routing

### `src/admin/`
Admin web UI (login, prompts, data CSV/framedata, aliases, emoji, cost, and the **Missions** agent pipeline). Mounted under `/admin` by `src/app.js`. Agent logic lives in `src/admin/agent/` (orchestrator, runStore, repoBrowser, prompts, PR creation).

### `src/shared/s3Helper.js`
**Exported Functions:**
- `uploadToS3()` - Upload JSON to S3
- `fetchFromS3()` - Fetch character data from S3
- `isModelOverloaded()` - Check for 500 errors
- `fetchAllMessages()` - Batch fetch Discord messages

### `src/export/exportHandler.js`
**Exported Functions:**
- `handleExportFalco()` - Export #falco channel
- `handleExportMatchups()` - Export all character channels to S3

### `src/matchups/characterAliases.js`
**Exports:**
- `nicknameAliases` - Map of nicknames → canonical names (palu → palutena, etc)
- `buildCharacterAliasMap()` - Build dynamic alias map from guild channels
- `resolveCharacterFromText()` - Parse user input to find character

### `src/matchups/matchupHandler.js`
**Exported Functions:**
- `handleMatchupNotes()` - !match-up-notes command with AI generation
- `handleMuQuestion()` - !mu-question command with character detection
- `handleRefinement()` - Reply refinement with multi-part message handling

### `src/messages/messageHandlers.js`
**Exports:**
- `followupResponses` - Array of creative "could" responses
- `lanWarningResponses` - Array of LAN warning messages
- `handleShouldHave()` - Detect "should have" and reply
- `handleArenaIsUp()` - Detect "arena is up/ready" from condymathceo

## Adding New Features

To add a new command/trigger:

1. **Create new handler file** in appropriate folder
   - E.g., `src/commands/newCommand.js` or `src/triggers/newTrigger.js`

2. **Export a handler function** with signature:
   ```javascript
   export async function handleNewFeature(message, ...otherArgs) {
       // logic here
       return wasHandled; // true/false
   }
   ```

3. **Import in main.js** and add to message listener
4. **Commit with clear module organization**

## Benefits of This Structure

✅ **Single Responsibility** - Each module has one clear purpose  
✅ **Easy to Locate Code** - Feature → specific file  
✅ **Maintainability** - Small files, easy to understand  
✅ **Reusability** - Helpers can be used by multiple handlers  
✅ **Testing** - Individual functions can be tested in isolation  
✅ **Scalability** - Easy to add new features without cluttering main.js
