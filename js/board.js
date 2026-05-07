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

      const lastMove = matchHistory?.moves?.[matchHistory.moves.length - 1];
      if (lastMove && lastMove.from && lastMove.to) {
        if ((r === lastMove.from[0] && c === lastMove.from[1]) ||
            (r === lastMove.to[0] && c === lastMove.to[1])) {
          sq.classList.add("last-move");
        }
      }

      const piece = boardToRender[r][c];
      if (piece) {
        const pieceEl = document.createElement("span");
        const isKing = window.ChessRules.getPieceType(piece) === "k";
        const kingClass = (mode === "powered-king" && isKing) ? " piece-king" : "";
        pieceEl.className = `piece ${window.ChessRules.isWhitePiece(piece) ? "piece-white" : "piece-black"}${kingClass}`;
        pieceEl.textContent = symbols[piece] || "";
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
        }
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

        const isWhite = window.ChessRules.isWhitePiece(piece);
        if (!window.ChessRules.isFriendlyPiece(piece, isWhite) || isWhite !== (myColor === "white")) {
          log("That piece is not yours!", "error");
          selected = null;
          validMoves = [];
          render();
          return;
        }

        selected = [r, c];
        validMoves = getValidMovesPreview(r, c);
        log(`Selected piece at [${r},${c}]. ${validMoves.length} valid moves available.`, "info");
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

  const inGame = Boolean(room && myColor);

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

  capturedWhite.forEach(piece => {
    const token = document.createElement("div");
    token.className = `capture-token ${window.ChessRules.isWhitePiece(piece) ? "piece-white" : "piece-black"}`;
    token.textContent = symbols[piece] || "";
    whiteCapturedEl.appendChild(token);
  });

  capturedBlack.forEach(piece => {
    const token = document.createElement("div");
    token.className = `capture-token ${window.ChessRules.isWhitePiece(piece) ? "piece-white" : "piece-black"}`;
    token.textContent = symbols[piece] || "";
    blackCapturedEl.appendChild(token);
  });

  const piecePoints = {
    p: 1,
    n: 3,
    b: 3,
    r: 5,
    q: 9
  };
  const sumCapturedPoints = (pieces) => pieces.reduce((sum, p) => {
    const key = String(p || "").toLowerCase();
    return sum + (piecePoints[key] || 0);
  }, 0);

  const whitePoints = sumCapturedPoints(capturedWhite);
  const blackPoints = sumCapturedPoints(capturedBlack);
  if (whiteCapturedScoreEl) whiteCapturedScoreEl.textContent = `Points: ${whitePoints}`;
  if (blackCapturedScoreEl) blackCapturedScoreEl.textContent = `Points: ${blackPoints}`;
}

// Guaranteed initial render (opening/lobby window)
// Shows the starting board immediately and keeps captured/actions hidden.
try {
  boardEl.style.display = 'block';
  boardEl.style.visibility = 'visible';
  render();
  renderCaptured();
  belowBoardActionsEl.style.display = 'none';
} catch (e) {
  console.warn('Initial render failed', e);
}