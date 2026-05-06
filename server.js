const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

app.use(express.static(__dirname));

// =========================
// MATCHMAKING
// =========================
let waiting = null;
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
    game.players.white === socket.id ? "white" :
    game.players.black === socket.id ? "black" : null;

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
      game.board[tr][tc] = isWhite ? "Q" : "q";
      promoted = true;
      console.log(`♛ PAWN PROMOTED to queen at [${tr},${tc}]`);
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
  game.turn = game.turn === "white" ? "black" : "white";

  // Get game status
  const gameStatus = getGameStatus(game.board, game.turn, game);

  console.log(`✅ MOVE accepted: ${piece} from [${sr},${sc}] to [${tr},${tc}]${capturedPiece ? ` (captured ${capturedPiece})` : ""}${promoted ? " [PROMOTED]" : ""}`);
  
  if (gameStatus.status === "check") {
    console.log(`   ⚠️  ${game.turn.toUpperCase()} is in CHECK - must escape!`);
  } else if (gameStatus.status === "checkmate") {
    console.log(`   🏁 CHECKMATE! ${gameStatus.winner.toUpperCase()} WINS!`);
  } else if (gameStatus.status === "stalemate") {
    console.log(`   🤝 STALEMATE - Game is a draw`);
  }
  
  // Emit successful move to requesting player
  socket.emit("moveConfirmed", { from: [sr, sc], to: [tr, tc], captured: capturedPiece, promoted });

  // Broadcast update to room with game status
  io.to(data.room).emit("update", { ...game, gameStatus });
};

io.on("connection", (socket) => {

  console.log("🟢 connected:", socket.id);

  // Register move handler for this socket
  socket.on("move", (data) => handleMove(socket, data));

  socket.on("disconnect", () => {
    console.log("🔴 disconnected:", socket.id);
  });

  // pair players
  if (!waiting) {
    waiting = socket;
    socket.emit("waiting");
    return;
  }

  const p1 = waiting;
  const p2 = socket;
  waiting = null;

  const room = "room-" + Date.now();

  const game = {
    board: START_BOARD(),
    turn: "white",
    players: {
      white: p1.id,
      black: p2.id
    },
    capturedWhite: [],
    capturedBlack: [],
    castling: {
      white: { kingside: true, queenside: true },
      black: { kingside: true, queenside: true }
    },
    enPassantTarget: null
  };

  rooms[room] = game;

  p1.join(room);
  p2.join(room);

  p1.emit("start", { color: "white", room });
  p2.emit("start", { color: "black", room });

  const gameStatus = getGameStatus(game.board, game.turn, game);
  io.to(room).emit("update", { ...game, gameStatus });
});

http.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});