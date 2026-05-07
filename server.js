const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

app.use(express.static(__dirname));

// =========================
// MATCHMAKING
// =========================
const GAME_MODES = {
  REGULAR: "regular",
  POWERED_KING: "powered-king",
  FOG_OF_WAR: "fog-of-war"
};

const queues = {
  [GAME_MODES.REGULAR]: [],
  [GAME_MODES.POWERED_KING]: [],
  [GAME_MODES.FOG_OF_WAR]: []
};

let rooms = {};

const START_BOARD = () => ([
  ["r","n","b","q","k","b","n","r"],
  ["p","p","p","p","p","p","p","p"],
  ["","","","","","","",""],
  ["","","","","","","",""],
  ["","","","","","","",""],
  ["","","","","","","",""],
  ["P","P","P","P","P","P","P","P"],
  ["R","N","B","Q","K","B","N","R"]
]);

const clone = b => b.map(r => [...r]);

const deepCloneBoard = (b) => clone(b);

const normalizeMode = (mode) => {
  if (!mode) return null;
  const m = String(mode).toLowerCase().trim();
  if (m === GAME_MODES.REGULAR) return GAME_MODES.REGULAR;
  if (m === GAME_MODES.POWERED_KING) return GAME_MODES.POWERED_KING;
  if (m === GAME_MODES.FOG_OF_WAR) return GAME_MODES.FOG_OF_WAR;
  return null;
};

const removeSocketFromAllQueues = (socketId) => {
  for (const mode of Object.keys(queues)) {
    const q = queues[mode];
    const idx = q.findIndex(e => e.socketId === socketId);
    if (idx !== -1) q.splice(idx, 1);
  }
};

const getOpponentColor = (color) => (color === "white" ? "black" : "white");

const isKingPiece = (piece) => getPieceType(piece) === "k";

const coordKey = (r, c) => `${r},${c}`;

const decrementFrozenForColor = (game, color) => {
  if (!game.poweredKing?.frozen?.[color]) return;
  const map = game.poweredKing.frozen[color];
  for (const k of Object.keys(map)) {
    map[k] -= 1;
    if (map[k] <= 0) delete map[k];
  }
};

const isFrozenAt = (game, color, r, c) => {
  const key = coordKey(r, c);
  return Boolean(game.poweredKing?.frozen?.[color]?.[key] > 0);
};

const buildFogBoardForColor = (board, color) => {
  const isWhite = color === "white";
  const visible = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => false));

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;
      if (!isFriendlyPiece(piece, isWhite)) continue;

      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue;
          visible[nr][nc] = true;
        }
      }
    }
  }

  const masked = clone(board);
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (!visible[r][c]) masked[r][c] = "";
    }
  }
  return masked;
};

const emitGameUpdate = (room) => {
  const game = rooms[room];
  if (!game) return;

  const computedStatus = getGameStatus(game.board, game.turn, game);
  const gameStatus = game.manualStatus ? game.manualStatus : computedStatus;

  const basePayload = {
    ...game,
    gameStatus
  };

  if (game.mode === GAME_MODES.FOG_OF_WAR) {
    for (const color of ["white", "black"]) {
      const socketId = game.players[color]?.socketId;
      if (!socketId) continue;
      const fogBoard = buildFogBoardForColor(game.board, color);
      io.to(socketId).emit("update", { ...basePayload, board: fogBoard });
    }
    return;
  }


  io.to(room).emit("update", basePayload);

};

// =========================
// CHESS RULES
// =========================
const getPieceType = (piece) => {
  if (!piece) return null;
  return piece.toLowerCase();
};

const isWhitePiece = (piece) => piece === piece.toUpperCase();
const isBlackPiece = (piece) => piece === piece.toLowerCase() && piece !== "";

const isEnemyPiece = (piece, isWhite) => {
  if (!piece) return false;
  return isWhite ? isBlackPiece(piece) : isWhitePiece(piece);
};

const isFriendlyPiece = (piece, isWhite) => {
  if (!piece) return false;
  return isWhite ? isWhitePiece(piece) : isBlackPiece(piece);
};

