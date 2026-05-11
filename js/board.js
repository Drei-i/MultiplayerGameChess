// RENDER
// =========================
function renderBoard(targetEl, boardToRender, { interactive = false } = {}) {
  if (!boardToRender) return;

  targetEl.innerHTML = "";
  const flipped = interactive && shouldFlipBoard();

  for (let displayR = 0; displayR < 8; displayR++) {
    for (let displayC = 0; displayC < 8; displayC++) {
      const [r, c] = displayToBoardCoords(displayR, displayC, flipped);

      const sq = document.createElement("div");
      sq.className = "square " + ((r + c) % 2 ? "black" : "white");
      sq.dataset.pos = `${r},${c}`;

      const lastMove = matchHistory?.moves?.[matchHistory.moves.length - 1];
      if (lastMove && lastMove.from && lastMove.to) {
        const isFromVisible = boardToRender[lastMove.from[0]][lastMove.from[1]] !== null;
        const isToVisible = boardToRender[lastMove.to[0]][lastMove.to[1]] !== null;

        if (r === lastMove.from[0] && c === lastMove.from[1] && isFromVisible) {
          sq.classList.add("last-move");
        }
        if (r === lastMove.to[0] && c === lastMove.to[1] && isToVisible) {
          sq.classList.add("last-move");
        }
      }

      const piece = boardToRender[r][c];
      if (piece === null) {
        sq.classList.add("fog");
      }

      if (piece) {
        const pieceEl = document.createElement("span");
        const isKing = window.ChessRules.getPieceType(piece) === "k";
        const kingClass = (mode === "powered-king" && isKing) ? " piece-king" : "";
        pieceEl.className = `piece ${window.ChessRules.isWhitePiece(piece) ? "piece-white" : "piece-black"}${kingClass}`;
        pieceEl.textContent = window.symbols[piece] || "";
        sq.appendChild(pieceEl);
      }

      if (interactive) {
        // Highlight selected square
        if (selected && selected[0] === r && selected[1] === c) {
          sq.classList.add("selected");
        }

        // Highlight valid moves
        if (validMoves.some(([vr, vc]) => vr === r && vc === c)) {
          sq.classList.add("valid-move");

          // Add a physical dot element for guaranteed visibility
          const dot = document.createElement("div");
          dot.className = "move-dot";
          sq.appendChild(dot);

          const targetPiece = boardToRender[r][c];
          if (targetPiece && !window.ChessRules.isFriendlyPiece(targetPiece, myColor === "white")) {
            sq.classList.add("valid-capture");
          }
        }
      }

      // COORDINATE LABELS
      const isBottomEdge = displayR === 7;
      const isLeftEdge = displayC === 0;

      if (isBottomEdge) {
        const fileLabel = document.createElement("span");
        fileLabel.className = "coord-label file-label";
        fileLabel.textContent = String.fromCharCode(97 + c); // a-h
        sq.appendChild(fileLabel);
      }
      if (isLeftEdge) {
        const rankLabel = document.createElement("span");
        rankLabel.className = "coord-label rank-label";
        rankLabel.textContent = 8 - r; // 1-8
        sq.appendChild(rankLabel);
      }

      // Drag start
      sq.draggable = interactive;
      if (interactive) sq.addEventListener("dragstart", (e) => {
        if (gameStatus.status === "checkmate" || gameStatus.status === "stalemate" || gameStatus.status === "draw" || gameStatus.status === "resigned") {
          e.preventDefault();
          return;
        }

        if (turn !== myColor) {
          e.preventDefault();
          return;
        }

        if (pendingPower) {
          e.preventDefault();
          return;
        }
        
        const piece = board[r][c];
        if (!piece) {
          e.preventDefault();
          return;
        }
        
        const isWhite = window.ChessRules.isWhitePiece(piece);
        if (!window.ChessRules.isFriendlyPiece(piece, isWhite) || isWhite !== (myColor === "white")) {
          e.preventDefault();
          return;
        }
        
        draggedPiece = [r, c];
        sq.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
      });

      if (interactive) sq.addEventListener("dragend", (e) => {
        draggedPiece = null;
        sq.classList.remove("dragging");
      });

      // Drag over
      if (interactive) sq.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      });

      // Drop
      if (interactive) sq.addEventListener("drop", async (e) => {
        e.preventDefault();
        
        if (!draggedPiece) return;
        
        const [fr, fc] = draggedPiece;
        
        if (fr === r && fc === c) {
          draggedPiece = null;
          return;
        }
        
        let promotion = null;
        const movingPiece = board?.[fr]?.[fc] || "";
        if (isPromotionMove(fr, r, movingPiece)) {
          promotion = await requestPromotionChoice();
          if (!promotion) {
            draggedPiece = null;
            return;
          }
        }

        sendMove(fr, fc, r, c, promotion);
        draggedPiece = null;
        selected = null;
      });

      // Click for move confirmation
      if (interactive) sq.addEventListener("click", async () => {
        if (gameStatus.status === "checkmate" || gameStatus.status === "stalemate" || gameStatus.status === "draw" || gameStatus.status === "resigned") {
          log("Game is over!", "error");
          return;
        }

        if (turn !== myColor) {
          log("Not your turn!", "error");
          return;
        }

        if (pendingPower) {
          const powerType = pendingPower;
          pendingPower = null;
          selected = null;
          validMoves = [];
          sendPower(powerType, r, c);
          render();
          return;
        }

        if (selected) {
          const [sr, sc] = selected;
          if (sr === r && sc === c) {
            selected = null;
            validMoves = [];
            render();
            return;
          }

          let promotion = null;
          const movingPiece = board?.[sr]?.[sc] || "";
          if (isPromotionMove(sr, r, movingPiece)) {
            promotion = await requestPromotionChoice();
            if (!promotion) {
              selected = null;
              validMoves = [];
              render();
              return;
            }
          }

          sendMove(sr, sc, r, c, promotion);
          selected = null;
          validMoves = [];
          return;
        }

        const piece = board[r][c];
        if (!piece) {
          selected = null;
          validMoves = [];
          render();
          return;
        }

        // Only allow selecting friendly pieces
        const isWhite = window.ChessRules.isWhitePiece(piece);
        if (!window.ChessRules.isFriendlyPiece(piece, myColor === "white")) {
          log("You can only move your own pieces!", "error");
          return;
        }

        // Show moves for your own piece
        selected = [r, c];
        validMoves = getValidMovesPreview(r, c);
        const pieceName = window.ChessRules.getPieceType(piece).toUpperCase();
        log(`Selected ${pieceName} at [${r},${c}]. ${validMoves.length} moves found.`, "info");
        render();
      });


      targetEl.appendChild(sq);
    }
  }
}

