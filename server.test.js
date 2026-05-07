const test = require("node:test");
const assert = require("node:assert/strict");
const {
  GAME_MODES,
  START_BOARD,
  normalizeMode,
  buildFogBoardForColor
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
