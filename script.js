document.getElementById("loading").style.display = "none";
document.getElementById("bigCont").style.display = "none";
document.getElementById("userCont").style.display = "none";
document.getElementById("oppNameCont").style.display = "none";
document.getElementById("valueCont").style.display = "none";
document.getElementById("whosTurn").style.display = "none";

// Queue to capture Telegram auth callbacks that may fire before this module loads
window.__pendingTelegramAuth = window.__pendingTelegramAuth || [];
const enqueueTelegramAuth = (user) => {
    if(!user){
        return;
    }
    window.__pendingTelegramAuth.push(user);
    if(typeof window.onTelegramAuth === 'function'){
        try {
            window.onTelegramAuth(user);
        } catch (err){
            console.error('Deferred auth handler failed', err);
        }
    }
};
window.enqueueTelegramAuth = enqueueTelegramAuth;

const statusCards = document.querySelectorAll(".status-card");
const nameCard = document.querySelector(".name-card");
const turnDisplay = document.getElementById("whosTurn");
const defaultTurnColor = turnDisplay ? getComputedStyle(turnDisplay).color : '';
const modal = document.getElementById("gameModal");
const modalMessage = document.getElementById("modalMessage");
const modalAction = document.getElementById("modalAction");
const authStatus = document.getElementById("authStatus");
const leaderboardList = document.getElementById("leaderboardList");
const refreshLeaderboardBtn = document.getElementById("refreshLeaderboard");
const quickPlayBtn = document.getElementById("quickPlay");
const createInviteBtn = document.getElementById("createInvite");
const joinInviteBtn = document.getElementById("joinInvite");
const inviteLinkInput = document.getElementById("inviteLink");
const joinCodeInput = document.getElementById("joinCode");
let modalCallback = null;

statusCards.forEach(card => {
    card.style.display = "none";
});

const socket = io();

let name;
let myMark = '';
let currentTurn = 'X';
let matchFinished = false;
let countdownInterval = null;
let authToken = null;
let currentUser = null;

if(quickPlayBtn){
    quickPlayBtn.disabled = true;
}

if(modalAction){
    modalAction.addEventListener("click", () => {
        hideModal();
        if(typeof modalCallback === "function"){
            const callback = modalCallback;
            modalCallback = null;
            callback();
        }
    });
}

function showModal(message, buttonLabel = "Okay", callback = null){
    if(!modal || !modalMessage || !modalAction){
        alert(message);
        if(typeof callback === "function"){
            callback();
        }
        return;
    }
    modalMessage.textContent = message;
    modalAction.textContent = buttonLabel;
    modal.classList.remove("hidden");
    modalCallback = callback;
}

function hideModal(){
    if(modal){
        modal.classList.add("hidden");
    }
}

const applyMarkToCell = (cell, mark) => {
    if(!cell || !mark){
        return;
    }
    cell.innerText = mark;
    cell.disabled = true;
    cell.classList.remove("mark-x", "mark-o");
    if(mark === "X"){
        cell.classList.add("mark-x");
    } else if(mark === "O"){
        cell.classList.add("mark-o");
    }
};

const disableBoard = () => {
    document.querySelectorAll(".btn").forEach(btn => {
        btn.disabled = true;
    });
};

const safeDisplayName = (user) => {
    if(!user){
        return '';
    }
    return user.username || user.first_name || `tg-${user.id || 'user'}`;
};

const renderLeaderboard = (items = []) => {
    if(!leaderboardList){
        return;
    }
    leaderboardList.innerHTML = '';
    if(items.length === 0){
        const li = document.createElement('li');
        li.textContent = 'No games played yet.';
        leaderboardList.appendChild(li);
        return;
    }
    items.slice(0, 10).forEach((entry, idx) => {
        const li = document.createElement('li');
        li.textContent = `${idx + 1}. ${entry.name} — W:${entry.wins} D:${entry.draws} L:${entry.losses}`;
        leaderboardList.appendChild(li);
    });
};