function render() {
  if (!board) {
    // Lobby/open window: render preview board immediately.
    // IMPORTANT: keep `board` as an 8x8 array so the grid always renders correctly.
    board = [
      ["r","n","b","q","k","b","n","r"],
      ["p","p","p","p","p","p","p","p"],
      ["","","","","","","",""],
      ["","","","","","","",""],
      ["","","","","","","",""],
      ["","","","","","","",""],
      ["P","P","P","P","P","P","P","P"],
      ["R","N","B","Q","K","B","N","R"]
    ];
    turn = "white";
    selected = null;
    validMoves = [];

    boardEl.style.display = "grid";

    renderBoard(boardEl, board, { interactive: false });
    return;
  }

  boardEl.style.display = "grid";
  renderBoard(boardEl, board, { interactive: true });
}


function renderCaptured() {
  if (!whiteCapturedEl || !blackCapturedEl) return;

  const inGame = Boolean(window.room && window.myColor);

  // Show captured columns only during active match
  const captureColumns = document.querySelectorAll('.capture-column');
  captureColumns.forEach((el) => {
    el.style.display = inGame ? 'flex' : 'none';
  });

  // Keep board visible; this function is only about captured pieces.
  whiteCapturedEl.innerHTML = "";
  blackCapturedEl.innerHTML = "";
  if (whiteCapturedScoreEl) whiteCapturedScoreEl.textContent = "Points: 0";
  if (blackCapturedScoreEl) blackCapturedScoreEl.textContent = "Points: 0";

  if (!inGame) return;

  const capWhite = window.capturedWhite || [];
  const capBlack = window.capturedBlack || [];

  capWhite.forEach(piece => {
    const token = document.createElement("div");
    token.className = `capture-token ${window.ChessRules.isWhitePiece(piece) ? "piece-white" : "piece-black"}`;
    token.textContent = window.symbols[piece] || "";
    whiteCapturedEl.appendChild(token);
  });

  capBlack.forEach(piece => {
    const token = document.createElement("div");
    token.className = `capture-token ${window.ChessRules.isWhitePiece(piece) ? "piece-white" : "piece-black"}`;
    token.textContent = window.symbols[piece] || "";
    blackCapturedEl.appendChild(token);
  });

  const piecePoints = {
    p: 1, n: 3, b: 3, r: 5, q: 9
  };
  const sumCapturedPoints = (pieces) => pieces.reduce((sum, p) => {
    const key = String(p || "").toLowerCase();
    return sum + (piecePoints[key] || 0);
  }, 0);

  const whitePoints = sumCapturedPoints(capWhite);
  const blackPoints = sumCapturedPoints(capBlack);
  if (whiteCapturedScoreEl) whiteCapturedScoreEl.textContent = `Points: ${whitePoints}`;
  if (blackCapturedScoreEl) blackCapturedScoreEl.textContent = `Points: ${blackPoints}`;
}

