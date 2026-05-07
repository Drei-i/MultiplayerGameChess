const test = require("node:test");
const assert = require("node:assert/strict");
const {
  GAME_MODES,
  START_BOARD,
  normalizeMode,
  buildFogBoardForColor,
  buildClientGameState
} = require("./server");

test("normalizeMode accepts known game modes", () => {
  assert.equal(normalizeMode("regular"), GAME_MODES.REGULAR);
  assert.equal(normalizeMode("powered-king"), GAME_MODES.POWERED_KING);
  assert.equal(normalizeMode("fog-of-war"), GAME_MODES.FOG_OF_WAR);
});

test("normalizeMode rejects invalid mode values", () => {
  assert.equal(normalizeMode("blitz"), null);
  assert.equal(normalizeMode(""), null);
  assert.equal(normalizeMode(null), null);
});

test("fog-of-war hides non-visible squares from white perspective", () => {
  const board = START_BOARD();
  const fogBoard = buildFogBoardForColor(board, "white");

  // White back-rank pieces remain visible.
  assert.equal(fogBoard[7][4], "K");
  // Black back-rank should be hidden at game start.
  assert.equal(fogBoard[0][4], "");
});

test("fog-of-war hides non-visible squares from black perspective", () => {
  const board = START_BOARD();
  const fogBoard = buildFogBoardForColor(board, "black");

  assert.equal(fogBoard[0][4], "k");
  assert.equal(fogBoard[7][4], "");
});

test("client game state excludes reconnect tokens and socket ids", () => {
  const game = {
    mode: GAME_MODES.REGULAR,
    board: START_BOARD(),
    turn: "white",
    players: {
      white: { socketId: "sock-1", reconnectToken: "secret-white" },
      black: { socketId: "sock-2", reconnectToken: "secret-black" }
    },
    history: { boards: [], moves: [] },
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
    poweredKing: null
  };

  const state = buildClientGameState(game);

  assert.equal(state.players, undefined);
  assert.equal(JSON.stringify(state).includes("reconnectToken"), false);
  assert.equal(JSON.stringify(state).includes("socketId"), false);
});
