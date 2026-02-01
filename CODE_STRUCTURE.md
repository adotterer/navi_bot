# Code Structure Overview

## Directory Layout

```
navi_bot2/
├── main.js                          # Bot setup & handler imports (clean entry point)
├── src/
│   ├── shared/
│   │   └── s3Helper.js             # S3 operations, message fetching utilities
│   ├── export/
│   │   └── exportHandler.js        # !export falco, !export matchups commands
│   ├── matchups/
│   │   ├── characterAliases.js     # Nickname aliases, character resolution
│   │   └── matchupHandler.js       # !match-up-notes, !mu-question, refinement logic
│   └── messages/
│       └── messageHandlers.js      # "should have" trigger, arena LAN warning
├── package.json
└── README.md
```

## Module Breakdown

### `main.js` (Entry Point - ~75 lines)
- Express server setup
- Discord bot initialization
- Message event listeners that delegate to handlers
- No business logic - just routing

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