async function fetchLeaderboard(){
    try {
        const res = await fetch('/api/leaderboard');
        const data = await res.json();
        if(data?.leaderboard){
            renderLeaderboard(data.leaderboard);
        }
    } catch (err){
        console.error('Failed to fetch leaderboard', err);
    }
}

async function authenticateWithServer(user){
    console.info('[auth] received payload from widget', user);
    try {
        const res = await fetch('/api/auth/telegram', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(user)
        });
        const data = await res.json();
        console.info('[auth] server response', { status: res.status, data });
        if(!res.ok || !data?.ok){
            console.error('Telegram auth failed', data);
            showModal(data?.error || 'Telegram auth failed.');
            return;
        }
        authToken = data.token;
        currentUser = data.user;
        name = safeDisplayName(currentUser);
        document.getElementById("user").innerText = name;
        if(authStatus){
            authStatus.textContent = `Logged in as ${currentUser.username ? '@' + currentUser.username : name}`;
        }
        if(quickPlayBtn){
            quickPlayBtn.disabled = false;
        }
        statusCards.forEach(card => card.style.display = "block");
        if(nameCard){
            nameCard.style.display = "block";
        }
        await fetchLeaderboard();
    } catch (err){
        console.error('Auth error', err);
        showModal('Could not complete Telegram login.');
    }
}

async function loadTelegramWidget(){
    try {
        const container = document.getElementById('telegramLogin');
        const inlinePresent = container && (container.dataset.inlineWidget === 'true');
        const scriptAlreadyOnPage = document.querySelector('script[data-telegram-login]');
        if(inlinePresent || scriptAlreadyOnPage){
            // Widget already inlined; do not overwrite
            return;
        }

        const res = await fetch('/api/config');
        const data = await res.json();
        const botUser = data?.telegramBotUsername;
        if(!botUser){
            if(authStatus){
                authStatus.textContent = 'Set TELEGRAM_BOT_USERNAME on the server to enable login.';
            }
            return;
        }
        if(!container){
            return;
        }
        container.innerHTML = '';
        const script = document.createElement('script');
        script.src = 'https://telegram.org/js/telegram-widget.js?22';
        script.async = true;
        script.setAttribute('data-telegram-login', botUser);
        script.setAttribute('data-size', 'large');
        script.setAttribute('data-onauth', 'onTelegramAuth');
        script.setAttribute('data-request-access', 'write');
        container.appendChild(script);
    } catch (err){
        console.error('Failed to load Telegram widget', err);
    }
}

// Make auth callback available under multiple global names for the widget
window.onTelegramAuth = async function(user){
    console.log('Telegram auth payload', user);
    await authenticateWithServer(user);
};
window.TelegramAuth = window.onTelegramAuth;
window.TelegramLoginWidgetCallback = window.onTelegramAuth;

// Flush any auth payloads that arrived before this handler existed
if(Array.isArray(window.__pendingTelegramAuth) && window.__pendingTelegramAuth.length){
    const queued = window.__pendingTelegramAuth.splice(0);
    queued.forEach((u) => {
        try {
            window.onTelegramAuth(u);
        } catch (err){
            console.error('Queued auth dispatch failed', err);
        }
    });
}

if(quickPlayBtn){
    quickPlayBtn.addEventListener("click", function(){
        if(!authToken){
            showModal("Login with Telegram first.");
            return;
        }

        name = safeDisplayName(currentUser);
        document.getElementById("user").innerText = name;

        socket.emit("quickFind", { token: authToken });
        document.getElementById("loading").style.display = "block";
        quickPlayBtn.disabled=true;
    });
}

if(createInviteBtn){
    createInviteBtn.addEventListener('click', () => {
        if(!authToken){
            showModal("Login with Telegram first.");
            return;
        }
        socket.emit('createInvite', { token: authToken });
    });
}

