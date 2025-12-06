document.getElementById("loading").style.display = "none";
document.getElementById("bigCont").style.display = "none";
document.getElementById("userCont").style.display = "none";
document.getElementById("oppNameCont").style.display = "none";
document.getElementById("valueCont").style.display = "none";
document.getElementById("whosTurn").style.display = "none";

const statusCards = document.querySelectorAll(".status-card");
const nameCard = document.querySelector(".name-card");
const turnDisplay = document.getElementById("whosTurn");
const defaultTurnColor = turnDisplay ? getComputedStyle(turnDisplay).color : '';
const modal = document.getElementById("gameModal");
const modalMessage = document.getElementById("modalMessage");
const modalAction = document.getElementById("modalAction");
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

document.getElementById("find").addEventListener("click", function(){
    const enteredName = document.getElementById("name").value.trim();

    if(!enteredName){
        showModal("Please enter a valid name.", "Try again");
        return;
    }

    name = enteredName;
    document.getElementById("user").innerText = name;

    socket.emit("find", {name: name});
    document.getElementById("loading").style.display = "block";
    document.getElementById("find").disabled=true;
})

socket.on("find", (e)=>{
    const allPlayers = e.allPlayers || []; 

    document.getElementById("userCont").style.display = "block";
    document.getElementById("oppNameCont").style.display = "block";
    document.getElementById("valueCont").style.display = "block";
    document.getElementById("loading").style.display = "none";
    document.getElementById("name").style.display = "none";
    document.getElementById("find").style.display = "none";
    document.getElementById("enterName").style.display = "none";
    document.getElementById("bigCont").style.display = "block";
    document.getElementById("whosTurn").style.display = "block";
    document.getElementById("whosTurn").innerText = "X's Turn";
    statusCards.forEach(card => {
        card.style.display = "block";
    });
    if(nameCard){
        nameCard.style.display = "none";
    }

    let oppName = "";
    let value = "";

    const foundObj = allPlayers.find(obj => obj.p1?.p1name === name || obj.p2?.p2name === name);

    if(!foundObj){
        console.warn("Player not found in match list yet", { name, allPlayers });
        return;
    }

    const isPlayerOne = foundObj.p1?.p1name === name;
    oppName = isPlayerOne ? foundObj.p2?.p2name : foundObj.p1?.p1name;
    value = isPlayerOne ? foundObj.p1?.p1value : foundObj.p2?.p2value;

    if(!oppName || !value){
        console.warn("Opponent or value missing in match data", { foundObj });
        return;
    }

    document.getElementById("oppName").innerText = oppName;
    document.getElementById("value").innerText = value;
    myMark = value;
    currentTurn = 'X';
    startTurnTimer();
})

document.querySelectorAll(".btn").forEach(btn => {
    btn.addEventListener("click", () => {
        const value = document.getElementById("value").innerText.trim();
        if(!value || btn.disabled || matchFinished){
            return;
        }
        if(value !== myMark){
            return;
        }
        if(myMark !== currentTurn){
            return;
        }

        socket.emit("playing", { value, id: btn.id, name });
    });
})

socket.on("playing", (payload)=>{
    const allPlayers = payload?.allPlayers;
    if(!Array.isArray(allPlayers)){
        return;
    }

    const foundObj = allPlayers.find(obj => obj.p1?.p1name === name || obj.p2?.p2name === name);
    if(!foundObj){
        console.warn("Match not found in update", { name, allPlayers });
        return;
    }
    
    const p1id = foundObj.p1?.p1move;
    const p2id = foundObj.p2?.p2move;

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
        const winner = currentTurn === "X" ? "O" : "X";
        socket.emit("gameOver", { name, result: "win", winner });
        return;
    }

    const boardFull = cells.every(cell => cell === "X" || cell === "O");
    if(boardFull){
        matchFinished = true;
        disableBoard();
        stopTurnTimer();
        socket.emit("gameOver", { name, result: "draw" });
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