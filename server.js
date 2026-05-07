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

// clone is now in chess-rules

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
// CHESS RULES (Imported)
// =========================
const chessRules = require("./js/chess-rules.js");
const { getPieceType, isWhitePiece, isBlackPiece, isEnemyPiece, isFriendlyPiece, getValidMoves, isMoveLegal, isSquareAttacked, isPathClear, findKing, isInCheck, hasLegalMoves, getGameStatus, clone } = chessRules;