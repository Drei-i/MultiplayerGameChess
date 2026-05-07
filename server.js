const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

app.use(express.static(__dirname));

const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const logger = {
  debug: (...args) => LOG_LEVEL === "debug" && console.log(...args),
  info: (...args) => ["debug","info"].includes(LOG_LEVEL) && console.log(...args),
  error: (...args) => console.error(...args),
};

const chessRules = require("./js/chess-rules.js");
const { 
  clone, getPieceType, isWhitePiece, isBlackPiece, isEnemyPiece, isFriendlyPiece, 
  getValidMoves, isMoveLegal, isSquareAttacked, isPathClear, findKing, isInCheck, 
  hasLegalMoves, getGameStatus 
} = chessRules;

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

const buildClientGameState = (game, boardOverride = null) => ({
  mode: game.mode,
  board: boardOverride ?? game.board,
  turn: game.turn,
  history: game.history,
  manualStatus: game.manualStatus,
  drawOfferFrom: game.drawOfferFrom,
  capturedWhite: game.capturedWhite,
  capturedBlack: game.capturedBlack,
  halfMoveClock: game.halfMoveClock,
  positionCounts: game.positionCounts,
  lastActivity: game.lastActivity,
  castling: game.castling,
  enPassantTarget: game.enPassantTarget,
  poweredKing: game.poweredKing
});

const emitGameUpdate = (room) => {
  const game = rooms[room];
  if (!game) return;

  const computedStatus = getGameStatus(game.board, game.turn, game);
  const gameStatus = game.manualStatus ? game.manualStatus : computedStatus;

  if (game.mode === GAME_MODES.FOG_OF_WAR) {
    for (const color of ["white", "black"]) {
      const socketId = game.players[color]?.socketId;
      if (!socketId) continue;
      const fogBoard = buildFogBoardForColor(game.board, color);
      io.to(socketId).emit("update", {
        ...buildClientGameState(game, fogBoard),
        gameStatus
      });
    }
    return;
  }

  io.to(room).emit("update", {
    ...buildClientGameState(game),
    gameStatus
  });
};

