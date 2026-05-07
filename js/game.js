const socket = io();


let board = null;
let room = null;
let myColor = null;
let turn = "white";
let selected = null;
let validMoves = [];
let draggedPiece = null;
let gameStatus = { status: "active" };
let capturedWhite = [];
let capturedBlack = [];
let mode = null;
let isQueued = false;
let pendingPower = null; // "freeze" | "teleport" | "swap"
let moveInFlight = false; // prevent duplicate rapid sends
let modalOnPrimary = null;
let modalOnSecondary = null;
let promotionResolver = null;
let matchHistory = { boards: [], moves: [] };
let reviewIndex = 0;
const RECONNECT_STORAGE_KEY = "chessReconnectState";

const symbols = {
 r:"♜", n:"♞", b:"♝", q:"♛", k:"♚", p:"♟",
 R:"♖", N:"♘", B:"♗", Q:"♕", K:"♔", P:"♙"
};

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
  isQueued = false;
  modeSelectEl.disabled = false;
  queueBtnEl.disabled = false;
  cancelQueueBtnEl.disabled = true;
  lobbyControlsEl.style.display = "flex";
  updateTopPanelVisibility();
  statusEl.textContent = "Pick a mode and press Queue.";
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

  // Game UI (show captured + game actions only after match start)
  document.querySelector('.game-area').style.display = 'flex';
  belowBoardActionsEl.style.display = "flex";

  reviewBoardEl.innerHTML = "";
  statusEl.textContent = `You are playing as ${myColor.toUpperCase()} (${modeLabel(mode)})`;
  log(`Game started! You are ${myColor}. Mode: ${mode}. Room: ${room}`, "success");
  updatePowerPanel();
  updateGameActions();
});

socket.on("update", (d) => {
  board = d.board;
  turn = d.turn;
  gameStatus = d.gameStatus || { status: "active" };
  capturedWhite = d.capturedWhite || [];
  capturedBlack = d.capturedBlack || [];
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

  render();
  renderCaptured();
});

socket.on("moveConfirmed", (d) => {
  moveInFlight = false;
  log(`✅ Move confirmed: [${d.from}] → [${d.to}]${d.captured ? ` (captured ${d.captured})` : ""}${d.promoted ? " [PAWN PROMOTED]" : ""}`, "success");
});

socket.on("moveRejected", (d) => {
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
  moveInFlight = false;
  log(`❌ Power rejected: ${d.reason}`, "error");
});


socket.on("drawOfferSent", () => {
  log("🤝 Draw offer sent. Waiting for opponent...", "info");
});

socket.on("drawOffered", (d) => {
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

// =========================
// MOVE
// =========================
function canSendActions() {
  return Boolean(room && myColor);
}

function isPromotionMove(fromR, toR, pieceChar) {
  const type = getPieceType(pieceChar);
  if (type !== "p") return false;
  const isWhite = isWhitePiece(pieceChar);
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
socket.on("connect", () => {
  moveInFlight = false;
  try {
    const raw = sessionStorage.getItem(RECONNECT_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed?.room || !parsed?.token) return;
    socket.emit("reconnect", { room: parsed.room, token: parsed.token });
    log("Attempting to reconnect to your previous match...", "info");
  } catch (err) {
    sessionStorage.removeItem(RECONNECT_STORAGE_KEY);
  }
});