if(joinInviteBtn){
    joinInviteBtn.addEventListener('click', () => {
        if(!authToken){
            showModal("Login with Telegram first.");
            return;
        }
        const code = joinCodeInput?.value.trim();
        if(!code){
            showModal("Enter an invite code.");
            return;
        }
        socket.emit('joinInvite', { token: authToken, code });
    });
}

socket.on("find", (e)=>{
    const allPlayers = e.allPlayers || []; 

    document.getElementById("userCont").style.display = "block";
    document.getElementById("oppNameCont").style.display = "block";
    document.getElementById("valueCont").style.display = "block";
    document.getElementById("loading").style.display = "none";
    if(quickPlayBtn){
        quickPlayBtn.style.display = "none";
    }
    document.getElementById("bigCont").style.display = "block";
    document.getElementById("whosTurn").style.display = "block";
    document.getElementById("whosTurn").innerText = "X's Turn";
    statusCards.forEach(card => {
        card.style.display = "block";
    });
    if(nameCard){
        nameCard.style.display = "block";
    }

    let oppName = "";
    let value = "";

    const foundObj = allPlayers.find(obj => obj.p1?.name === name || obj.p2?.name === name);

    if(!foundObj){
        console.warn("Player not found in match list yet", { name, allPlayers });
        return;
    }

    const isPlayerOne = foundObj.p1?.name === name;
    oppName = isPlayerOne ? foundObj.p2?.name : foundObj.p1?.name;
    value = isPlayerOne ? 'X' : 'O';

    if(!oppName || !value){
        console.warn("Opponent or value missing in match data", { foundObj });
        return;
    }

    document.getElementById("oppName").innerText = oppName;
    document.getElementById("value").innerText = value;
    myMark = value;
    currentTurn = 'X';
    startTurnTimer();
});

document.querySelectorAll(".btn").forEach(btn => {
    btn.addEventListener("click", () => {
        if(btn.disabled || matchFinished){
            return;
        }
        if(!authToken || !myMark || myMark !== currentTurn){
            return;
        }

        socket.emit("playing", { id: btn.id, token: authToken });
    });
});

socket.on("playing", (payload)=>{
    const allPlayers = payload?.allPlayers;
    if(!Array.isArray(allPlayers)){
        return;
    }

    const foundObj = allPlayers.find(obj => obj.p1?.name === name || obj.p2?.name === name);
    if(!foundObj){
        console.warn("Match not found in update", { name, allPlayers });
        return;
    }
    
    const p1id = foundObj.p1?.move;
    const p2id = foundObj.p2?.move;

    if(document.getElementById("whosTurn")){
        const nextTurn = foundObj.currentTurn || ((foundObj.sum % 2 === 0) ? "O" : "X");
        currentTurn = nextTurn;
        if(nextTurn){
            document.getElementById("whosTurn").innerText = `${nextTurn}'s Turn`;
            startTurnTimer();
        }
    }

    if(p1id){
        applyMarkToCell(document.getElementById(p1id), "X");
    }
    if(p2id){
        applyMarkToCell(document.getElementById(p2id), "O");
    }

    if(foundObj.timedOutPlayer && foundObj.timedOutPlayer === name){
        console.warn("You ran out of time. Turn passed to opponent.");
    } else if(foundObj.timedOutPlayer && foundObj.timedOutPlayer !== name){
        console.warn(`${foundObj.timedOutPlayer} timed out. Your turn.`);
    }

    check(name);
});

