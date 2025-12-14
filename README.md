# RealTime Tic-Tac-Toe

A real-time multiplayer Tic-Tac-Toe experience built with Node.js, Express, and Socket.IO. The app pairs two players, assigns marks, enforces alternating turns with a 30-second timer, and announces wins or draws through a custom modal UI. Players authenticate via Telegram before joining a match, and results feed into a live leaderboard.

## Features
- **Telegram login** – players must authenticate with their Telegram account via the Telegram Login Widget.
- **Realtime matchmaking** – players search for opponents and are paired automatically once logged in.
- **Authoritative server** – Express + Socket.IO backend validates every move and broadcasts the canonical board state.
- **Turn timer** – each player has 30 seconds; timeouts automatically pass the turn to keep matches moving.
- **Leaderboard** – wins/losses/draws are tracked server-side and broadcast live.
- **Responsive UI** – clean layout, glowing tiles, and modal alerts for results or validation errors.
- **Environment-ready** – configurable `PORT`, supports deployment to platforms such as Render.

## Tech Stack
- **Runtime:** Node.js 20+
- **Server:** Express 5, Socket.IO 4
- **Frontend tooling:** Vite 7, vanilla JavaScript, CSS3
- **Styling assets:** custom `style.css`, loading animation (`loading.gif`)

### npm Packages
| Package     | Purpose                             |
|-------------|-------------------------------------|
| `express`   | HTTP server + static file hosting   |
| `socket.io` | Real-time transport between players |
| `dotenv`    | Loads environment variables         |
| `http`      | Explicit dependency for Node server |
| `nodemon`   | Local autoreload during development |
| `vite`      | Bundler/dev server for the client   |

## Getting Started
1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Create your env file**
   ```bash
   cp .env.example .env
   # set TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_USERNAME
   ```
3. **Start the dev experience**
   - Client-only preview with hot reload:
     ```bash
     npm run dev
     ```
   - Full stack (Express + Socket.IO):
     ```bash
     node index.js
     # or add "start": "node index.js" to package.json and run npm start
     ```
4. Open `http://localhost:3000` (or your configured port) in two browser tabs to test matchmaking.

### Available Scripts
| Command        | Description                           |
|----------------|---------------------------------------|
| `npm run dev`  | Launches the Vite dev server          |
| `npm run build`| Builds static assets with Vite        |
| `npm run preview` | Serves the Vite build output locally |
| `node index.js`| Runs the Express + Socket.IO server   |

## Environment Variables
| Key                   | Description                                   | Default |
|-----------------------|-----------------------------------------------|---------|
| `PORT`                | Port used by Express server                   | `3000`  |
| `TELEGRAM_BOT_TOKEN`  | Bot token used to verify Telegram login hash  | _none_  |
| `TELEGRAM_BOT_USERNAME` | Bot username used by the Telegram widget    | _none_  |
| `ALLOW_GUESTS`        | Allow guest sessions if Telegram auth fails   | `false` |
| `APP_HOST`            | Canonical host (used to redirect if mismatched) | _none_ |

## Telegram Login Widget: “Bot domain invalid”
If the widget shows a **bot domain** error, Telegram is blocking login because the bot isn’t allowed to authenticate on the domain you’re visiting.

- In Telegram, open `@BotFather` → `/setdomain` → select your bot → set the domain to your site host (no protocol), e.g. `realtime-tictactoe-0f8i.onrender.com`.
- The page must be served from that exact host (typically HTTPS). `file:///...` won’t work.
- For local development, Telegram login often won’t work on `localhost`. Use a public HTTPS URL (Render) or a tunnel, or set `ALLOW_GUESTS=true` to test gameplay without Telegram.

## Deployment Notes
- Push the repository to GitHub so Render (or similar) can pull from `main`.
- Configure the service as a **Node** web service.
- Build command: `npm install; npm run build`
- Start command: `node index.js`
- Add the `PORT` env variable in the Render dashboard (or upload `.env`).

## Project Structure
```
TicTacToe/
├── index.html      # UI shell and modal markup
├── script.js       # Client-side gameplay + socket handlers
├── style.css       # Responsive styling and animations
├── index.js        # Express + Socket.IO server
├── .env            # Local environment config (PORT)
├── package.json    # Scripts and dependencies
└── src/            # Reserved for Vite (currently empty)
```

Feel free to extend the experience with player authentication, leaderboards, or persistent lobbies!
