const socket = io();


// SHARED GLOBALS (Attached to window for cross-script access)
window.board = null;
window.room = null;
window.myColor = null;
window.turn = "white";
window.selected = null;
window.validMoves = [];
window.gameStatus = { status: "active" };
window.capturedWhite = [];
window.capturedBlack = [];
window.mode = null;
window.gameData = {}; // Store full server update for rules preview

let isQueued = false;
let pendingPower = null; // "freeze" | "teleport" | "swap"
let moveInFlight = false; // prevent duplicate rapid sends
let modalOnPrimary = null;
let modalOnSecondary = null;
let promotionResolver = null;
let matchHistory = { boards: [], moves: [] };
let reviewIndex = 0;
const RECONNECT_STORAGE_KEY = "chessReconnectState";
let rejoinDecisionPending = false;


window.symbols = {
  r: "♜", n: "♞", b: "♝", q: "♛", k: "♚", p: "♟",
  R: "♖", N: "♘", B: "♗", Q: "♕", K: "♔", P: "♙"
};

// --- SOUNDS ---
const audio = {
  move: new Audio("https://images.chesscomfiles.com/chess-themes/sounds/_standard/move-self.mp3"),
  capture: new Audio("https://images.chesscomfiles.com/chess-themes/sounds/_standard/capture.mp3"),
  check: new Audio("https://images.chesscomfiles.com/chess-themes/sounds/_standard/check.mp3"),
  start: new Audio("https://images.chesscomfiles.com/chess-themes/sounds/_standard/game-start.mp3"),
  end: new Audio("https://images.chesscomfiles.com/chess-themes/sounds/_standard/game-end.mp3"),
  notify: new Audio("https://images.chesscomfiles.com/chess-themes/sounds/_standard/notify.mp3")
};

function playSound(type) {
  try {
    if (audio[type]) {
      const s = audio[type].cloneNode();
      s.volume = 0.5;
      s.play().catch(() => {});
    }
  } catch (e) {
    console.warn("Sound play failed", e);
  }
}


// =========================
// SOCKET EVENTS
// =========================
socket.on("queued", (d) => {
  isQueued = true;
  mode = d.mode;
  modeSelectEl.disabled = true;
  queueBtnEl.disabled = true;
  cancelQueueBtnEl.disabled = false;
  lobbyControlsEl.style.display = "flex";
  updateTopPanelVisibility();
  statusEl.textContent = `⏳ Queued for ${modeLabel(mode)}... (position ${d.position})`;
  log(`Queued for mode: ${mode} (position ${d.position})`, "info");
});

socket.on("queueCancelled", () => {
  resetToLobbyUi({ clearBoard: true });
  log("Queue cancelled.", "info");
});

socket.on("queueRejected", (d) => {
  log(`Queue rejected: ${d.reason}`, "error");
  isQueued = false;
  modeSelectEl.disabled = false;
  queueBtnEl.disabled = false;
  cancelQueueBtnEl.disabled = true;
  lobbyControlsEl.style.display = "flex";
  updateTopPanelVisibility();
});

socket.on("start", (d) => {
  myColor = d.color;
  room = d.room;
  mode = d.mode || mode;
  if (d.token) {
    sessionStorage.setItem(RECONNECT_STORAGE_KEY, JSON.stringify({
      room: d.room,
      token: d.token
    }));
  }
  isQueued = false;
  modeSelectEl.disabled = true;
  queueBtnEl.disabled = true;
  cancelQueueBtnEl.disabled = true;
  lobbyControlsEl.style.display = "none";
  updateTopPanelVisibility();
  endOverlayEl.style.display = "none";
  reviewOverlayEl.style.display = "none";
  logsEl.innerHTML = ""; // Clear move logs for new game

  // Game UI (show captured + game actions only after match start)
  document.querySelector('.game-area').style.display = 'flex';
  belowBoardActionsEl.style.display = "flex";

  reviewBoardEl.innerHTML = "";
  statusEl.textContent = `You are playing as ${myColor.toUpperCase()} (${modeLabel(mode)})`;
  log(`Game started! You are ${myColor}. Mode: ${mode}. Room: ${room}`, "success");
  
  // Title Flashing (Subtle notification for background tabs)
  if (document.hidden) {
    let originalTitle = document.title;
    let isFlash = false;
    const flashInterval = setInterval(() => {
      if (!document.hidden) {
        clearInterval(flashInterval);
        document.title = originalTitle;
      } else {
        document.title = isFlash ? "!!! MATCH STARTED !!!" : originalTitle;
        isFlash = !isFlash;
      }
    }, 1000);
  }
  
  playSound("start");
  updatePowerPanel();
  updateGameActions();
});