// Get all valid moves for a piece
const getValidMoves = (board, r, c, isWhite, game = {}) => {
  const piece = board[r][c];
  if (!piece) return [];
  
  const type = getPieceType(piece);
  const moves = [];
  
  const addMove = (nr, nc) => {
    if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
      const target = board[nr][nc];
      if (!target || isEnemyPiece(target, isWhite)) {
        moves.push([nr, nc]);
      }
    }
  };
  
  const addSlide = (dr, dc) => {
    for (let i = 1; i < 8; i++) {
      const nr = r + dr * i;
      const nc = c + dc * i;
      if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8) break;
      
      const target = board[nr][nc];
      if (!target) {
        moves.push([nr, nc]);
      } else {
        if (isEnemyPiece(target, isWhite)) {
          moves.push([nr, nc]);
        }
        break;
      }
    }
  };
  
  const canCastle = (side) => {
    if (!game.castling) return false;
    const colorKey = isWhite ? "white" : "black";
    const rights = game.castling[colorKey];
    if (!rights || !rights[side]) return false;

    const row = isWhite ? 7 : 0;
    const targetCols = side === "kingside" ? [5, 6] : [3, 2];
    const rookCol = side === "kingside" ? 7 : 0;

    if (board[row][rookCol].toLowerCase() !== "r") return false;
    if (board[row][rookCol] === "" || !isFriendlyPiece(board[row][rookCol], isWhite)) return false;

    const path = side === "kingside" ? [[row,5],[row,6]] : [[row,1],[row,2],[row,3]];
    if (path.some(([pr, pc]) => board[pr][pc])) return false;
    if (isInCheck(board, isWhite)) return false;
    const passingSquares = side === "kingside" ? [[row,5],[row,6]] : [[row,3],[row,2]];
    if (passingSquares.some(([pr, pc]) => isSquareAttacked(board, pr, pc, !isWhite))) return false;
    return true;
  };
  
  if (type === "p") {
    const dir = isWhite ? -1 : 1;
    const startRow = isWhite ? 6 : 1;
    
    // Forward move
    const forwardRow = r + dir;
    if (forwardRow >= 0 && forwardRow < 8 && !board[forwardRow][c]) {
      moves.push([forwardRow, c]);
      
      // Double move from start
      if (r === startRow) {
        const doubleRow = r + 2 * dir;
        if (!board[doubleRow][c]) {
          moves.push([doubleRow, c]);
        }
      }
    }
    
    // Captures
    [-1, 1].forEach(dcol => {
      const nr = r + dir;
      const nc = c + dcol;
      if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
        const target = board[nr][nc];
        if (isEnemyPiece(target, isWhite)) {
          moves.push([nr, nc]);
        } else if (game.enPassantTarget && nr === game.enPassantTarget[0] && nc === game.enPassantTarget[1]) {
          moves.push([nr, nc]);
        }
      }
    });
  } else if (type === "n") {
    [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]].forEach(([dr, dc]) => {
      addMove(r + dr, c + dc);
    });
  } else if (type === "b") {
    [[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([dr, dc]) => addSlide(dr, dc));
  } else if (type === "r") {
    [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dr, dc]) => addSlide(dr, dc));
  } else if (type === "q") {
    [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([dr, dc]) => addSlide(dr, dc));
  } else if (type === "k") {
    [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([dr, dc]) => {
      addMove(r + dr, c + dc);
    });
    
    if (game.castling) {
      if (canCastle("kingside")) moves.push([r, 6]);
      if (canCastle("queenside")) moves.push([r, 2]);
    }
  }
  
  return moves;
};

const isMoveLegal = (board, from, to, isWhite, game = {}) => {
  const [fr, fc] = from;
  const [tr, tc] = to;
  
  if (fr === tr && fc === tc) return false;
  
  const piece = board[fr][fc];
  if (!piece) return false;
  if (isFriendlyPiece(board[tr][tc], isWhite)) return false;
  
  const validMoves = getValidMoves(board, fr, fc, isWhite, game);
  if (!validMoves.some(([vr, vc]) => vr === tr && vc === tc)) return false;
  
  // Simulate the move and check if king is in check
  const testBoard = clone(board);
  testBoard[tr][tc] = piece;
  testBoard[fr][fc] = "";
  
  if (getPieceType(piece) === "p" && game.enPassantTarget && tr === game.enPassantTarget[0] && tc === game.enPassantTarget[1] && fc !== tc) {
    const capturedPawnRow = tr + (isWhite ? 1 : -1);
    testBoard[capturedPawnRow][tc] = "";
  }
  
  if (isInCheck(testBoard, isWhite)) return false;
  
  return true;
};

