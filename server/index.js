import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { openPersistentDb } from './db.js';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

let db;
try {
    db = await openPersistentDb({
        mongoUri: process.env.MONGODB_URI,
        dbName: process.env.MONGODB_DB_NAME
    });
    console.log('[startup] MongoDB connected', {
        dbName: process.env.MONGODB_DB_NAME || 'tictactoe'
    });
} catch (err){
    console.error('[startup] Failed to connect to MongoDB. Set MONGODB_URI/MONGODB_DB_NAME and ensure MongoDB is running.', err);
    process.exit(1);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.set('etag', false);

app.use(express.json());
const noStore = (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    next();
};
app.use('/api', noStore);

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || '';
const ALLOW_GUESTS = String(process.env.ALLOW_GUESTS || '').toLowerCase() === 'true';

const waitingQueue = [];
const pendingInvites = new Map(); // code -> {user}
const playingArray = [];
const leaderboard = new Map(); // userId -> stats

// Hydrate leaderboard from persistent storage
(await db.loadLeaderboard()).forEach((entry) => {
    leaderboard.set(String(entry.id), entry);
});

const getOrderedLeaderboard = () => {
    return Array.from(leaderboard.values()).sort((a, b) => {
        if(b.wins !== a.wins) return b.wins - a.wins;
        if(b.draws !== a.draws) return b.draws - a.draws;
        return a.losses - b.losses;
    });
};

const broadcastStats = async () => {
    try {
        const totalPlayers = await db.getTotalPlayers();
        io.emit('statsUpdated', { totalPlayers });
    } catch (err){
        console.error('[db] statsUpdated broadcast failed', err);
    }
};

const hashSecret = TELEGRAM_BOT_TOKEN
  ? crypto.createHash('sha256').update(TELEGRAM_BOT_TOKEN).digest()
  : null;

const safeDisplayName = (user) => {
    if(!user){
        return 'unknown';
    }
    return user.username || user.first_name || `tg-${user.id}`;
};

const verifyTelegramAuth = (payload = {}) => {
    if(!hashSecret){
        return { valid: false, reason: 'missingSecret' };
    }
    const { hash, ...rest } = payload;
    const checkString = Object.keys(rest)
        .sort()
        .map((key) => `${key}=${rest[key]}`)
        .join('\n');

    const hmac = crypto
        .createHmac('sha256', hashSecret)
        .update(checkString)
        .digest('hex');

    return { valid: hmac === hash, reason: hmac === hash ? null : 'badSignature', computed: hmac, provided: hash };
};

const SESSION_SECRET = String(process.env.SESSION_SECRET || TELEGRAM_BOT_TOKEN || '').trim();
if(!SESSION_SECRET){
    console.warn('[startup] SESSION_SECRET is not set; generating an ephemeral secret (logins will NOT survive server restarts).');
}
const effectiveSessionSecret = SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const mintAuthToken = (user) => {
    // Keep payload minimal; Telegram auth has already been validated at issuance.
    const payload = {
        id: String(user.id),
        username: user.username || null,
        first_name: user.first_name || null,
        photo_url: user.photo_url || null
    };
    return jwt.sign(payload, effectiveSessionSecret, { expiresIn: '30d' });
};

const requireUserFromToken = (token) => {
    if(!token){
        return null;
    }
    try {
        const decoded = jwt.verify(String(token), effectiveSessionSecret);
        if(!decoded || !decoded.id){
            return null;
        }
        return {
            id: String(decoded.id),
            username: decoded.username || null,
            first_name: decoded.first_name || null,
            photo_url: decoded.photo_url || null
        };
    } catch {
        return null;
    }
};

const updateLeaderboard = (match, result, winnerMark) => {
    if(!match){
        return;
    }
    const ensureEntry = (player, isWinner, isDraw) => {
        if(!player){
            return;
        }
        const key = String(player.id);
        const existing = leaderboard.get(key) || { id: player.id, name: player.name, wins: 0, losses: 0, draws: 0 };
        if(isDraw){
            existing.draws += 1;
        } else if(isWinner){
            existing.wins += 1;
        } else {
            existing.losses += 1;
        }
        existing.name = player.name;
        leaderboard.set(key, existing);

        // Persist immediately
        void db.upsertLeaderboardEntry(existing).catch((err) => {
            console.error('[db] upsert leaderboard failed', err);
        });
    };

    if(result === 'draw'){
        ensureEntry(match.p1, false, true);
        ensureEntry(match.p2, false, true);
    } else if(result === 'win'){
        const winner = winnerMark === 'X' ? match.p1 : match.p2;
        const loser = winnerMark === 'X' ? match.p2 : match.p1;
        ensureEntry(winner, true, false);
        ensureEntry(loser, false, false);
    }
};

io.on('connection', (socket) => {
    // Push current state to newly connected clients
    socket.emit('leaderboardUpdated', { leaderboard: getOrderedLeaderboard() });
    void (async () => {
        try {
            const totalPlayers = await db.getTotalPlayers();
            socket.emit('statsUpdated', { totalPlayers });
        } catch (err){
            console.error('[db] stats snapshot failed', err);
        }
    })();

    socket.on('quickFind', ({ token }) => {
        const user = requireUserFromToken(token);
        if(!user){
            socket.emit('authError', { message: 'Unauthorized' });
            return;
        }

        // Prevent duplicate queue entries for the same user
        const alreadyQueued = waitingQueue.some(p => p.id === user.id);
        if(!alreadyQueued){
            waitingQueue.push({ id: user.id, name: safeDisplayName(user), token });
        }

        if(waitingQueue.length >= 2){
            const p1 = waitingQueue.shift();
            const p2 = waitingQueue.shift();

            const match = {
                p1: { id: p1.id, name: p1.name, value: 'X', move: '' },
                p2: { id: p2.id, name: p2.name, value: 'O', move: '' },
                sum: 1,
                board: {},
                turnDeadline: Date.now() + 30000,
                matchFinished: false,
                timedOutPlayer: null,
                timedOutMark: null,
                currentTurn: 'X'
            };

            playingArray.push(match);
            io.emit('find', { allPlayers: playingArray });
        }
    });

    socket.on('createInvite', ({ token }) => {
        const user = requireUserFromToken(token);
        if(!user){
            socket.emit('authError', { message: 'Unauthorized' });
            return;
        }
        // One invite per user; replace existing
        for (const [code, entry] of pendingInvites.entries()){
            if(entry.user.id === user.id){
                pendingInvites.delete(code);
                break;
            }
        }
        const code = crypto.randomBytes(6).toString('hex');
        pendingInvites.set(code, { user });
        socket.emit('inviteCreated', { code });
    });

    socket.on('joinInvite', ({ token, code }) => {
        const user = requireUserFromToken(token);
        if(!user || !code){
            socket.emit('authError', { message: 'Unauthorized' });
            return;
        }
        const host = pendingInvites.get(code);
        if(!host){
            socket.emit('inviteError', { message: 'Invite not found or already used.' });
            return;
        }
        if(host.user.id === user.id){
            socket.emit('inviteError', { message: 'Cannot join your own invite.' });
            return;
        }

        pendingInvites.delete(code);

        const match = {
            p1: { id: host.user.id, name: safeDisplayName(host.user), value: 'X', move: '' },
            p2: { id: user.id, name: safeDisplayName(user), value: 'O', move: '' },
            sum: 1,
            board: {},
            turnDeadline: Date.now() + 30000,
            matchFinished: false,
            timedOutPlayer: null,
            timedOutMark: null,
            currentTurn: 'X'
        };

        playingArray.push(match);
        io.emit('find', { allPlayers: playingArray });
    });

    socket.on('playing', ({ id, token }) => {
        if(!id || !token){
            return;
        }

        const user = requireUserFromToken(token);
        if(!user){
            socket.emit('authError', { message: 'Unauthorized' });
            return;
        }

        const match = playingArray.find(obj => obj.p1?.id === user.id || obj.p2?.id === user.id);
        if(!match || match.matchFinished){
            return;
        }

        const playerMark = match.p1?.id === user.id ? 'X' : 'O';
        const expectedTurn = (match.sum % 2 !== 0) ? 'X' : 'O';
        if(playerMark !== expectedTurn){
            socket.emit('invalidMove', { reason: 'notYourTurn' });
            return;
        }

        match.board = match.board || {};
        if(match.board[id]){
            socket.emit('invalidMove', { reason: 'occupied' });
            return;
        }

        match.board[id] = playerMark;

        if(playerMark === 'X'){
            match.p1.move = id;
        } else {
            match.p2.move = id;
        }

        match.sum = typeof match.sum === 'number' ? match.sum + 1 : 2;
        match.turnDeadline = Date.now() + 30000;
        match.timedOutPlayer = null;
        match.timedOutMark = null;
        match.currentTurn = playerMark === 'X' ? 'O' : 'X';

        io.emit('playing', { allPlayers: playingArray });
    });

    socket.on('gameOver', ({ token, result, winnerMark }) => {
        const user = requireUserFromToken(token);
        if(!user){
            socket.emit('authError', { message: 'Unauthorized' });
            return;
        }

        const matchIndex = playingArray.findIndex(obj => obj.p1?.id === user.id || obj.p2?.id === user.id);
        if(matchIndex === -1){
            return;
        }

        const match = playingArray[matchIndex];
        match.matchFinished = true;
        match.turnDeadline = null;
        match.timedOutPlayer = null;
        match.timedOutMark = null;
        match.currentTurn = null;

        const [finishedMatch] = playingArray.splice(matchIndex, 1);
        const players = [finishedMatch?.p1?.name, finishedMatch?.p2?.name].filter(Boolean);

        updateLeaderboard(finishedMatch, result || 'win', winnerMark);
        io.emit('leaderboardUpdated', { leaderboard: getOrderedLeaderboard() });

        const winnerName = winnerMark === 'X' ? finishedMatch?.p1?.name : finishedMatch?.p2?.name;
        io.emit('matchEnded', {
            players,
            result: result || 'win',
            winner: winnerName || winnerMark || null
        });
    });
});

setInterval(() => {
    const now = Date.now();
    let updated = false;

    playingArray.forEach(match => {
        if(match.matchFinished){
            return;
        }
        if(match.turnDeadline && match.turnDeadline < now){
            const timedOutMark = (match.sum % 2 !== 0) ? 'X' : 'O';
            const timedOutPlayer = timedOutMark === 'X' ? match.p1?.name : match.p2?.name;

            match.sum = typeof match.sum === 'number' ? match.sum + 1 : 2;
            match.turnDeadline = Date.now() + 30000;
            match.timedOutPlayer = timedOutPlayer;
            match.timedOutMark = timedOutMark;
            match.currentTurn = timedOutMark === 'X' ? 'O' : 'X';
            updated = true;
        }
    });

    if(updated){
        io.emit('playing', { allPlayers: playingArray, timeout: true });
    }
}, 1500);

// Serve the frontend/static assets from the project root
app.use(express.static(PROJECT_ROOT));

app.get('/api/config', (_req, res) => {
    res.json({
        telegramBotUsername: TELEGRAM_BOT_USERNAME || null,
        appHost: process.env.APP_HOST || null
    });
});

app.post('/api/auth/telegram', (req, res) => {
    const payload = req.body || {};
    const validation = hashSecret ? verifyTelegramAuth(payload) : { valid: false, reason: 'missingSecret' };

    if(!validation.valid){
        if(!ALLOW_GUESTS){
            return res.status(401).json({
                ok: false,
                error: 'Telegram auth verification failed. Check TELEGRAM_BOT_TOKEN/TELEGRAM_BOT_USERNAME and ensure you are running the Express server (node index.js), not only Vite.',
                reason: validation.reason
            });
        }
        const guestId = `guest-${crypto.randomBytes(8).toString('hex')}`;
        const guestName = payload.username || payload.first_name || `guest-${guestId.slice(6, 12)}`;
        const guestUser = {
            id: guestId,
            username: guestName,
            first_name: guestName,
            last_name: null,
            photo_url: null,
            auth_date: Date.now()
        };
        const token = mintAuthToken(guestUser);
        const guestDisplayName = safeDisplayName(guestUser);
        (async () => {
            try {
                await db.upsertPlayer({ id: guestUser.id, name: guestDisplayName });
                if(!leaderboard.has(String(guestUser.id))){
                    const entry = { id: guestUser.id, name: guestDisplayName, wins: 0, losses: 0, draws: 0 };
                    leaderboard.set(String(guestUser.id), entry);
                    await db.upsertLeaderboardEntry(entry);
                    io.emit('leaderboardUpdated', { leaderboard: getOrderedLeaderboard() });
                }
                await broadcastStats();
            } catch (err){
                console.error('[db] guest upsert/broadcast failed', err);
            }
        })();
        console.warn('Telegram auth invalid; issuing guest session', { validation, payloadPreview: { id: payload.id, username: payload.username, first_name: payload.first_name, last_name: payload.last_name } });
        return res.json({ ok: true, guest: true, token, user: { id: guestUser.id, username: guestUser.username, first_name: guestUser.first_name, photo_url: guestUser.photo_url } });
    }

    const user = {
        id: payload.id,
        username: payload.username,
        first_name: payload.first_name,
        last_name: payload.last_name,
        photo_url: payload.photo_url,
        auth_date: payload.auth_date
    };

    const token = mintAuthToken(user);
    const displayName = safeDisplayName(user);
    (async () => {
        try {
            await db.upsertPlayer({ id: user.id, name: displayName });
            if(!leaderboard.has(String(user.id))){
                const entry = { id: user.id, name: displayName, wins: 0, losses: 0, draws: 0 };
                leaderboard.set(String(user.id), entry);
                await db.upsertLeaderboardEntry(entry);
                io.emit('leaderboardUpdated', { leaderboard: getOrderedLeaderboard() });
            }
            await broadcastStats();
        } catch (err){
            console.error('[db] upsert/broadcast failed', err);
        }
    })();
    res.json({ ok: true, token, user: { id: user.id, username: user.username, first_name: user.first_name, photo_url: user.photo_url } });
});

// Public stats for "how many players have joined"
app.get('/api/stats', async (_req, res) => {
    try {
        const totalPlayers = await db.getTotalPlayers();
        res.json({ ok: true, totalPlayers });
    } catch (err){
        console.error('[db] stats failed', err);
        res.status(500).json({ ok: false, error: 'Failed to load stats' });
    }
});

app.get('/api/leaderboard', (_req, res) => {
    res.json({ ok: true, leaderboard: getOrderedLeaderboard() });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(PROJECT_ROOT, 'index.html'));
});

const PORT = Number(process.env.PORT) || 3000;

server.on('error', (err) => {
    if(err && err.code === 'EADDRINUSE'){
        console.error(`[startup] Port ${PORT} is already in use. Stop the other process or set PORT to a free value in .env.`);
        process.exit(1);
    }
    console.error('[startup] Server error', err);
    process.exit(1);
});

server.listen(PORT, () => {
    console.log(`[startup] Server is running on http://localhost:${PORT}`);
});

