
const clone = b => b.map(r => [...r]);

// =========================
// CHESS RULES (PRODUCTION PDC VERSION)
// =========================
const getPieceType = (p) => (p ? p.toLowerCase() : null);
const isWhitePiece = (p) => p && p !== "" && p === p.toUpperCase();
const isBlackPiece = (p) => p && p !== "" && p === p.toLowerCase();
const isEnemyPiece = (p, isWhite) => p && p !== "" && (isWhite ? isBlackPiece(p) : isWhitePiece(p));
const isFriendlyPiece = (p, isWhite) => p && p !== "" && (isWhite ? isWhitePiece(p) : isBlackPiece(p));

const getValidMoves = (board, r, c, isWhite, game = {}) => {
  const piece = board[r][c];
  if (!piece) return [];

  // Check if the piece is frozen (Powered King mode)
  if (game.poweredKing && game.poweredKing.frozen) {
    const color = isWhite ? "white" : "black";
    const frozenForMe = game.poweredKing.frozen[color];
    if (frozenForMe && frozenForMe[`${r},${c}`] > 0) {
      return [];
    }
  }

  const type = getPieceType(piece);
  const moves = [];

  const addMove = (nr, nc) => {
    if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
      const target = board[nr][nc];
      if (!target || isEnemyPiece(target, isWhite)) moves.push([nr, nc]);
    }
  };

  const addSlide = (dr, dc) => {
    for (let i = 1; i < 8; i++) {
      const nr = r + dr * i, nc = c + dc * i;
      if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8) break;
      const target = board[nr][nc];
      if (!target) { moves.push([nr, nc]); }
      else { if (isEnemyPiece(target, isWhite)) moves.push([nr, nc]); break; }
    }
  };

  if (type === "p") {
    const dir = isWhite ? -1 : 1, startRow = isWhite ? 6 : 1;
    const f1 = r + dir;
    if (f1 >= 0 && f1 < 8 && !board[f1][c]) {
      moves.push([f1, c]);
      const f2 = r + 2 * dir;
      if (r === startRow && f2 >= 0 && f2 < 8 && !board[f2][c]) moves.push([f2, c]);
    }
    [-1, 1].forEach(dc => {
      const nr = r + dir, nc = c + dc;
      if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
        const target = board[nr][nc];
        if (target && isEnemyPiece(target, isWhite)) moves.push([nr, nc]);
        else if (game.enPassantTarget && nr === game.enPassantTarget[0] && nc === game.enPassantTarget[1]) moves.push([nr, nc]);
      }
    });
  } else if (type === "n") { [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]].forEach(([dr, dc]) => addMove(r + dr, c + dc)); }
  else if (type === "b") { [[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([dr, dc]) => addSlide(dr, dc)); }
  else if (type === "r") { [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dr, dc]) => addSlide(dr, dc)); }
  else if (type === "q") { [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([dr, dc]) => addSlide(dr, dc)); }
  else if (type === "k") {
    [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([dr, dc]) => addMove(r + dr, c + dc));
    if (game.castling) {
      const colorKey = isWhite ? "white" : "black";
      const rights = game.castling[colorKey];
      const homeRow = isWhite ? 7 : 0;
      const rookChar = isWhite ? "R" : "r";
      if (rights && rights.kingside && board[homeRow][7] === rookChar && !board[r][5] && !board[r][6] && !isSquareAttacked(board, r, 4, !isWhite) && !isSquareAttacked(board, r, 5, !isWhite) && !isSquareAttacked(board, r, 6, !isWhite)) moves.push([r, 6]);
      if (rights && rights.queenside && board[homeRow][0] === rookChar && !board[r][1] && !board[r][2] && !board[r][3] && !isSquareAttacked(board, r, 4, !isWhite) && !isSquareAttacked(board, r, 3, !isWhite) && !isSquareAttacked(board, r, 2, !isWhite)) moves.push([r, 2]);
    }
  }
  return moves;
};