// =========================
// CHECK & CHECKMATE LOGIC
// =========================
const isSquareAttacked = (board, r, c, byWhite) => {
  // Check if square (r,c) is attacked by pieces of color byWhite
  
  for (let sr = 0; sr < 8; sr++) {
    for (let sc = 0; sc < 8; sc++) {
      const piece = board[sr][sc];
      if (!piece) continue;
      
      const pieceIsWhite = isWhitePiece(piece);
      if (pieceIsWhite !== byWhite) continue;
      
      const type = getPieceType(piece);
      
      // Check if this piece can attack the target square
      if (type === "p") {
        const dir = byWhite ? -1 : 1;
        if (sr + dir === r && Math.abs(sc - c) === 1) return true;
      } else if (type === "n") {
        const dr = Math.abs(sr - r);
        const dc = Math.abs(sc - c);
        if ((dr === 2 && dc === 1) || (dr === 1 && dc === 2)) return true;
      } else if (type === "b") {
        if (Math.abs(sr - r) === Math.abs(sc - c)) {
          if (isPathClear(board, sr, sc, r, c)) return true;
        }
      } else if (type === "r") {
        if ((sr === r || sc === c)) {
          if (isPathClear(board, sr, sc, r, c)) return true;
        }
      } else if (type === "q") {
        if ((sr === r || sc === c) || (Math.abs(sr - r) === Math.abs(sc - c))) {
          if (isPathClear(board, sr, sc, r, c)) return true;
        }
      } else if (type === "k") {
        if (Math.abs(sr - r) <= 1 && Math.abs(sc - c) <= 1) return true;
      }
    }
  }
  
  return false;
};

const isPathClear = (board, r1, c1, r2, c2) => {
  // Check if path from (r1,c1) to (r2,c2) is clear (excluding source and target)
  const dr = r2 > r1 ? 1 : r2 < r1 ? -1 : 0;
  const dc = c2 > c1 ? 1 : c2 < c1 ? -1 : 0;
  
  let r = r1 + dr;
  let c = c1 + dc;
  
  // Check all squares between source and target (not including target)
  while (r !== r2 || c !== c2) {
    if (board[r][c]) return false;
    r += dr;
    c += dc;
  }
  
  return true;
};

const findKing = (board, isWhite) => {
  const target = isWhite ? "K" : "k";
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c] === target) return [r, c];
    }
  }
  return null;
};

const isInCheck = (board, isWhite) => {
  const kingPos = findKing(board, isWhite);
  if (!kingPos) return false;
  
  const [kr, kc] = kingPos;
  const inCheck = isSquareAttacked(board, kr, kc, !isWhite);
  return inCheck;
};

const hasLegalMoves = (board, isWhite, game = {}) => {
  const color = isWhite ? "white" : "black";
  let movesChecked = 0;
  const pieceMoves = {};
  
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece || !isFriendlyPiece(piece, isWhite)) continue;
      
      const validMoves = getValidMoves(board, r, c, isWhite, game);
      if (validMoves.length === 0) continue;
      
      const pieceName = `${piece}@[${r},${c}]`;
      pieceMoves[pieceName] = [];
      
      for (const [tr, tc] of validMoves) {
        movesChecked++;
        
        // Simulate the move on a test board
        const testBoard = clone(board);
        if (getPieceType(piece) === "p" && game.enPassantTarget && tr === game.enPassantTarget[0] && tc === game.enPassantTarget[1] && c !== tc) {
          const capturedPawnRow = tr + (isWhite ? 1 : -1);
          testBoard[capturedPawnRow][tc] = "";
        }
        
        testBoard[tr][tc] = piece;
        testBoard[r][c] = "";
        
        const stillInCheck = isInCheck(testBoard, isWhite);
        
        if (!stillInCheck) {
          console.log(`✅ LEGAL MOVE FOUND: ${piece} from [${r},${c}] to [${tr},${tc}]${board[tr][tc] ? ` (captures ${board[tr][tc]})` : ""}`);
          pieceMoves[pieceName].push(`[${tr},${tc}]LEGAL`);
          return true;
        } else {
          pieceMoves[pieceName].push(`[${tr},${tc}]blocked`);
        }
      }
    }
  }
  
  console.log(`❌ NO LEGAL MOVES for ${color}.`);
  console.log(`   Pieces with moves and their outcomes:`);
  Object.entries(pieceMoves).forEach(([piece, moves]) => {
    console.log(`     ${piece}: ${moves.join(", ")}`);
  });
  console.log(`   Total move combinations checked: ${movesChecked}`);
  return false;
};

