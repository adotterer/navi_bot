# Navi Bot 🧚

A Discord bot for the Zelda competitive community that exports match-up discussion data and generates AI-powered match-up guides.

## Features

- 📤 Export Discord messages from channels
- ☁️ Automatic S3 cloud storage integration
- 🤖 AI-powered match-up analysis using Google Gemini
- 🎮 Positive reinforcement for healthier language ("could" vs "should")

## Bot Commands

> Permissions: commands below require the **Moderators** or **Legend** role unless noted.

### `!export <character>`
Exports a single character matchup channel to S3 (supports nickname aliases).

**Usage:**
```
!export palu
!export palutena
!export peach
```

---

### `!export matchups`
Exports all character channels from both "Match Ups (B-L)" and "Match Ups (M-Z)" categories to S3.

**Usage:**
```
!export matchups
```

---

### `!mu-notes <character>` / `!mu <character>`
Generates an AI-powered match-up summary for a specific character using S3 messages.

**Usage:**
```
!mu-notes falco
!mu falco
!mu-notes mario
```

---

### `!mu-question <question>` / `!mu-q <question>`
Answers a specific matchup question using S3 messages for the detected character.

**Usage:**
```
!mu-question What should Zelda do versus Mario's fireball?
!mu-q What should Zelda do versus Mario's fireball?
```

---

### `!matches-today`
Checks today’s SSBU tournaments for tracked Zelda players and posts one message per tournament found.

---

### `!add-zelda <start.gg user URL or slug>`
Resolves a Start.gg profile to `playerId` and adds it to the Zelda list in S3.

**Usage:**
```
!add-zelda https://www.start.gg/user/302ae8f4
```

---

### `!list-zelda`
Lists all tracked Zelda players from S3.

---

### `!list-thread-counts`
Shows message counts for each matchup channel using the S3 JSON files.

---

### `!list-categories`
Lists server categories or channels inside a category.

**Usage:**
```
!list-categories
!list-categories Match Ups (B-L)
```

---

### `!should-have` Detection (Automatic)
The bot automatically replies to messages containing "should have" with a positive reinforcement message.

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