socket.on("update", (d) => {


  window.board = d.board;
  window.turn = d.turn;
  window.gameStatus = d.gameStatus || { status: "active" };
  window.gameData = d;
  window.capturedWhite = d.capturedWhite || [];
  window.capturedBlack = d.capturedBlack || [];
  mode = d.mode || mode;
  if (d.history && Array.isArray(d.history.boards) && Array.isArray(d.history.moves)) {
    matchHistory = d.history;
  }
  if (mode === "powered-king" && d.poweredKing && myColor) {
    const swapsLeft = d.poweredKing?.swapsLeft?.[myColor] ?? 0;
    swapsLeftPillEl.textContent = `Swaps left: ${swapsLeft}`;
  }
  
  let statusText = `It's ${turn.toUpperCase()}'s turn`;
  if (gameStatus.status === "check") {
    statusText += " - ⚠️ CHECK! (Find a way to escape!)";
  } else if (gameStatus.status === "checkmate") {
    statusText = `CHECKMATE! ${gameStatus.winner.toUpperCase()} WINS! 👑`;
  } else if (gameStatus.status === "stalemate") {
    statusText = "STALEMATE! It's a draw. 🤝";
  } else if (gameStatus.status === "resigned") {
    statusText = `RESIGNATION — ${String(gameStatus.winner || "").toUpperCase()} WINS`;
  } else if (gameStatus.status === "draw") {
    statusText = "DRAW — game ended in a draw";
  }

  // Clear reconnect token if game is finished
  const finishedStatuses = ["checkmate", "stalemate", "resigned", "draw"];
  if (finishedStatuses.includes(gameStatus.status)) {
    sessionStorage.removeItem(RECONNECT_STORAGE_KEY);
  }

  if (turn === myColor && gameStatus.status === "active") {
    statusText += " (YOUR TURN)";
  } else if (turn === myColor && gameStatus.status === "check") {
    statusText += " (YOUR TURN - YOU'RE IN CHECK!)";
  }

  if (mode) statusText += ` — ${modeLabel(mode)}`;
  if (pendingPower && turn === myColor && gameStatus.status === "active") {
    statusText += ` — Power: ${pendingPower.toUpperCase()} (click a target square)`;
  }
  
  statusEl.textContent = statusText;
  updatePowerPanel();
  updateGameActions();

  const inGame = Boolean(room && myColor);
  lobbyControlsEl.style.display = inGame ? "none" : "flex";
  updateTopPanelVisibility();

  if (inGame && isGameOverStatus(gameStatus.status)) {
    // End-of-match window
    endModeSelectEl.value = modeSelectEl.value || "regular";
    endTitleEl.textContent = "Match ended";
    endMessageEl.textContent = statusText;
    endOverlayEl.style.display = "flex";
    belowBoardActionsEl.style.display = "none";
  }
  if (inGame && !isGameOverStatus(gameStatus.status)) {
    belowBoardActionsEl.style.display = "flex";
    endOverlayEl.style.display = "none";
    reviewOverlayEl.style.display = "none";
  }

  // Play sound and trigger effects for last move
  if (d.history && d.history.moves && d.history.moves.length > 0) {
    const lastMove = d.history.moves[d.history.moves.length - 1];
    
    // Trigger visual effects
    if (typeof triggerMoveTrail === "function") {
      triggerMoveTrail(lastMove.from, lastMove.to);
    }
    
    if (lastMove.captured) {
      playSound("capture");
      if (typeof triggerCaptureEffect === "function") {
        triggerCaptureEffect(lastMove.to[0], lastMove.to[1]);
      }
    } else if (window.gameStatus.status === "check") {
      playSound("check");
    } else {
      playSound("move");
    }
  }

  if (typeof render === "function") render();
  if (typeof renderCaptured === "function") renderCaptured();

  // If we just reconnected and the game is still active, ask the user if they want to stay
  if (rejoinDecisionPending && room && myColor && !isGameOverStatus(gameStatus.status)) {
    rejoinDecisionPending = false; // Only ask once
    showModal({
      title: "Match in Progress",
      message: "You have a match in progress. Would you like to rejoin the game or abandon it?",
      primaryText: "Rejoin",
      secondaryText: "Abandon",
      onPrimary: () => {
        log("Match rejoined.", "success");
      },
      onSecondary: () => {
        socket.emit("resign", { room });
        log("Match abandoned.", "info");
      }
    });
  }
});


socket.on("moveConfirmed", (d) => {
  moveInFlight = false;
  
  const toAlg = (pos) => {
    if (!pos || pos.length !== 2) return "??";
    return String.fromCharCode(97 + pos[1]) + (8 - pos[0]);
  };

  const moveStr = `${toAlg(d.from)} → ${toAlg(d.to)}`;
  log(`✅ Move confirmed: ${moveStr}${d.captured ? ` (captured ${d.captured})` : ""}${d.promoted ? " [PAWN PROMOTED]" : ""}`, "success");
});

socket.on("moveRejected", (d) => {
  if (window.sounds) window.sounds.error();
  moveInFlight = false;
  log(`❌ Move rejected: ${d.reason}`, "error");
  selected = null;
  validMoves = [];
  render();
});

socket.on("powerConfirmed", (d) => {
  moveInFlight = false;
  log(`✨ Power confirmed: ${String(d.type).toUpperCase()} at [${d.target}]`, "success");
});

socket.on("powerRejected", (d) => {
  if (window.sounds) window.sounds.error();
  moveInFlight = false;
  log(`❌ Power rejected: ${d.reason}`, "error");
});


