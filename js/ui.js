const boardEl = document.getElementById("board");
const statusEl = document.getElementById("status");
const logsEl = document.getElementById("logs");
const whiteCapturedEl = document.getElementById("whiteCaptured");
const blackCapturedEl = document.getElementById("blackCaptured");
const whiteCapturedScoreEl = document.getElementById("whiteCapturedScore");
const blackCapturedScoreEl = document.getElementById("blackCapturedScore");
const modeSelectEl = document.getElementById("modeSelect");
const queueBtnEl = document.getElementById("queueBtn");
const cancelQueueBtnEl = document.getElementById("cancelQueueBtn");
const topPanelEl = document.getElementById("topPanel");
const lobbyControlsEl = document.getElementById("lobbyControls");
const powerPanelEl = document.getElementById("powerPanel");
const powerFreezeBtnEl = document.getElementById("powerFreezeBtn");
const powerTeleportBtnEl = document.getElementById("powerTeleportBtn");
const powerSwapBtnEl = document.getElementById("powerSwapBtn");
const powerCancelBtnEl = document.getElementById("powerCancelBtn");
const swapsLeftPillEl = document.getElementById("swapsLeftPill");
const offerDrawBtnEl = document.getElementById("offerDrawBtn");
const resignBtnEl = document.getElementById("resignBtn");
const belowBoardActionsEl = document.getElementById("belowBoardActions");
const modalOverlayEl = document.getElementById("modalOverlay");
const modalTitleEl = document.getElementById("modalTitle");
const modalMessageEl = document.getElementById("modalMessage");
const modalPrimaryBtnEl = document.getElementById("modalPrimaryBtn");
const modalSecondaryBtnEl = document.getElementById("modalSecondaryBtn");
const promotionOverlayEl = document.getElementById("promotionOverlay");
const promotionButtons = Array.from(document.querySelectorAll(".promotion-btn"));
const endOverlayEl = document.getElementById("endOverlay");
const endTitleEl = document.getElementById("endTitle");
const endMessageEl = document.getElementById("endMessage");
const endModeSelectEl = document.getElementById("endModeSelect");
const endLobbyBtnEl = document.getElementById("endLobbyBtn");
const endRequeueBtnEl = document.getElementById("endRequeueBtn");
const reviewMatchBtnEl = document.getElementById("reviewMatchBtn");
const reviewOverlayEl = document.getElementById("reviewOverlay");
const closeReviewBtnEl = document.getElementById("closeReviewBtn");
const reviewBoardEl = document.getElementById("reviewBoard");
const reviewPrevBtnEl = document.getElementById("reviewPrevBtn");
const reviewNextBtnEl = document.getElementById("reviewNextBtn");
const reviewSliderEl = document.getElementById("reviewSlider");
const reviewMovesEl = document.getElementById("reviewMoves");
const reviewMetaEl = document.getElementById("reviewMeta");
// LOGGING & SOUNDS
// =========================
const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();

