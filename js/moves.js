// PIECE VALIDATION (CLIENT-SIDE PREVIEW)
// =========================
function getPieceType(piece) {
  if (!piece) return null;
  return piece.toLowerCase();
}

function isWhitePiece(piece) {
  return piece === piece.toUpperCase();
}

function isBlackPiece(piece) {
  return piece === piece.toLowerCase() && piece !== "";
}

function isEnemyPiece(piece, isWhite) {
  if (!piece) return false;
  return isWhite ? isBlackPiece(piece) : isWhitePiece(piece);
}

function isFriendlyPiece(piece, isWhite) {
  if (!piece) return false;
  return isWhite ? isWhitePiece(piece) : isBlackPiece(piece);
}


// Compute valid moves for move preview (client-side only)
function getValidMoves(r, c) {
  if (!board) return [];
  
  const piece = board[r][c];
  if (!piece) return [];
  
  const isWhite = isWhitePiece(piece);
  if (isFriendlyPiece(piece, isWhite)) {
    // Only show valid moves if it's your turn and your piece
    if (turn !== myColor || isWhite !== (myColor === "white")) return [];
  } else {
    return [];
  }
  
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
  
  if (type === "p") {
    const dir = isWhite ? -1 : 1;
    const startRow = isWhite ? 6 : 1;
    
    const forwardRow = r + dir;
    if (forwardRow >= 0 && forwardRow < 8 && !board[forwardRow][c]) {
      moves.push([forwardRow, c]);
      if (r === startRow) {
        const doubleRow = r + 2 * dir;
        if (!board[doubleRow][c]) {
          moves.push([doubleRow, c]);
        }
      }
    }
    
    [-1, 1].forEach(dcol => {
      const nr = r + dir;
      const nc = c + dcol;
      if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
        const target = board[nr][nc];
        if (isEnemyPiece(target, isWhite)) {
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
  }
  
  return moves;
}

// =========================