const getGameStatus = (board, turn, game = {}) => {
  const isWhiteTurn = turn === "white";
  
  if (game.halfMoveClock >= 100) {
    console.log(`🤝 DRAW! Fifty-move rule.`);
    return { status: "draw", reason: "fifty-move rule" };
  }

  const pieces = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c]) pieces.push(board[r][c].toLowerCase());
    }
  }
  
  const pCount = pieces.length;
  if (pCount === 2) {
    return { status: "draw", reason: "insufficient material" };
  } else if (pCount === 3) {
    if (pieces.includes("n") || pieces.includes("b")) {
      return { status: "draw", reason: "insufficient material" };
    }
  }

  const inCheck = isInCheck(board, isWhiteTurn);
  const hasMovesAvailable = hasLegalMoves(board, isWhiteTurn, game);
  
  console.log(`📊 Game Status Check for ${turn}: inCheck=${inCheck}, hasMovesAvailable=${hasMovesAvailable}`);
  
  if (inCheck) {
    if (!hasMovesAvailable) {
      console.log(`🏁 CHECKMATE! ${isWhiteTurn ? "Black" : "White"} wins!`);
      return { status: "checkmate", winner: isWhiteTurn ? "black" : "white" };
    }
    console.log(`⚠️  CHECK! ${turn} is in check but has legal moves.`);
    return { status: "check" };
  }
  
  if (!hasMovesAvailable) {
    console.log(`🤝 STALEMATE! The game is a draw.`);
    return { status: "stalemate" };
  }
  
  return { status: "active" };
};

