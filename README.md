# Navi Bot 🧚

A Discord bot for the Zelda competitive community that exports match-up discussion data and generates AI-powered match-up guides.

## Features

- 📤 Export Discord messages from channels
- ☁️ Automatic S3 cloud storage integration
- 🤖 AI-powered match-up analysis using Google Gemini
- 🎮 Positive reinforcement for healthier language ("could" vs "should")

## Bot Commands

### `!export falco`
Exports all messages from the #falco channel to a JSON file.

**Usage:**
```
!export falco
```

**Output:** 
- Creates `falco_messages.json` locally
- Includes: author, authorId, content, timestamp, messageId

---

### `!export matchups`
Exports all character channels from both "Match Ups (B-L)" and "Match Ups (M-Z)" categories to individual JSON files and uploads them to AWS S3.

**Usage:**
```
!export matchups
```

**Features:**
- Automatically finds both category folders
- Creates individual JSON files for each character (e.g., `banjo-and-kazooie.json`, `mario.json`)
- Uploads all files to S3 bucket `navi-bot-exports`
- Returns a summary of all exported channels
- Approximately 50 character channels exported

**Output:**
- Individual `.json` files for each character
- S3 URLs for remote access via: `https://navi-bot-exports.s3.us-west-1.amazonaws.com/{character}.json`

---

### `!mu-notes <character>`
Generates an AI-powered match-up summary for a specific character using Google Gemini. Uses exported Discord messages as context.

**Usage:**
```
!mu-notes falco
!mu-notes mario
!mu-notes sheik
```

**Features:**
- Fetches character data from S3 bucket
- Prioritizes messages from `katyparry` (expert player)
- Generates structured summary with:
  - **🔎 Match Up Basics** - Key strategies, frame data, punish options, game plan
  - **🚨 Stage Bans** - Only if mentioned in messages (not fabricated)
- Handles long responses by splitting into multiple Discord messages
- Uses Google Gemini AI for analysis

**Example Output:**
```
🔎 | MATCH UP BASICS

- Falco's bread and butter, **uptilt**, is **-12 on shield** if he starts it from the *front*. WAIT FOR THE SECOND HIT, THEN PUNISH WITH FARORE'S WIND!!!

- **Farore's Wind's *first hit*** is the **easiest and most reliable way to punish ALL of Falco's moves** (besides down tilt & up air.)

- **Falco's down tilt is +11 frames on shield**, meaning we cannot do anything to punish it - PERIOD!

🚨 | STAGE BANS

- Yoshi's *[platform extensions, easy recovery]*
- Town & City *[platform extensions, higher ceiling advantage]*
```

---

### `!mu-question <question>`
Answers a specific matchup question using exported Discord messages for the detected character.

**Usage:**
```
!mu-question What should Zelda do versus Mario's fireball?
!mu-question How do I deal with Peach's turnips?
!mu-question How do I deal with Daisy's turnips?
```

**Features:**
- Detects character names in the question (supports nicknames like **palu** → palutena, **pika** → pikachu)
- Handles shared channels like **peach|daisy** automatically
- Fetches character data from S3 bucket
- Prioritizes messages from `katyparry` (expert player)
- If the question isn't covered in the messages, it says so

---

### `!should-have` Detection (Automatic)
The bot automatically responds to messages containing "should have" with a positive reinforcement message suggesting "could have" instead.

**Triggers:**
- "I should have"
- "you should have"
- "he/she/they/we should have"
- Just "should have" anywhere in the message

**Response Example:**
```
<:6symbolnavi:1341400385709019138> Hey Listen @user! Remember to say, you *could* have [action]! 
[Random supportive or Zelda-themed message] <:6symbolnavi:1341400385709019138>
```

**Features:**
- 10+ creative responses including Zelda references
- Does NOT trigger in #real-talk channel
- Encourages growth mindset over regret

---

## Setup Requirements

### Environment Variables
Add these to your `.env` file:

```env
DISCORD_TOKEN=your-discord-token-here
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
AWS_REGION=us-west-1
S3_BUCKET_NAME=navi-bot-exports
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-3-flash-preview
PORT=8080
```

### AWS Setup
1. Create an S3 bucket named `navi-bot-exports`
2. Create an IAM user with S3 permissions
3. Generate access keys and add to `.env`

### Google Gemini Setup
1. Get API key from [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Add to `GEMINI_API_KEY` in `.env`

---

## Installation & Deployment

### Local Development
```bash
npm install
npm run dev
```

### Elastic Beanstalk Deployment
```bash
git add .
git commit -m "Your message"
git push
eb deploy
```

---

## Data Storage

- **Local:** JSON files saved to bot directory and served via HTTP at `/exports/`
- **Cloud:** Files automatically uploaded to S3 for persistent storage
- **Access:** 
  - Local: `http://navi-bot-env-1.eba-am3kgn7j.us-west-1.elasticbeanstalk.com/exports/{character}.json`
  - S3: `https://navi-bot-exports.s3.us-west-1.amazonaws.com/{character}.json`

---

## Tech Stack

- **Discord.js** - Discord bot framework
- **Express.js** - HTTP server for file serving
- **AWS SDK** - S3 integration
- **Google Generative AI** - Match-up analysis
- **Node.js** - Runtime

---

## Notes

- Messages are fetched in batches of 100 to handle large channels
- Exported messages are sorted chronologically (oldest to newest)
- AI analysis only uses actual message content (no fabricated information)
- Stage Bans section only appears if specifically discussed in messages