function triggerCaptureEffect(r, c) {
  const sq = document.querySelector(`.square[data-pos="${r},${c}"]`);
  if (!sq) return;
  const rect = sq.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  // Reduced particle count for performance
  for (let i = 0; i < 8; i++) {
    const p = document.createElement("div");
    p.className = "particle";
    p.style.left = centerX + "px";
    p.style.top = centerY + "px";
    p.style.width = Math.random() * 6 + 2 + "px";
    p.style.height = p.style.width;
    p.style.backgroundColor = i % 2 === 0 ? "#fff" : "#ff4d4d";
    
    const tx = (Math.random() - 0.5) * 150;
    const ty = (Math.random() - 0.5) * 150;
    p.style.setProperty("--tx", tx + "px");
    p.style.setProperty("--ty", ty + "px");
    
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 800);
  }
}

function triggerMoveTrail(from, to) {
  const fSq = document.querySelector(`.square[data-pos="${from[0]},${from[1]}"]`);
  const tSq = document.querySelector(`.square[data-pos="${to[0]},${to[1]}"]`);
  if (!fSq || !tSq) return;

  const fRect = fSq.getBoundingClientRect();
  const tRect = tSq.getBoundingClientRect();
  
  const startX = fRect.left + fRect.width / 2;
  const startY = fRect.top + fRect.height / 2;
  const endX = tRect.left + tRect.width / 2;
  const endY = tRect.top + tRect.height / 2;

  // Reduced steps for better performance
  const steps = 6;
  for (let i = 0; i <= steps; i++) {
    setTimeout(() => {
      const node = document.createElement("div");
      node.className = "trail-node";
      node.style.left = startX + (endX - startX) * (i / steps) + "px";
      node.style.top = startY + (endY - startY) * (i / steps) + "px";
      document.body.appendChild(node);
      setTimeout(() => node.remove(), 500);
    }, i * 30);
  }
}

// Attach to window
window.triggerCaptureEffect = triggerCaptureEffect;
window.triggerMoveTrail = triggerMoveTrail;

// Guaranteed initial render
try {
  boardEl.style.display = 'block';
  boardEl.style.visibility = 'visible';
  render();
  renderCaptured();
  belowBoardActionsEl.style.display = 'none';
} catch (e) {
  console.warn('Initial render failed', e);
}