const { io } = require('socket.io-client');
const chessRules = require('./js/chess-rules.js');

const SERVER_URL = 'http://localhost:3000';
const NUM_GAMES = 20; // Will create 2 * NUM_GAMES clients
const MOVE_INTERVAL_MS = 500; // How fast to move

console.log(`[LoadTest] Starting ${NUM_GAMES} simulated games...`);

for (let i = 0; i < NUM_GAMES; i++) {
  setTimeout(() => {
    createGamePair(i);
  }, i * 200); // Stagger game creation
}

function createGamePair(gameIndex) {
  const p1 = io(SERVER_URL);
  const p2 = io(SERVER_URL);
  
  let gameRoom = null;
  let board = null;
  let myColor1 = null;
  let myColor2 = null;

  p1.on('connect', () => p1.emit('queue', { mode: 'regular' }));
  p2.on('connect', () => p2.emit('queue', { mode: 'regular' }));

  p1.on('start', (data) => {
    myColor1 = data.color;
    gameRoom = data.room;
  });

  p2.on('start', (data) => {
    myColor2 = data.color;
    gameRoom = data.room;
  });

  const handleUpdate = (client, myColor) => (data) => {
    board = data.board;
    console.log(`[Game ${gameIndex}] Update received for ${myColor}. Turn: ${data.turn}`);
    if (data.turn === myColor && data.gameStatus && data.gameStatus.status === 'active') {
      setTimeout(() => {
        makeRandomValidMove(client, board, myColor, gameRoom, data);
      }, MOVE_INTERVAL_MS);
    }
  };

  p1.on('update', handleUpdate(p1, 'white')); // p1 will get 'white' updates
  p2.on('update', handleUpdate(p2, 'black')); // p2 will get 'black' updates

  p1.on('moveRejected', (data) => console.error(`[Game ${gameIndex}] P1 Move rejected:`, data));
  p2.on('moveRejected', (data) => console.error(`[Game ${gameIndex}] P2 Move rejected:`, data));
}

function makeRandomValidMove(client, board, color, room, gameData) {
  try {
    const isWhite = color === 'white';
    const allMoves = [];

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (chessRules.isFriendlyPiece(board[r][c], isWhite)) {
          const moves = chessRules.getValidMoves(board, r, c, isWhite, gameData);
          moves.forEach(m => {
            if (chessRules.isMoveLegal(board, [r, c], m, isWhite, gameData)) {
              allMoves.push({ from: [r, c], to: m });
            }
          });
        }
      }
    }

    console.log(`[Room ${room}] ${color} generated ${allMoves.length} valid moves`);

    if (allMoves.length > 0) {
      const move = allMoves[Math.floor(Math.random() * allMoves.length)];
      client.emit('move', { room, from: move.from, to: move.to });
    }
  } catch (err) {
    console.error(`Error generating move for ${color}:`, err);
  }
}