// =========================
// MOVE HANDLER
// =========================
const handleMove = (socket, data) => {
  if (!data || !Array.isArray(data.from) || !Array.isArray(data.to)) {
    return socket.emit("moveRejected", { reason: "Invalid data format" });
  }

  const game = rooms[data.room];
  if (!game) {
    return socket.emit("moveRejected", { reason: "Room not found" });
  }

  if (game.manualStatus) {
    return socket.emit("moveRejected", { reason: "Game is already over" });
  }

  const [sr, sc] = data.from;
  const [tr, tc] = data.to;

  if (!Number.isInteger(sr) || !Number.isInteger(sc) || !Number.isInteger(tr) || !Number.isInteger(tc)) {
    return socket.emit("moveRejected", { reason: "Invalid coordinates" });
  }

  if (sr < 0 || sr > 7 || sc < 0 || sc > 7 || tr < 0 || tr > 7 || tc < 0 || tc > 7) {
    return socket.emit("moveRejected", { reason: "Coordinates out of bounds" });
  }

  const piece = game.board[sr][sc];
  if (!piece) {
    return socket.emit("moveRejected", { reason: "No piece at source" });
  }

  const playerColor =
    game.players.white?.socketId === socket.id ? "white" :
    game.players.black?.socketId === socket.id ? "black" : null;

  if (!playerColor) {
    return socket.emit("moveRejected", { reason: "You are not part of this game" });
  }

  if (playerColor !== game.turn) {
    return socket.emit("moveRejected", { reason: `It is ${game.turn}'s turn` });
  }

  const isWhite = playerColor === "white";

  if (game.mode === GAME_MODES.POWERED_KING && isFrozenAt(game, playerColor, sr, sc)) {
    return socket.emit("moveRejected", { reason: "That piece is frozen for this turn" });
  }

  if (isFriendlyPiece(piece, isWhite)) {
    if (!isMoveLegal(game.board, [sr, sc], [tr, tc], isWhite, game)) {
      return socket.emit("moveRejected", { reason: "That move is not legal" });
    }
  } else {
    return socket.emit("moveRejected", { reason: "That piece is not yours" });
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

  game.board[tr][tc] = piece;
  game.board[sr][sc] = "";

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

  if (pieceType === "p") {
    if ((isWhite && tr === 0) || (!isWhite && tr === 7)) {
      const promo = String(data.promotion || "").toUpperCase().trim();
      const allowed = new Set(["Q", "R", "B", "N"]);
      const chosen = allowed.has(promo) ? promo : "Q";
      game.board[tr][tc] = isWhite ? chosen : chosen.toLowerCase();
      promoted = true;
      promotedTo = isWhite ? chosen : chosen.toLowerCase();
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

  if (game.mode === GAME_MODES.POWERED_KING) {
    decrementFrozenForColor(game, playerColor);
  }
  game.turn = game.turn === "white" ? "black" : "white";
  game.drawOfferFrom = null;

  if (game.history) {
    game.history.moves.push({
      kind: "move", by: playerColor, piece, from: [sr, sc], to: [tr, tc],
      captured: capturedPiece || null, promotedTo: promotedTo, at: Date.now()
    });
    game.history.boards.push(deepCloneBoard(game.board));
    if (game.history.moves.length > 200) {
      game.history.moves.shift();
      game.history.boards.shift();
    }
  }

  const stateKey = JSON.stringify({b: game.board, t: game.turn, c: game.castling, e: game.enPassantTarget});
  game.positionCounts[stateKey] = (game.positionCounts[stateKey] || 0) + 1;
  if (game.positionCounts[stateKey] >= 3) {
    game.manualStatus = { status: "draw", reason: "threefold repetition" };
  }

  logger.info(`✅ MOVE accepted: ${piece} from [${sr},${sc}] to [${tr},${tc}]`);
  socket.emit("moveConfirmed", { from: [sr, sc], to: [tr, tc], captured: capturedPiece, promoted });
  emitGameUpdate(data.room);
};

// =========================
// SOCKET EVENTS
// =========================
io.on("connection", (socket) => {
  logger.info("🟢 connected:", socket.id);

  socket.on("move", (data) => handleMove(socket, data));

  socket.on("reconnect", (data = {}) => {
    const { room, token } = data;
    const game = rooms[room];
    if (!game || !token) return;
    const isWhiteToken = game.players.white?.reconnectToken === token;
    const isBlackToken = game.players.black?.reconnectToken === token;
    const playerColor = isWhiteToken ? "white" : isBlackToken ? "black" : null;
    if (!playerColor) return;
    game.players[playerColor].socketId = socket.id;
    socket.join(room);
    socket.emit("start", { color: playerColor, room, mode: game.mode, token });
    emitGameUpdate(room);
  });

  socket.on("queue", (data = {}) => {
    const mode = normalizeMode(data.mode);
    if (!mode) return socket.emit("queueRejected", { reason: "Invalid mode" });
    removeSocketFromAllQueues(socket.id);
    queues[mode].push({ socketId: socket.id, queuedAt: Date.now() });
    socket.emit("queued", { mode, position: queues[mode].length });

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
      const whiteEntry = a.queuedAt <= b.queuedAt ? a : b;
      const blackEntry = whiteEntry === a ? b : a;
      const room = "room-" + Date.now();
      const tokenA = Math.random().toString(36).slice(2);
      const tokenB = Math.random().toString(36).slice(2);
      const game = {
        mode, board: START_BOARD(), turn: "white",
        players: {
          white: { socketId: whiteEntry.socketId, reconnectToken: tokenA },
          black: { socketId: blackEntry.socketId, reconnectToken: tokenB }
        },
        history: { boards: [deepCloneBoard(START_BOARD())], moves: [] },
        manualStatus: null, drawOfferFrom: null, capturedWhite: [], capturedBlack: [],
        halfMoveClock: 0, positionCounts: {}, lastActivity: Date.now(),
        castling: { white: { kingside: true, queenside: true }, black: { kingside: true, queenside: true } },
        enPassantTarget: null,
        poweredKing: mode === GAME_MODES.POWERED_KING ? { swapsLeft: { white: 5, black: 5 }, frozen: { white: {}, black: {} } } : null
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
    const game = rooms[data.room];
    if (!game) return socket.emit("resignRejected", { reason: "Room not found" });
    const playerColor = game.players.white?.socketId === socket.id ? "white" : game.players.black?.socketId === socket.id ? "black" : null;
    if (!playerColor || game.manualStatus) return socket.emit("resignRejected");
    game.manualStatus = { status: "resigned", winner: getOpponentColor(playerColor) };
    socket.emit("resignConfirmed");
    emitGameUpdate(data.room);
  });

  socket.on("offerDraw", (data = {}) => {
    const game = rooms[data.room];
    if (!game) return socket.emit("drawOfferRejected", { reason: "Room not found" });
    const playerColor = game.players.white?.socketId === socket.id ? "white" : game.players.black?.socketId === socket.id ? "black" : null;
    if (!playerColor || game.manualStatus || game.drawOfferFrom) return socket.emit("drawOfferRejected");
    game.drawOfferFrom = playerColor;
    socket.emit("drawOfferSent");
    const oppSocketId = game.players[getOpponentColor(playerColor)]?.socketId;
    if (oppSocketId) io.to(oppSocketId).emit("drawOffered", { from: playerColor });
  });

  socket.on("respondDraw", (data = {}) => {
    const game = rooms[data.room];
    if (!game || !game.drawOfferFrom) return socket.emit("drawResponseRejected");
    const playerColor = game.players.white?.socketId === socket.id ? "white" : game.players.black?.socketId === socket.id ? "black" : null;
    if (!playerColor || playerColor === game.drawOfferFrom) return socket.emit("drawResponseRejected");
    const accept = Boolean(data.accept);
    const offererColor = game.drawOfferFrom;
    const offererSocketId = game.players[offererColor]?.socketId;
    game.drawOfferFrom = null;
    if (accept) {
      game.manualStatus = { status: "draw" };
      socket.emit("drawAccepted");
      if (offererSocketId) io.to(offererSocketId).emit("drawAccepted");
      emitGameUpdate(data.room);
    } else {
      socket.emit("drawRejected");
      if (offererSocketId) io.to(offererSocketId).emit("drawRejected");
    }
  });

  socket.on("kingPower", (data = {}) => {
    if (!data || typeof data.type !== 'string' || !Array.isArray(data.target)) {
      return socket.emit("powerRejected", { reason: "Invalid data format" });
    }
    const game = rooms[data.room];
    if (!game || game.mode !== GAME_MODES.POWERED_KING) return socket.emit("powerRejected");
    const playerColor = game.players.white?.socketId === socket.id ? "white" : game.players.black?.socketId === socket.id ? "black" : null;
    if (!playerColor || game.turn !== playerColor) return socket.emit("powerRejected");

    const [tr, tc] = data.target;
    if (data.type === "freeze") {
      const targetPiece = game.board[tr][tc];
      if (!targetPiece || isFriendlyPiece(targetPiece, playerColor === "white")) return socket.emit("powerRejected");
      const oppColor = getOpponentColor(playerColor);
      if (!game.poweredKing.frozen[oppColor]) game.poweredKing.frozen[oppColor] = {};
      game.poweredKing.frozen[oppColor][coordKey(tr, tc)] = 2;
      socket.emit("powerConfirmed", { type: "freeze" });
      game.turn = oppColor;
      emitGameUpdate(data.room);
    } else if (data.type === "teleport") {
      if (game.board[tr][tc]) return socket.emit("powerRejected");
      if (isSquareAttacked(game.board, tr, tc, playerColor === "black")) return socket.emit("powerRejected");
      const kingPos = findKing(game.board, playerColor === "white");
      game.board[tr][tc] = game.board[kingPos[0]][kingPos[1]];
      game.board[kingPos[0]][kingPos[1]] = "";
      socket.emit("powerConfirmed", { type: "teleport" });
      game.turn = getOpponentColor(playerColor);
      emitGameUpdate(data.room);
    } else if (data.type === "swap") {
      if (game.poweredKing.swapsLeft[playerColor] <= 0) return socket.emit("powerRejected");
      const targetPiece = game.board[tr][tc];
      if (!targetPiece || !isFriendlyPiece(targetPiece, playerColor === "white") || isKingPiece(targetPiece)) return socket.emit("powerRejected");
      const kingPos = findKing(game.board, playerColor === "white");
      const kingChar = game.board[kingPos[0]][kingPos[1]];
      game.board[kingPos[0]][kingPos[1]] = targetPiece;
      game.board[tr][tc] = kingChar;
      game.poweredKing.swapsLeft[playerColor]--;
      socket.emit("powerConfirmed", { type: "swap" });
      game.turn = getOpponentColor(playerColor);
      emitGameUpdate(data.room);
    }
  });

  socket.on("disconnect", () => {
    logger.info("🔴 disconnected:", socket.id);
    removeSocketFromAllQueues(socket.id);
  });
});

const runGarbageCollection = () => {
  const MAX_ROOMS = 1000;
  const roomKeys = Object.keys(rooms);
  logger.info(`[GC] Current room count: ${roomKeys.length}`);
  if (roomKeys.length > MAX_ROOMS) {
    const sortedRooms = roomKeys.sort((a, b) => rooms[a].lastActivity - rooms[b].lastActivity);
    sortedRooms.slice(0, roomKeys.length - MAX_ROOMS).forEach(r => delete rooms[r]);
  }
  const now = Date.now();
  for (const room in rooms) {
    const game = rooms[room];
    const inactiveMs = now - (game.lastActivity || now);
    if (inactiveMs > 60 * 60 * 1000) delete rooms[room];
  }
};
setInterval(runGarbageCollection, 60 * 1000);

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});