const isSquareAttacked = (board, r, c, byWhite) => {
  for (let sr = 0; sr < 8; sr++) {
    for (let sc = 0; sc < 8; sc++) {
      const p = board[sr][sc];
      if (p && isFriendlyPiece(p, byWhite)) {
        if (sr === r && sc === c) continue; // A piece doesn't attack its own square
        const type = getPieceType(p);
        if (type === "p") {
          const dir = byWhite ? -1 : 1;
          if (sr + dir === r && Math.abs(sc - c) === 1) return true;
        } else if (type === "n") {
          if ((Math.abs(sr - r) === 2 && Math.abs(sc - c) === 1) || (Math.abs(sr - r) === 1 && Math.abs(sc - c) === 2)) return true;
        } else if (type === "k") {
          if (Math.abs(sr - r) <= 1 && Math.abs(sc - c) <= 1) return true;
        } else {
          const moves = getValidMoves(board, sr, sc, byWhite, {});
          if (moves.some(([mr, mc]) => mr === r && mc === c)) return true;
        }
      }
    }
  }
  return false;
};

const isMoveLegal = (board, from, to, isWhite, game = {}) => {
  const [fr, fc] = from, [tr, tc] = to;
  const piece = board[fr][fc];
  if (!piece || !isFriendlyPiece(piece, isWhite)) return false;
  const moves = getValidMoves(board, fr, fc, isWhite, game);
  if (!moves.some(([mr, mc]) => mr === tr && mc === tc)) return false;
  const testBoard = clone(board);
  testBoard[tr][tc] = piece;
  testBoard[fr][fc] = "";
  if (getPieceType(piece) === "p" && game.enPassantTarget && tr === game.enPassantTarget[0] && tc === game.enPassantTarget[1]) {
    testBoard[fr][tc] = ""; // En passant capture
  }
  const kingPos = findKing(testBoard, isWhite);
  if (!kingPos || isSquareAttacked(testBoard, kingPos[0], kingPos[1], !isWhite)) return false;
  return true;
};

const findKing = (board, isWhite) => {
  const target = isWhite ? "K" : "k";
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (board[r][c] === target) return [r, c];
  return null;
};

const isInsufficientMaterial = (board) => {
  const pieces = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c]) pieces.push({ p: board[r][c], r, c });
    }
  }
  // K vs K
  if (pieces.length === 2) return true;
  // K+N vs K or K+B vs K
  if (pieces.length === 3) {
    const p = pieces.find(x => getPieceType(x.p) !== "k").p;
    const type = getPieceType(p);
    return type === "n" || type === "b";
  }
  // K+B vs K+B (if bishops are on same color)
  if (pieces.length === 4) {
    const nonKings = pieces.filter(x => getPieceType(x.p) !== "k");
    if (nonKings.length === 2 && getPieceType(nonKings[0].p) === "b" && getPieceType(nonKings[1].p) === "b") {
      const color1 = (nonKings[0].r + nonKings[0].c) % 2;
      const color2 = (nonKings[1].r + nonKings[1].c) % 2;
      return color1 === color2;
    }
  }
  return false;
};

const getGameStatus = (board, turn, game = {}) => {
  const isWhite = turn === "white";
  const king = findKing(board, isWhite);
  const inCheck = king ? isSquareAttacked(board, king[0], king[1], !isWhite) : false;
  
  // 1. Check for Fifty-Move Rule
  if (game.halfMoveClock >= 100) return { status: "draw", reason: "50-move rule" };

  // 2. Check for Threefold Repetition
  if (game.positionCounts) {
    const stateStr = JSON.stringify([board, turn, game.castling, game.enPassantTarget]);
    if (game.positionCounts[stateStr] >= 3) return { status: "draw", reason: "threefold repetition" };
  }

  // 3. Check for Insufficient Material
  if (isInsufficientMaterial(board)) return { status: "draw", reason: "insufficient material" };

  let hasMoves = false;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (isFriendlyPiece(board[r][c], isWhite)) {
        const moves = getValidMoves(board, r, c, isWhite, game);
        if (moves.some(m => isMoveLegal(board, [r, c], m, isWhite, game))) { hasMoves = true; break; }
      }
    }
    if (hasMoves) break;
  }
  if (!hasMoves) return inCheck ? { status: "checkmate", winner: isWhite ? "black" : "white" } : { status: "stalemate" };
  return inCheck ? { status: "check" } : { status: "active" };
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { clone, getPieceType, isWhitePiece, isBlackPiece, isEnemyPiece, isFriendlyPiece, getValidMoves, isMoveLegal, getGameStatus, findKing, isSquareAttacked, isInsufficientMaterial };
} else {
  window.ChessRules = { clone, getPieceType, isWhitePiece, isBlackPiece, isEnemyPiece, isFriendlyPiece, getValidMoves, isMoveLegal, getGameStatus, findKing, isSquareAttacked, isInsufficientMaterial };
}