const playTone = (freq, type, duration, vol = 0.1) => {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  gain.gain.setValueAtTime(vol, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
};

window.sounds = {
  move: () => playTone(300, 'sine', 0.1, 0.2),
  capture: () => playTone(150, 'square', 0.15, 0.2),
  check: () => playTone(400, 'triangle', 0.3, 0.3),
  error: () => playTone(100, 'sawtooth', 0.2, 0.2)
};

function log(message, type = "info") {
  const entry = document.createElement("div");
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logsEl.appendChild(entry);
  logsEl.scrollTop = logsEl.scrollHeight;
  console.log(`[${type.toUpperCase()}] ${message}`);
}

// =========================
function modeLabel(m) {
  if (m === "regular") return "Regular Chess";
  if (m === "powered-king") return "Powered King Chess";
  if (m === "fog-of-war") return "Fog of War Chess";
  return m || "Unknown";
}

function updateTopPanelVisibility() {
  if (!topPanelEl) return;
  const lobbyVisible = lobbyControlsEl.style.display !== "none";
  const powerVisible = powerPanelEl.classList.contains("active");
  topPanelEl.style.display = (lobbyVisible || powerVisible) ? "flex" : "none";
}

function updatePowerPanel() {
  const shouldShow = mode === "powered-king" && myColor;
  powerPanelEl.classList.toggle("active", shouldShow);
  if (!shouldShow) pendingPower = null;

  const myTurn = turn === myColor && gameStatus.status === "active";
  const disabled = !myTurn;
  powerFreezeBtnEl.disabled = disabled;
  powerTeleportBtnEl.disabled = disabled;
  powerSwapBtnEl.disabled = disabled;
  powerCancelBtnEl.disabled = !pendingPower;
  updateTopPanelVisibility();
}

function updateGameActions() {
  const inGame = Boolean(room && myColor);
  const gameActive = gameStatus.status === "active" || gameStatus.status === "check";
  const enabled = inGame && gameActive;
  offerDrawBtnEl.disabled = !enabled;
  resignBtnEl.disabled = !enabled;

  // Lobby/queue: hide draw/resign panel entirely
  belowBoardActionsEl.style.display = inGame ? "flex" : "none";
}

function isGameOverStatus(status) {
  return status === "checkmate" || status === "stalemate" || status === "draw" || status === "resigned";
}

function moveLabel(m, idx) {
  if (!m) return `${idx + 1}. (unknown)`;
  
  const moveNumber = Math.floor(idx / 2) + 1;
  const isWhite = idx % 2 === 0;
  const prefix = isWhite ? `${moveNumber}. ` : `${moveNumber}... `;

  if (m.kind === "power") {
    return `${prefix}POWER: ${String(m.power || "").toUpperCase()} → [${(m.target || []).join(",")}]`;
  }

  // Helper to convert [row, col] to "e4"
  const toAlgebraic = (pos) => {
    if (!pos || pos.length !== 2) return "??";
    return String.fromCharCode(97 + pos[1]) + (8 - pos[0]);
  };

  const piece = m.piece || "";
  const pieceType = piece.toLowerCase();
  const from = toAlgebraic(m.from);
  const to = toAlgebraic(m.to);
  const isCapture = Boolean(m.captured);
  
  let notation = "";

  // 1. Castling detection
  if (pieceType === "k" && Math.abs(m.from[1] - m.to[1]) === 2) {
    notation = m.to[1] > m.from[1] ? "O-O" : "O-O-O";
  } 
  // 2. Pawn moves/captures
  else if (pieceType === "p") {
    if (isCapture) {
      notation = from[0] + "x" + to;
    } else {
      notation = to;
    }
  } 
  // 3. Piece moves/captures
  else {
    const pieceLetter = pieceType === "n" ? "N" : pieceType.toUpperCase();
    notation = pieceLetter + (isCapture ? "x" : "") + to;
  }

  // 4. Promotions
  if (m.promotedTo) {
    notation += "=" + String(m.promotedTo).toUpperCase();
  }

  return `${prefix}${notation}`;
}

function openReview() {
  const boards = matchHistory?.boards || [];
  const moves = matchHistory?.moves || [];
  if (!Array.isArray(boards) || boards.length === 0) {
    log("No match history available to review.", "error");
    return;
  }

  reviewIndex = Math.min(reviewIndex, boards.length - 1);
  reviewSliderEl.min = "0";
  reviewSliderEl.max = String(boards.length - 1);
  reviewSliderEl.value = String(reviewIndex);

  reviewMovesEl.innerHTML = "";
  moves.forEach((m, i) => {
    const row = document.createElement("div");
    row.className = "log-entry info";
    row.style.cursor = "pointer";
    row.textContent = moveLabel(m, i);
    row.addEventListener("click", () => {
      setReviewIndex(i + 1);
    });
    reviewMovesEl.appendChild(row);
  });

  reviewOverlayEl.style.display = "flex";
  endOverlayEl.style.display = "none";
  setReviewIndex(boards.length - 1);
}

function closeReview() {
  reviewOverlayEl.style.display = "none";
  if (room && myColor && isGameOverStatus(gameStatus.status)) {
    endOverlayEl.style.display = "flex";
  }
}

function setReviewIndex(i) {
  const boards = matchHistory?.boards || [];
  if (!boards.length) return;
  reviewIndex = Math.max(0, Math.min(i, boards.length - 1));
  reviewSliderEl.value = String(reviewIndex);
  renderBoard(reviewBoardEl, boards[reviewIndex], { interactive: false });

  const ply = reviewIndex;
  const total = boards.length - 1;
  const lastMove = matchHistory?.moves?.[Math.max(0, ply - 1)];
  reviewMetaEl.textContent = ply === 0 ? `Start position (0/${total})` : `${moveLabel(lastMove, ply - 1)} (${ply}/${total})`;
}

function resetToLobbyUi({ clearBoard = false } = {}) {
  pendingPower = null;
  selected = null;
  validMoves = [];
  draggedPiece = null;
  hideModal();
  endOverlayEl.style.display = "none";
  reviewOverlayEl.style.display = "none";

  room = null;
  myColor = null;
  localStorage.removeItem(RECONNECT_STORAGE_KEY);
  turn = "white";
  gameStatus = { status: "active" };
  capturedWhite = [];
  capturedBlack = [];
  if (clearBoard) board = null;

  isQueued = false;
  modeSelectEl.disabled = false;
  queueBtnEl.disabled = false;
  cancelQueueBtnEl.disabled = true;
  lobbyControlsEl.style.display = "flex";

  // Board stays visible; only hide capture columns + draw/resign buttons.
  belowBoardActionsEl.style.display = "none";

  updatePowerPanel();
  updateGameActions();
  statusEl.textContent = "Pick a mode and press Queue.";
  render();
  renderCaptured();
}

window.showModal = function({ title, message, primaryText = "OK", secondaryText = "Cancel", onPrimary, onSecondary }) {
  modalTitleEl.textContent = title;
  modalMessageEl.textContent = message;
  modalPrimaryBtnEl.textContent = primaryText;
  modalSecondaryBtnEl.textContent = secondaryText;
  modalOnPrimary = onPrimary || null;
  modalOnSecondary = onSecondary || null;
  modalOverlayEl.style.display = "flex";
}

window.hideModal = function() {
  modalOverlayEl.style.display = "none";
  modalOnPrimary = null;
  modalOnSecondary = null;
}

modalPrimaryBtnEl.addEventListener("click", () => {
  const fn = modalOnPrimary;
  hideModal();
  if (typeof fn === "function") fn();
});

modalSecondaryBtnEl.addEventListener("click", () => {
  const fn = modalOnSecondary;
  hideModal();
  if (typeof fn === "function") fn();
});

promotionButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const choice = String(btn.dataset.piece || "").toUpperCase();
    const resolver = promotionResolver;
    hidePromotionOverlay();
    if (typeof resolver === "function") resolver(choice);
  });
});

