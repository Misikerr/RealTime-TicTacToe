import mongoose from 'mongoose';

const PlayerSchema = new mongoose.Schema(
    {
        _id: { type: String, required: true },
        name: { type: String, required: true },
        firstSeen: { type: Number, required: true },
        lastSeen: { type: Number, required: true }
    },
    { versionKey: false }
);

const LeaderboardSchema = new mongoose.Schema(
    {
        _id: { type: String, required: true },
        name: { type: String, required: true },
        wins: { type: Number, required: true, default: 0 },
        losses: { type: Number, required: true, default: 0 },
        draws: { type: Number, required: true, default: 0 },
        updatedAt: { type: Number, required: true }
    },
    { versionKey: false }
);

PlayerSchema.index({ lastSeen: -1 });
LeaderboardSchema.index({ wins: -1, draws: -1, losses: 1 });

const Player = mongoose.models.Player || mongoose.model('Player', PlayerSchema, 'players');
const LeaderboardEntry = mongoose.models.LeaderboardEntry || mongoose.model('LeaderboardEntry', LeaderboardSchema, 'leaderboard');

export async function openPersistentDb({ mongoUri, dbName } = {}){
    const uri = String(mongoUri || process.env.MONGODB_URI || '').trim() || 'mongodb://127.0.0.1:27017';
    const name = String(dbName || process.env.MONGODB_DB_NAME || '').trim() || 'tictactoe';

    await mongoose.connect(uri, {
        dbName: name,
        maxPoolSize: 10
    });

    await Promise.all([
        Player.init(),
        LeaderboardEntry.init()
    ]);

    const upsertPlayer = async ({ id, name }) => {
        if(!id || !name){
            return;
        }
        const now = Date.now();
        await Player.updateOne(
            { _id: String(id) },
            {
                $set: {
                    name: String(name),
                    lastSeen: now
                },
                $setOnInsert: {
                    firstSeen: now
                }
            },
            { upsert: true }
        );
    };

    const upsertLeaderboardEntry = async ({ id, name, wins, losses, draws }) => {
        if(!id || !name){
            return;
        }
        const now = Date.now();
        await LeaderboardEntry.updateOne(
            { _id: String(id) },
            {
                $set: {
                    name: String(name),
                    wins: Number(wins) || 0,
                    losses: Number(losses) || 0,
                    draws: Number(draws) || 0,
                    updatedAt: now
                }
            },
            { upsert: true }
        );
    };

    const loadLeaderboard = async () => {
        const rows = await LeaderboardEntry
            .find({}, { _id: 1, name: 1, wins: 1, losses: 1, draws: 1 })
            .lean()
            .exec();

        return rows.map((row) => ({
            id: String(row._id),
            name: row.name,
            wins: Number(row.wins) || 0,
            losses: Number(row.losses) || 0,
            draws: Number(row.draws) || 0
        }));
    };

    const getTotalPlayers = async () => {
        return await Player.countDocuments({});
    };

    const flushNow = () => {
        // no-op for MongoDB; writes are immediate
    };

    const close = async () => {
        await mongoose.connection.close();
    };

    process.on('SIGINT', () => {
        void close().finally(() => process.exit(0));
    });
    process.on('SIGTERM', () => {
        void close().finally(() => process.exit(0));
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
