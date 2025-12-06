import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let arr = [];
let playingArray = [];

io.on('connection', (socket) => {
    socket.on('find', (e) => {
        
        if(e.name!== null){
            arr.push(e.name);

            if(arr.length >= 2){
                let p1obj = {
                    p1name: arr[0],
                    p1value: 'X',
                    p1move: ""
                }
                let p2obj = {
                    p2name: arr[1],
                    p2value: 'O',
                    p2move: ""
                }

                let obj = {
                    p1: p1obj,
                    p2: p2obj,
                    sum: 1,
                    board: {},
                    turnDeadline: Date.now() + 30000,
                    matchFinished: false,
                    timedOutPlayer: null,
                    timedOutMark: null,
                    currentTurn: 'X'
                }
                playingArray.push(obj);

                arr.splice(0,2);

                io.emit("find",{allPlayers: playingArray})
            }
        }
    });

    socket.on('playing', ({ value, id, name }) => {
        if(!value || !id || !name){
            return;
        }

        const match = playingArray.find(obj => obj.p1?.p1name === name || obj.p2?.p2name === name);
        if(!match || match.matchFinished){
            return;
        }

        const expectedTurn = (match.sum % 2 !== 0) ? 'X' : 'O';
        if(value !== expectedTurn){
            socket.emit('invalidMove', { reason: 'notYourTurn' });
            return;
        }

        match.board = match.board || {};
        if(match.board[id]){
            socket.emit('invalidMove', { reason: 'occupied' });
            return;
        }

        match.board[id] = value;

        if(match.p1?.p1name === name){
            match.p1.p1move = id;
        } else if(match.p2?.p2name === name){
            match.p2.p2move = id;
        } else {
            return;
        }

        match.sum = typeof match.sum === 'number' ? match.sum + 1 : 2;
        match.turnDeadline = Date.now() + 30000;
        match.timedOutPlayer = null;
        match.timedOutMark = null;
        match.currentTurn = value === 'X' ? 'O' : 'X';

        io.emit('playing', { allPlayers: playingArray });
    });

    socket.on('gameOver', ({ name, result, winner }) => {
        if(!name){
            return;
        }

        const matchIndex = playingArray.findIndex(obj => obj.p1?.p1name === name || obj.p2?.p2name === name);
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
        const players = [finishedMatch?.p1?.p1name, finishedMatch?.p2?.p2name].filter(Boolean);

        io.emit('matchEnded', {
            players,
            result: result || 'win',
            winner: winner || null
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
            const timedOutPlayer = timedOutMark === 'X' ? match.p1?.p1name : match.p2?.p2name;

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve the built frontend (or static assets) from the project root
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = Number(process.env.PORT) || 3000;

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