function check(name){
    if(matchFinished){
        return;
    }

    const cells = Array.from({ length: 9 }, (_, idx) => {
        const el = document.getElementById(`btn${idx + 1}`);
        return el && el.innerText ? el.innerText : String.fromCharCode(97 + idx);
    });

    const won =
        (cells[0] === cells[1] && cells[1] === cells[2]) ||
        (cells[3] === cells[4] && cells[4] === cells[5]) ||
        (cells[6] === cells[7] && cells[7] === cells[8]) ||
        (cells[0] === cells[3] && cells[3] === cells[6]) ||
        (cells[1] === cells[4] && cells[4] === cells[7]) ||
        (cells[2] === cells[5] && cells[5] === cells[8]) ||
        (cells[0] === cells[4] && cells[4] === cells[8]) ||
        (cells[2] === cells[4] && cells[4] === cells[6]);

    if(won){
        matchFinished = true;
        disableBoard();
        stopTurnTimer();
        const winnerMark = currentTurn === "X" ? "O" : "X";
        socket.emit("gameOver", { token: authToken, result: "win", winnerMark });
        return;
    }

    const boardFull = cells.every(cell => cell === "X" || cell === "O");
    if(boardFull){
        matchFinished = true;
        disableBoard();
        stopTurnTimer();
        socket.emit("gameOver", { token: authToken, result: "draw" });
    }
}

socket.on("matchEnded", ({ players, result, winner }) => {
    if(!Array.isArray(players) || !players.includes(name)){
        return;
    }

    matchFinished = true;
    disableBoard();
    currentTurn = null;
    stopTurnTimer();

    let message = "Match finished.";
    if(result === "draw"){
        message = "It's a draw!";
    } else if(result === "win" && winner){
        message = `${winner} wins!`;
    }

    showModal(message, "Play again", () => window.location.reload());
});

socket.on("invalidMove", ({ reason }) => {
    console.warn("Invalid move rejected by server", reason);
});

socket.on("leaderboardUpdated", ({ leaderboard }) => {
    renderLeaderboard(leaderboard || []);
});

socket.on("authError", ({ message }) => {
    showModal(message || 'Authentication required.');
});

socket.on('inviteCreated', ({ code }) => {
    if(!code){
        return;
    }
    const url = `${window.location.origin}?invite=${code}`;
    if(inviteLinkInput){
        inviteLinkInput.value = url;
    }
    showModal('Invite link created. Share it with your friend.', 'Done');
});

socket.on('inviteError', ({ message }) => {
    showModal(message || 'Invite error.');
});

function startTurnTimer(){
    stopTurnTimer();
    if(matchFinished){
        return;
    }
    const display = document.getElementById("whosTurn");
    if(!display || !currentTurn){
        return;
    }
    let remaining = 30;
    const updateText = () => {
        display.innerText = `${currentTurn}'s Turn • ${remaining}s`;
        if(defaultTurnColor){
            display.style.color = remaining <= 5 ? '#dc2626' : defaultTurnColor;
        }
    };
    updateText();
    countdownInterval = setInterval(() => {
        if(matchFinished || !currentTurn){
            stopTurnTimer();
            return;
        }
        remaining -= 1;
        if(remaining <= 0){
            stopTurnTimer();
            display.innerText = `${currentTurn}'s Turn`;
            return;
        }
        updateText();
    }, 1000);
}

function stopTurnTimer(){
    if(countdownInterval){
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
    if(turnDisplay && defaultTurnColor){
        turnDisplay.style.color = defaultTurnColor;
    }
}

if(refreshLeaderboardBtn){
    refreshLeaderboardBtn.addEventListener('click', fetchLeaderboard);
}

// Kick off auth widget and initial leaderboard
loadTelegramWidget();
fetchLeaderboard();

// Auto-join invite if present in URL
const urlParams = new URLSearchParams(window.location.search);
const inviteParam = urlParams.get('invite');
if(inviteParam){
    if(joinCodeInput){
        joinCodeInput.value = inviteParam;
    }
    // Wait for auth; user must click Join after login
}

// Fallback listener: capture Telegram widget postMessage if onAuth is not firing
window.addEventListener('message', (event) => {
    if(typeof event?.data !== 'object'){
        return;
    }
    const fromTelegram = typeof event.origin === 'string' && event.origin.includes('telegram.org');
    if(fromTelegram && event.data.event === 'auth_user' && event.data.user){
        console.log('Telegram postMessage auth', event.data.user);
        window.onTelegramAuth(event.data.user);
    }
});