// =========================
// SOCKET CONNECTION
// =========================
// =========================
// MOVE HANDLER (WITH VALIDATION & LOGGING)
// =========================
const handleMove = (socket, data) => {

  console.log("📩 MOVE received:", JSON.stringify(data));

  const game = rooms[data.room];
  if (!game) {
    console.log("❌ MOVE rejected: room not found");
    socket.emit("moveRejected", { reason: "Room not found" });
    return;
  }

  if (game.manualStatus) {
    console.log("❌ MOVE rejected: game already ended");
    socket.emit("moveRejected", { reason: "Game is already over" });
    return;
  }

  const [sr, sc] = data.from;
  const [tr, tc] = data.to;

  // Validate coordinates
  if (!Number.isInteger(sr) || !Number.isInteger(sc) || !Number.isInteger(tr) || !Number.isInteger(tc)) {
    console.log("❌ MOVE rejected: invalid coordinates");
    socket.emit("moveRejected", { reason: "Invalid coordinates" });
    return;
  }

  if (sr < 0 || sr > 7 || sc < 0 || sc > 7 || tr < 0 || tr > 7 || tc < 0 || tc > 7) {
    console.log("❌ MOVE rejected: coordinates out of bounds");
    socket.emit("moveRejected", { reason: "Coordinates out of bounds" });
    return;
  }

  const piece = game.board[sr][sc];
  if (!piece) {
    console.log("❌ MOVE rejected: no piece at source");
    socket.emit("moveRejected", { reason: "No piece at source" });
    return;
  }

    const playerColor =
    game.players.white?.socketId === socket.id ? "white" :
    game.players.black?.socketId === socket.id ? "black" : null;

  if (!playerColor) {
    console.log("❌ MOVE rejected: player not in game");
    socket.emit("moveRejected", { reason: "You are not part of this game" });
    return;
  }

  // Check if it's the player's turn
  if (playerColor !== game.turn) {
    console.log(`❌ MOVE rejected: not player's turn (player: ${playerColor}, turn: ${game.turn})`);
    socket.emit("moveRejected", { reason: `It is ${game.turn}'s turn` });
    return;
  }

  const isWhite = playerColor === "white";

  if (game.mode === GAME_MODES.POWERED_KING && isFrozenAt(game, playerColor, sr, sc)) {
    console.log("❌ MOVE rejected: selected piece is frozen");
    socket.emit("moveRejected", { reason: "That piece is frozen for this turn" });
    return;
  }

  // Check if piece belongs to player
  if (isFriendlyPiece(piece, isWhite)) {
    // Validate move according to chess rules
    if (!isMoveLegal(game.board, [sr, sc], [tr, tc], isWhite, game)) {
      console.log("❌ MOVE rejected: illegal move");
      socket.emit("moveRejected", { reason: "That move is not legal" });
      return;
    }
  } else {
    console.log("❌ MOVE rejected: piece does not belong to player");
    socket.emit("moveRejected", { reason: "That piece is not yours" });
    return;
  }

  const pieceType = getPieceType(piece);
  let capturedPiece = game.board[tr][tc];
  let promoted = false;
  let promotedTo = null;

  game.lastActivity = Date.now();
  if (pieceType === "p" || capturedPiece) {
    game.halfMoveClock = 0;
  } else {
    game.halfMoveClock++;
  }

  // Special en passant capture
  if (pieceType === "p" && game.enPassantTarget && tr === game.enPassantTarget[0] && tc === game.enPassantTarget[1] && sc !== tc) {
    const capturedPawnRow = tr + (isWhite ? 1 : -1);
    capturedPiece = game.board[capturedPawnRow][tc];
    game.board[capturedPawnRow][tc] = "";
  }

  if (capturedPiece) {
    if (isWhite) {
      game.capturedWhite.push(capturedPiece);
    } else {
      game.capturedBlack.push(capturedPiece);
    }
  }

  // Execute move
  game.board[tr][tc] = piece;
  game.board[sr][sc] = "";

  // Castling rook move
  if (pieceType === "k" && Math.abs(tc - sc) === 2) {
    const row = sr;
    if (tc === 6) {
      game.board[row][5] = game.board[row][7];
      game.board[row][7] = "";
    } else if (tc === 2) {
      game.board[row][3] = game.board[row][0];
      game.board[row][0] = "";
    }
  }

  // Handle pawn promotion
  if (pieceType === "p") {
    if ((isWhite && tr === 0) || (!isWhite && tr === 7)) {
      const promo = String(data.promotion || "").toUpperCase().trim();
      const allowed = new Set(["Q", "R", "B", "N"]);
      const chosen = allowed.has(promo) ? promo : "Q";

      game.board[tr][tc] = isWhite ? chosen : chosen.toLowerCase();
      promoted = true;
      promotedTo = isWhite ? chosen : chosen.toLowerCase();
      console.log(`♛ PAWN PROMOTED to ${chosen} at [${tr},${tc}]`);
    }

    if (Math.abs(tr - sr) === 2) {
      const dir = isWhite ? -1 : 1;
      game.enPassantTarget = [sr + dir, sc];
    } else {
      game.enPassantTarget = null;
    }
  } else {
    game.enPassantTarget = null;
  }


  // Update castling rights
  if (pieceType === "k") {
    const colorKey = isWhite ? "white" : "black";
    game.castling[colorKey].kingside = false;
    game.castling[colorKey].queenside = false;
  }
  if (pieceType === "r") {
    const colorKey = isWhite ? "white" : "black";
    if (sr === (isWhite ? 7 : 0) && sc === 0) game.castling[colorKey].queenside = false;
    if (sr === (isWhite ? 7 : 0) && sc === 7) game.castling[colorKey].kingside = false;
  }
  if (capturedPiece && getPieceType(capturedPiece) === "r") {
    const captColor = isWhite ? "black" : "white";
    if (tr === (captColor === "white" ? 7 : 0) && tc === 0) game.castling[captColor].queenside = false;
    if (tr === (captColor === "white" ? 7 : 0) && tc === 7) game.castling[captColor].kingside = false;
  }

  // Switch turn
  if (game.mode === GAME_MODES.POWERED_KING) {
    decrementFrozenForColor(game, playerColor);
  }
  game.turn = game.turn === "white" ? "black" : "white";
  game.drawOfferFrom = null;

  if (game.history) {
    const MAX_HISTORY = 200;

    game.history.moves.push({
      kind: "move",
      by: playerColor,
      piece,
      from: [sr, sc],
      to: [tr, tc],
      captured: capturedPiece || null,
      promotedTo: promotedTo,
      at: Date.now()
    });
    game.history.boards.push(deepCloneBoard(game.board));

    if (game.history.moves.length > MAX_HISTORY) {
      game.history.moves.shift();
      game.history.boards.shift();
    }
  }

  const stateKey = JSON.stringify({b: game.board, t: game.turn, c: game.castling, e: game.enPassantTarget});
  game.positionCounts[stateKey] = (game.positionCounts[stateKey] || 0) + 1;
  if (game.positionCounts[stateKey] >= 3) {
    game.manualStatus = { status: "draw", reason: "threefold repetition" };
  }

  console.log(`✅ MOVE accepted: ${piece} from [${sr},${sc}] to [${tr},${tc}]${capturedPiece ? ` (captured ${capturedPiece})` : ""}${promoted ? " [PROMOTED]" : ""}`);
  
  // Emit successful move to requesting player
  socket.emit("moveConfirmed", { from: [sr, sc], to: [tr, tc], captured: capturedPiece, promoted });

  // Emit updated game state
  emitGameUpdate(data.room);
};