offerDrawBtnEl.addEventListener("click", () => {
  if (!room) return;
  socket.emit("offerDraw", { room });
});

resignBtnEl.addEventListener("click", () => {
  if (!room) return;
  showModal({
    title: "Resign?",
    message: "Are you sure you want to resign? This will immediately end the game.",
    primaryText: "Resign",
    secondaryText: "Cancel",
    onPrimary: () => socket.emit("resign", { room }),
    onSecondary: () => { }
  });
});

endRequeueBtnEl.addEventListener("click", () => {
  const selectedMode = endModeSelectEl.value;
  modeSelectEl.value = selectedMode;
  resetToLobbyUi({ clearBoard: false });
  socket.emit("queue", { mode: selectedMode });
});

endLobbyBtnEl.addEventListener("click", () => {
  modeSelectEl.value = endModeSelectEl.value;
  resetToLobbyUi({ clearBoard: false });
  log("Returned to lobby.", "info");
});

reviewMatchBtnEl.addEventListener("click", () => {
  openReview();
});

closeReviewBtnEl.addEventListener("click", () => {
  closeReview();
});

reviewPrevBtnEl.addEventListener("click", () => {
  setReviewIndex(reviewIndex - 1);
});

reviewNextBtnEl.addEventListener("click", () => {
  setReviewIndex(reviewIndex + 1);
});

reviewSliderEl.addEventListener("input", () => {
  setReviewIndex(Number(reviewSliderEl.value));
});

queueBtnEl.addEventListener("click", () => {
  const selectedMode = modeSelectEl.value;
  socket.emit("queue", { mode: selectedMode });
});

cancelQueueBtnEl.addEventListener("click", () => {
  socket.emit("cancelQueue");
});

powerFreezeBtnEl.addEventListener("click", () => {
  if (!canSendActions()) return;
  pendingPower = "freeze";
  log("Freeze selected. Click an enemy piece to freeze it for 1 turn.", "info");
  render();
});


powerTeleportBtnEl.addEventListener("click", () => {
  if (!canSendActions()) return;
  pendingPower = "teleport";
  log("Teleport selected. Click an empty square that is not protected by the enemy.", "info");
  render();
});


powerSwapBtnEl.addEventListener("click", () => {
  if (!canSendActions()) return;
  pendingPower = "swap";
  log("Swap selected. Click a friendly (non-king) piece to swap with your king.", "info");
  render();
});


powerCancelBtnEl.addEventListener("click", () => {
  pendingPower = null;
  log("Power cancelled.", "info");
  render();
});

statusEl.textContent = "Pick a mode and press Queue.";
updateTopPanelVisibility();

// DARK MODE
const darkModeToggleBtn = document.getElementById("darkModeToggle");
if (darkModeToggleBtn) {
  const isDark = localStorage.getItem("darkMode") === "true";
  if (isDark) {
    document.body.classList.add("dark-mode");
    darkModeToggleBtn.textContent = "☀️";
  }

  darkModeToggleBtn.addEventListener("click", () => {
    document.body.classList.toggle("dark-mode");
    const nowDark = document.body.classList.contains("dark-mode");
    localStorage.setItem("darkMode", nowDark);
    darkModeToggleBtn.textContent = nowDark ? "☀️" : "🌙";
  });
}
