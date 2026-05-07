const clone = b => b.map(r => [...r]);

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

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    clone,
    getPieceType,
    isWhitePiece,
    isBlackPiece,
    isEnemyPiece,
    isFriendlyPiece,
    getValidMoves,
    isMoveLegal,
    isSquareAttacked,
    isPathClear,
    findKing,
    isInCheck,
    hasLegalMoves,
    getGameStatus
  };
}
else if (typeof window !== "undefined") {
  window.ChessRules = {
    clone,
    getPieceType,
    isWhitePiece,
    isBlackPiece,
    isEnemyPiece,
    isFriendlyPiece,
    getValidMoves,
    isMoveLegal,
    isSquareAttacked,
    isPathClear,
    findKing,
    isInCheck,
    hasLegalMoves,
    getGameStatus
  };
}