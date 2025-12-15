# RealTime Tic‑Tac‑Toe

A real‑time multiplayer Tic‑Tac‑Toe web app built for classrooms and friendly competition.

- **Login:** Telegram Login Widget
- **Play:** Quick Matchmaking or Invite Links
- **Realtime:** Socket.IO authoritative gameplay (server validates moves)
- **Public leaderboard:** wins / draws / losses (persistent)
- **Stats:** total unique players (persistent)

This project is designed so **30+ students** can join, play, and see a shared leaderboard.


## How To Play

### 1) Login
Use the **Telegram Login** button. After login:

- Your name appears in the **Players** card.
- **Quick Play** and **Invite** buttons become enabled.

### 2) Quick Play (Matchmaking)
Click **Quick Play** to enter the queue.

- When two players are queued, the server creates a match.
- You are assigned a mark (**X** or **O**).
- The UI shows current turn + countdown.

### 3) Invite a Friend
Click **Create invite link**, then share the generated link.

The joiner can:

- paste the full link, or
- paste only the invite code

…into the **Join via invite** section.

### 4) Rules & Turn Timer

- Classic Tic‑Tac‑Toe rules.
- Each turn has a **30 second timer**.
- If a player times out, the server automatically passes the turn.

### 5) Public Leaderboard

The leaderboard is public and visible to everyone. It shows:

- Top players with wins / draws / losses
- **Total players** (unique logins seen by the server)

## Data & Persistence (Database)

This project persists stats using MongoDB:

- `players` collection: unique players and last seen time
- `leaderboard` collection: wins / draws / losses per player

MongoDB configuration (environment variables):

- `MONGODB_URI` (default: `mongodb://127.0.0.1:27017`)
- `MONGODB_DB_NAME` (default: `tictactoe`)

Important notes:

- The repository ignores `data/` (local persistent data).
- On many free hosting tiers (including some Render setups), filesystem storage can be **ephemeral** and may reset on redeploy/restart.
  - If you need “never reset” persistence in production, use a managed database (Postgres, MySQL) or a hosting plan with a persistent disk.

## Tech Stack

- **Runtime:** Node.js 20+
- **Server:** Express 5 + Socket.IO 4
- **Client:** Vanilla JS + CSS
- **Persistence:** MongoDB

## API (HTTP)

Public endpoints:

- `GET /api/leaderboard` → ordered leaderboard
- `GET /api/stats` → `{ totalPlayers }`

Auth endpoints:

- `GET /api/config` → Telegram bot username and canonical host
- `POST /api/auth/telegram` → verify Telegram login payload, returns session token

## Realtime (Socket Events)

Client → Server:

- `quickFind` `{ token }`
- `createInvite` `{ token }`
- `joinInvite` `{ token, code }`
- `playing` `{ token, id }`
- `gameOver` `{ token, result, winnerMark }`

Server → Client:

- `find` `{ allPlayers }`
- `playing` `{ allPlayers, timeout? }`
- `matchEnded` `{ players, result, winner }`
- `leaderboardUpdated` `{ leaderboard }`
- `inviteCreated` `{ code }`
- `inviteError` `{ message }`
- `authError` `{ message }`
- `invalidMove` `{ reason }`

## Getting Started (Local)

1. Install dependencies
   ```bash
   npm install
   ```

2. Create environment file
   ```bash
   cp .env.example .env
   ```

3. Run the backend (required)
   ```bash
   npm run server
   ```

4. Open the app
   - `http://localhost:3000`

## Environment Variables

| Key | What it does | Example |
|---|---|---|
| `PORT` | Server port | `3000` |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token (used to verify auth signature) | `12345:ABC...` |
| `TELEGRAM_BOT_USERNAME` | Telegram bot username (used by login widget) | `my_ttt_bot` |
| `APP_HOST` | Canonical host (redirect if mismatched) | `https://your-app.onrender.com` |
| `ALLOW_GUESTS` | Allow guest sessions if Telegram auth fails (dev only) | `true` |
| `MONGODB_URI` | MongoDB connection string | `mongodb://127.0.0.1:27017` |
| `MONGODB_DB_NAME` | MongoDB database name | `tictactoe` |

## Telegram Login Widget: “Bot domain invalid”

If Telegram shows a **bot domain** error, the bot is not permitted to authenticate on that site.

Fix:

1. Open `@BotFather`
2. Run `/setdomain`
3. Select your bot
4. Set the domain (no `https://`, no trailing `/`), e.g. `your-app.onrender.com`

## Deployment (Render)

- Service type: Node web service
- Build: `npm install`
- Start: `npm run start`
- Set env vars in Render dashboard (don’t commit secrets)

If you rely on a local MongoDB instance for persistence, confirm your hosting plan can reach it; otherwise use a managed MongoDB service.

## Security Note

Never commit `.env` (it contains your Telegram bot token). If you accidentally pushed it, rotate your bot token in BotFather.

## Project Structure

```
TicTacToe/
├── server/          # Backend (Express + Socket.IO)
│   ├── index.js
│   └── db.js        # MongoDB persistence (Mongoose)
├── index.html       # UI shell
├── script.js        # Client logic
├── style.css        # Styling
├── data/            # Local data (ignored by git)
└── docs/screenshots # README screenshots
```