socket.on("drawOfferSent", () => {
  log("🤝 Draw offer sent. Waiting for opponent...", "info");
});

socket.on("drawOffered", (d) => {
  playSound("notify");
  showModal({
    title: "Draw offer",
    message: `${String(d.from || "Opponent").toUpperCase()} offered a draw. Accept?`,
    primaryText: "Accept",
    secondaryText: "Reject",
    onPrimary: () => socket.emit("respondDraw", { room, accept: true }),
    onSecondary: () => socket.emit("respondDraw", { room, accept: false })
  });
});

socket.on("drawAccepted", () => {
  hideModal();
  log("🤝 Draw accepted. Game ended in a draw.", "success");
});

socket.on("drawRejected", () => {
  hideModal();
  log("Draw rejected. Play continues.", "info");
});

socket.on("drawOfferRejected", (d) => {
  log(`❌ Draw offer rejected: ${d.reason}`, "error");
});

socket.on("drawResponseRejected", (d) => {
  log(`❌ Draw response rejected: ${d.reason}`, "error");
});

socket.on("resignConfirmed", () => {
  log("You resigned.", "info");
});

socket.on("resignRejected", (d) => {
  log(`❌ Resign rejected: ${d.reason}`, "error");
});

socket.on("connect_error", (error) => {
  log(`Connection error: ${error}`, "error");
});

socket.on("disconnect", () => {
  moveInFlight = false;
});

socket.on("error", (error) => {
  log(`Server error: ${error}`, "error");
});

socket.on("opponentDisconnected", (d) => {
  playSound("notify");
  log(`⚠️ Opponent (${d.color}) disconnected!`, "error");
  showModal({
    title: "Opponent Left",
    message: "Your opponent has disconnected from the match. You can wait for them to return or leave the match to end it.",
    primaryText: "Wait",
    secondaryText: "Leave Match",
    onPrimary: () => {
      log("Waiting for opponent...", "info");
    },
    onSecondary: () => {
      socket.emit("resign", { room });
      log("You left the match.", "info");
    }
  });
});

// =========================
// MOVE
// =========================
function canSendActions() {
  return Boolean(room && myColor && !window.gameData.drawOfferFrom);
}

function isPromotionMove(fromR, toR, pieceChar) {
  const type = window.ChessRules.getPieceType(pieceChar);
  if (type !== "p") return false;
  const isWhite = window.ChessRules.isWhitePiece(pieceChar);
  return (isWhite && toR === 0) || (!isWhite && toR === 7);
}

function sendMove(fr, fc, tr, tc, promotion = null) {
  if (!canSendActions()) return;
  if (moveInFlight) return;

  moveInFlight = true;
  log(`📤 Sending move: [${fr},${fc}] → [${tr},${tc}]${promotion ? ` (promo ${promotion})` : ""}`, "info");

  socket.emit("move", {
    room,
    from: [fr, fc],
    to: [tr, tc],
    promotion
  });
}

function requestPromotionChoice() {
  return new Promise((resolve) => {
    promotionResolver = resolve;
    promotionOverlayEl.style.display = "flex";
  });
}

function hidePromotionOverlay() {
  promotionOverlayEl.style.display = "none";
  promotionResolver = null;
}

function sendPower(type, tr, tc) {
  if (!canSendActions()) return;
  if (moveInFlight) return;

  moveInFlight = true;
  log(`📤 Sending power: ${type.toUpperCase()} → [${tr},${tc}]`, "info");
  socket.emit("kingPower", {
    room,
    type,
    target: [tr, tc]
  });
}

function shouldFlipBoard() {
  return myColor === "black";
}

function displayToBoardCoords(displayR, displayC, flipped) {
  if (!flipped) return [displayR, displayC];
  return [7 - displayR, 7 - displayC];
}


// =========================
socket.on("playerReconnected", (d) => {
  // 1. Remove all old disconnection warnings
  const logs = document.getElementById("logs");
  if (logs) {
    const items = logs.getElementsByClassName("log-item");
    for (let i = items.length - 1; i >= 0; i--) {
      const text = items[i].textContent.toLowerCase();
      if (text.includes("disconnected") || text.includes("left the game") || text.includes("reconnecting")) {
        items[i].remove();
      }
    }
  }
  // 2. Hide the modal popup
  if (typeof hideModal === "function") hideModal();
  
  // 3. Add a very prominent reconnected message
  log(`⚡ OPPONENT RECONNECTED! Game on!`, "info");
});

socket.on("roomFull", () => {
  log("This room is full!", "error");
});

socket.on("connect", () => {
  moveInFlight = false;
  try {
    const raw = sessionStorage.getItem(RECONNECT_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed?.room || !parsed?.token) return;
    
    rejoinDecisionPending = true; // Set flag to prompt once we get the update
    socket.emit("reconnect", { room: parsed.room, token: parsed.token });
    log("Checking for active match...", "info");
  } catch (err) {
    sessionStorage.removeItem(RECONNECT_STORAGE_KEY);
  }
});
