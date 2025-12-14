import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ensureDir = (dirPath) => {
    if(!fs.existsSync(dirPath)){
        fs.mkdirSync(dirPath, { recursive: true });
    }
};

export async function openPersistentDb({ dbFilePath }){
    const wasmPath = path.join(__dirname, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
    const SQL = await initSqlJs({
        locateFile: (file) => {
            if(file === 'sql-wasm.wasm'){
                return wasmPath;
            }
            return file;
        }
    });

    ensureDir(path.dirname(dbFilePath));

    const loadBytes = () => {
        try {
            if(fs.existsSync(dbFilePath)){
                return new Uint8Array(fs.readFileSync(dbFilePath));
            }
        } catch {
            // ignore
        }
        return null;
    };

    const database = new SQL.Database(loadBytes() || undefined);

    database.run(`
        PRAGMA journal_mode = OFF;
        PRAGMA synchronous = NORMAL;
        CREATE TABLE IF NOT EXISTS players (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            first_seen INTEGER NOT NULL,
            last_seen INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS leaderboard (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            wins INTEGER NOT NULL DEFAULT 0,
            losses INTEGER NOT NULL DEFAULT 0,
            draws INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL
        );
    `);

    let flushTimer = null;
    let dirty = false;

    const flushNow = () => {
        if(!dirty){
            return;
        }
        dirty = false;
        const bytes = database.export();
        fs.writeFileSync(dbFilePath, Buffer.from(bytes));
    };

    const scheduleFlush = () => {
        dirty = true;
        if(flushTimer){
            return;
        }
        flushTimer = setTimeout(() => {
            flushTimer = null;
            try {
                flushNow();
            } catch (err){
                console.error('[db] flush failed', err);
            }
        }, 300);
    };

    const upsertPlayer = ({ id, name }) => {
        if(!id || !name){
            return;
        }
        const now = Date.now();
        const stmt = database.prepare(`
            INSERT INTO players (id, name, first_seen, last_seen)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                last_seen = excluded.last_seen
        `);
        try {
            stmt.run([String(id), String(name), now, now]);
        } finally {
            stmt.free();
        }
        scheduleFlush();
    };

    const upsertLeaderboardEntry = ({ id, name, wins, losses, draws }) => {
        if(!id || !name){
            return;
        }
        const now = Date.now();
        const stmt = database.prepare(`
            INSERT INTO leaderboard (id, name, wins, losses, draws, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                wins = excluded.wins,
                losses = excluded.losses,
                draws = excluded.draws,
                updated_at = excluded.updated_at
        `);
        try {
            stmt.run([
                String(id),
                String(name),
                Number(wins) || 0,
                Number(losses) || 0,
                Number(draws) || 0,
                now
            ]);
        } finally {
            stmt.free();
        }
        scheduleFlush();
    };

    const loadLeaderboard = () => {
        const entries = [];
        const stmt = database.prepare('SELECT id, name, wins, losses, draws FROM leaderboard');
        try {
            while(stmt.step()){
                const row = stmt.getAsObject();
                entries.push({
                    id: row.id,
                    name: row.name,
                    wins: Number(row.wins) || 0,
                    losses: Number(row.losses) || 0,
                    draws: Number(row.draws) || 0
                });
            }
        } finally {
            stmt.free();
        }
        return entries;
    };

    const getTotalPlayers = () => {
        const stmt = database.prepare('SELECT COUNT(1) AS c FROM players');
        try {
            stmt.step();
            const row = stmt.getAsObject();
            return Number(row.c) || 0;
        } finally {
            stmt.free();
        }
    };

    const close = () => {
        try {
            flushNow();
        } catch {
            // ignore
        }
        database.close();
    };

    process.on('SIGINT', () => {
        try { close(); } finally { process.exit(0); }
    });
    process.on('SIGTERM', () => {
        try { close(); } finally { process.exit(0); }
    });

    return {
        upsertPlayer,
        upsertLeaderboardEntry,
        loadLeaderboard,
        getTotalPlayers,
        flushNow,
        close
    };
}