io.on("connection", (socket) => {

  console.log("🟢 connected:", socket.id);

  // Register move handler for this socket
  socket.on("move", (data) => handleMove(socket, data));

  // Allow client refresh to reconnect to the existing match using a token.
  socket.on("reconnect", (data = {}) => {
    const { room, token } = data;
    const game = rooms[room];
    if (!game || !token) return;

    const isWhiteToken = game.players.white?.reconnectToken === token;
    const isBlackToken = game.players.black?.reconnectToken === token;
    const playerColor = isWhiteToken ? "white" : isBlackToken ? "black" : null;
    if (!playerColor) return;

    // Rebind this socket to the player color.
    game.players[playerColor].socketId = socket.id;

    socket.join(room);
    // Re-send start + current game snapshot.
    socket.emit("start", { color: playerColor, room, mode: game.mode, token });

    // Reset transient client/UI state by pushing the authoritative server state.
    // IMPORTANT: do NOT change game.turn here; refresh must not affect whose turn it is.
    emitGameUpdate(room);
  });



  socket.on("queue", (data = {}) => {
    const mode = normalizeMode(data.mode);
    if (!mode) {
      socket.emit("queueRejected", { reason: "Invalid mode" });
      return;
    }

    removeSocketFromAllQueues(socket.id);

    const entry = { socketId: socket.id, queuedAt: Date.now() };
    queues[mode].push(entry);

    socket.emit("queued", {
      mode,
      position: queues[mode].length
    });

    // Try to match immediately if possible.
    if (queues[mode].length >= 2) {
      const a = queues[mode].shift();
      const b = queues[mode].shift();

      const p1 = io.sockets.sockets.get(a.socketId);
      const p2 = io.sockets.sockets.get(b.socketId);
      if (!p1 || !p2) {
        if (p1) queues[mode].unshift(a);
        if (p2) queues[mode].unshift(b);
        return;
      }

      // White = queued earlier.
      const whiteEntry = a.queuedAt <= b.queuedAt ? a : b;
      const blackEntry = whiteEntry === a ? b : a;

      const room = "room-" + Date.now();

      const tokenA = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      const tokenB = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

      const game = {
        mode,
        board: START_BOARD(),
        turn: "white",
        players: {
          white: { socketId: whiteEntry.socketId, reconnectToken: tokenA },
          black: { socketId: blackEntry.socketId, reconnectToken: tokenB }
        },

        history: {
          boards: [deepCloneBoard(START_BOARD())],
          moves: []
        },
        manualStatus: null,
        drawOfferFrom: null,
        capturedWhite: [],
        capturedBlack: [],
        halfMoveClock: 0,
        positionCounts: {},
        lastActivity: Date.now(),
        castling: {
          white: { kingside: true, queenside: true },
          black: { kingside: true, queenside: true }
        },
        enPassantTarget: null,
        poweredKing: mode === GAME_MODES.POWERED_KING ? {
          swapsLeft: { white: 5, black: 5 },
          frozen: { white: {}, black: {} }
        } : null
      };

      rooms[room] = game;

      p1.join(room);
      p2.join(room);

      io.to(whiteEntry.socketId).emit("start", { color: "white", room, mode, token: tokenA });
      io.to(blackEntry.socketId).emit("start", { color: "black", room, mode, token: tokenB });

      emitGameUpdate(room);
    }
  });

  socket.on("cancelQueue", () => {
    removeSocketFromAllQueues(socket.id);
    socket.emit("queueCancelled");
  });

  socket.on("resign", (data = {}) => {
    const room = data.room;
    const game = rooms[room];
    if (!game) {
      socket.emit("resignRejected", { reason: "Room not found" });
      return;
    }

    game.lastActivity = Date.now();
    const playerColor =
      game.players.white?.socketId === socket.id ? "white" :
      game.players.black?.socketId === socket.id ? "black" : null;

    if (!playerColor) {
      socket.emit("resignRejected", { reason: "You are not part of this game" });
      return;
    }

    if (game.manualStatus) {
      socket.emit("resignRejected", { reason: "Game is already over" });
      return;
    }

    game.manualStatus = { status: "resigned", winner: getOpponentColor(playerColor) };
    game.drawOfferFrom = null;

    socket.emit("resignConfirmed");
    emitGameUpdate(room);
  });

  socket.on("offerDraw", (data = {}) => {
    const room = data.room;
    const game = rooms[room];
    if (!game) {
      socket.emit("drawOfferRejected", { reason: "Room not found" });
      return;
    }

    game.lastActivity = Date.now();
    const playerColor =
      game.players.white?.socketId === socket.id ? "white" :
      game.players.black?.socketId === socket.id ? "black" : null;

    if (!playerColor) {
      socket.emit("drawOfferRejected", { reason: "You are not part of this game" });
      return;
    }

    if (game.manualStatus) {
      socket.emit("drawOfferRejected", { reason: "Game is already over" });
      return;
    }

    if (game.drawOfferFrom) {
      socket.emit("drawOfferRejected", { reason: "There is already a pending draw offer" });
      return;
    }

    game.drawOfferFrom = playerColor;
    socket.emit("drawOfferSent");

    const oppColor = getOpponentColor(playerColor);
    const oppSocketId = game.players[oppColor]?.socketId;
    if (oppSocketId) {
      io.to(oppSocketId).emit("drawOffered", { from: playerColor });
    }
  });

  socket.on("respondDraw", (data = {}) => {
    const room = data.room;
    const game = rooms[room];
    if (!game) {
      socket.emit("drawResponseRejected", { reason: "Room not found" });
      return;
    }

    game.lastActivity = Date.now();
    const playerColor =
      game.players.white?.socketId === socket.id ? "white" :
      game.players.black?.socketId === socket.id ? "black" : null;

    if (!playerColor) {
      socket.emit("drawResponseRejected", { reason: "You are not part of this game" });
      return;
    }

    if (game.manualStatus) {
      socket.emit("drawResponseRejected", { reason: "Game is already over" });
      return;
    }

    if (!game.drawOfferFrom) {
      socket.emit("drawResponseRejected", { reason: "There is no pending draw offer" });
      return;
    }

    // Only the non-offering player can respond.
    if (game.drawOfferFrom === playerColor) {
      socket.emit("drawResponseRejected", { reason: "Waiting for opponent response" });
      return;
    }

    const accept = Boolean(data.accept);
    const offererColor = game.drawOfferFrom;
    const offererSocketId = game.players[offererColor]?.socketId;
    game.drawOfferFrom = null;

    if (accept) {
      game.manualStatus = { status: "draw" };
      socket.emit("drawAccepted");
      if (offererSocketId) io.to(offererSocketId).emit("drawAccepted");
      emitGameUpdate(room);
      return;
    }

    socket.emit("drawRejected");
    if (offererSocketId) io.to(offererSocketId).emit("drawRejected");
  });

  socket.on("kingPower", (data = {}) => {
    const room = data.room;
    const game = rooms[room];
    if (!game) {
      socket.emit("powerRejected", { reason: "Room not found" });
      return;
    }

    if (game.mode !== GAME_MODES.POWERED_KING) {
      socket.emit("powerRejected", { reason: "This mode does not support king powers" });
      return;
    }

    game.lastActivity = Date.now();
    const playerColor =
      game.players.white?.socketId === socket.id ? "white" :
      game.players.black?.socketId === socket.id ? "black" : null;

    if (!playerColor) {
      socket.emit("powerRejected", { reason: "You are not part of this game" });
      return;
    }

    if (game.manualStatus) {
      socket.emit("powerRejected", { reason: "Game is already over" });
      return;
    }

    if (playerColor !== game.turn) {
      socket.emit("powerRejected", { reason: `It is ${game.turn}'s turn` });
      return;
    }

    const isWhite = playerColor === "white";
    const opponentColor = getOpponentColor(playerColor);

    const type = String(data.type || "").toLowerCase().trim();
    const target = Array.isArray(data.target) ? data.target : null;
    if (!target || target.length !== 2) {
      socket.emit("powerRejected", { reason: "Invalid target" });
      return;
    }
    const [tr, tc] = target;
    if (!Number.isInteger(tr) || !Number.isInteger(tc) || tr < 0 || tr > 7 || tc < 0 || tc > 7) {
      socket.emit("powerRejected", { reason: "Target out of bounds" });
      return;
    }

    const kingPos = findKing(game.board, isWhite);
    if (!kingPos) {
      socket.emit("powerRejected", { reason: "King not found" });
      return;
    }
    const [kr, kc] = kingPos;

    if (type === "freeze") {
      const victim = game.board[tr][tc];
      if (!victim || !isEnemyPiece(victim, isWhite)) {
        socket.emit("powerRejected", { reason: "You must target an enemy piece" });
        return;
      }
      if (isKingPiece(victim)) {
        socket.emit("powerRejected", { reason: "You cannot freeze the enemy king" });
        return;
      }
      game.poweredKing.frozen[opponentColor][coordKey(tr, tc)] = 1;
    } else if (type === "teleport") {
      if (game.board[tr][tc]) {
        socket.emit("powerRejected", { reason: "Teleport must target an empty square" });
        return;
      }

      // "Unprotected" = not attacked by enemy pieces.
      if (isSquareAttacked(game.board, tr, tc, !isWhite)) {
        socket.emit("powerRejected", { reason: "That square is protected by the enemy" });
        return;
      }

      const testBoard = clone(game.board);
      testBoard[tr][tc] = testBoard[kr][kc];
      testBoard[kr][kc] = "";
      if (isInCheck(testBoard, isWhite)) {
        socket.emit("powerRejected", { reason: "Teleport would leave your king in check" });
        return;
      }

      game.board[tr][tc] = game.board[kr][kc];
      game.board[kr][kc] = "";
      game.castling[playerColor].kingside = false;
      game.castling[playerColor].queenside = false;
    } else if (type === "swap") {
      const swapsLeft = game.poweredKing?.swapsLeft?.[playerColor] ?? 0;
      if (swapsLeft <= 0) {
        socket.emit("powerRejected", { reason: "No swaps remaining" });
        return;
      }

      const ally = game.board[tr][tc];
      if (!ally || !isFriendlyPiece(ally, isWhite)) {
        socket.emit("powerRejected", { reason: "You must target an allied piece" });
        return;
      }
      if (isKingPiece(ally)) {
        socket.emit("powerRejected", { reason: "You must target a non-king allied piece" });
        return;
      }

      const testBoard = clone(game.board);
      const kingPiece = testBoard[kr][kc];
      testBoard[kr][kc] = ally;
      testBoard[tr][tc] = kingPiece;
      if (isInCheck(testBoard, isWhite)) {
        socket.emit("powerRejected", { reason: "Swap would leave your king in check" });
        return;
      }

      const kingPiece2 = game.board[kr][kc];
      game.board[kr][kc] = ally;
      game.board[tr][tc] = kingPiece2;
      game.poweredKing.swapsLeft[playerColor] -= 1;
      game.castling[playerColor].kingside = false;
      game.castling[playerColor].queenside = false;
    } else {
      socket.emit("powerRejected", { reason: "Unknown power type" });
      return;
    }

    // Using a power consumes the turn.
    decrementFrozenForColor(game, playerColor);
    game.turn = game.turn === "white" ? "black" : "white";
    game.drawOfferFrom = null;
    game.halfMoveClock++;

    if (game.history) {
      const MAX_HISTORY = 200;
      game.history.moves.push({
        kind: "power",
        by: playerColor,
        power: type,
        target: [tr, tc],
        at: Date.now()
      });
      game.history.boards.push(deepCloneBoard(game.board));

      if (game.history.moves.length > MAX_HISTORY) {
        game.history.moves.shift();
        game.history.boards.shift();
      }
    }

    const stateKey = JSON.stringify({b: game.board, t: game.turn, c: game.castling, e: game.enPassantTarget});
    game.positionCounts[stateKey] = (game.positionCounts[stateKey] || 0) + 1;
    if (game.positionCounts[stateKey] >= 3) {
      game.manualStatus = { status: "draw", reason: "threefold repetition" };
    }

    socket.emit("powerConfirmed", { type, target: [tr, tc] });
    emitGameUpdate(room);
  });

  // Keep match state on refresh by allowing reconnection.
  // We don't destroy room on disconnect; we only remove from queues.
  socket.on("disconnect", () => {
    console.log("🔴 disconnected:", socket.id);
    removeSocketFromAllQueues(socket.id);
  });
});

const runGarbageCollection = () => {
  const now = Date.now();
  for (const room in rooms) {
    const game = rooms[room];
    const isOver = Boolean(game.manualStatus) || ["checkmate", "stalemate", "draw", "resigned"].includes(getGameStatus(game.board, game.turn, game).status);
    const inactiveMs = now - (game.lastActivity || now);
    
    if (inactiveMs > 60 * 60 * 1000 || (isOver && inactiveMs > 5 * 60 * 1000)) {
      console.log(`🧹 Garbage collecting room: ${room}`);
      delete rooms[room];
    }
  }
};

if (require.main === module) {
  setInterval(runGarbageCollection, 60 * 1000);
}

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  http.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = {
  GAME_MODES,
  START_BOARD,
  normalizeMode,
  buildFogBoardForColor,
  isMoveLegal,
  getValidMoves,
  runGarbageCollection
};
