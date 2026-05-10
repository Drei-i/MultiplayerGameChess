/**
 * ============================================================================
 * MULTIPLAYER CHESS SYSTEM (PDC EVALUATION)
 * ============================================================================
 * Architecture: Task Parallelism (Master-Worker Pattern)
 * 
 * PDC Requirements:
 * 1. Parallelism: Master process forks multiple Worker processes to handle
 *    computationally heavy tasks.
 * 2. IPC: Uses asynchronous message passing between Master and Workers.
 * 3. Metrics: Global /metrics endpoint utilizing parallel worker data.
 * ============================================================================
 */

const cluster = require("cluster");
const os = require("os");
const crypto = require("crypto");
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const chessRules = require("./js/chess-rules.js");


const isTestMode = process.env.NODE_ENV === 'test';

// === MASTER PROCESS (IO & COORDINATOR) ===
if (cluster.isMaster || cluster.isPrimary) {
  const numCPUs = os.cpus().length;
  console.log(`[Master] Starting Coordinator... Forking ${numCPUs} Computing Workers.`);

  const app = express();
  const server = http.createServer(app);
  const io = socketIo(server);

  const workers = [];
  for (let i = 0; i < numCPUs; i++) {
    workers.push(cluster.fork());
  }

  const rooms = {};
  const queues = { "regular": [], "powered-king": [], "fog-of-war": [] };
  const socketToRoom = {}; // Track which room each socket is in
  let totalMoves = 0;
  let totalMoveTimeMs = 0;

  app.use(express.static(__dirname));

  app.get("/metrics", (req, res) => {
    res.json({
      roomCount: Object.keys(rooms).length,
      totalMoves,
      averageLatencyMs: totalMoves > 0 ? (totalMoveTimeMs / totalMoves).toFixed(2) : 0,
      workerCount: Object.keys(cluster.workers).length,
      uptime: process.uptime()
    });
  });

  app.get("/dashboard", (req, res) => {
    res.sendFile(path.join(__dirname, "dashboard.html"));
  });


  app.get("/health", (req, res) => res.json({ status: "ok", role: "coordinator" }));

  io.on("connection", (socket) => {
    socket.on("queue", (data) => {
      const mode = data.mode || "regular";
      for (const m in queues) queues[m] = queues[m].filter(id => id !== socket.id);
      queues[mode].push(socket.id);
      socket.emit("queued", { mode, position: queues[mode].length });

      if (queues[mode].length >= 2) {
        const p1Id = queues[mode].shift();
        const p2Id = queues[mode].shift();
        const room = "room-" + crypto.randomBytes(8).toString("hex");
        const token1 = crypto.randomBytes(16).toString("hex");
        const token2 = crypto.randomBytes(16).toString("hex");

        rooms[room] = {
          mode, board: START_BOARD(), turn: "white",
          players: { white: { socketId: p1Id, token: token1 }, black: { socketId: p2Id, token: token2 } },
          history: { boards: [chessRules.clone(START_BOARD())], moves: [] },
          manualStatus: null, drawOfferFrom: null, capturedWhite: [], capturedBlack: [],
          halfMoveClock: 0, positionCounts: {}, lastActivity: Date.now(),
          castling: { white: { kingside: true, queenside: true }, black: { kingside: true, queenside: true } },
          enPassantTarget: null,
          poweredKing: mode === "powered-king" ? { swapsLeft: { white: 5, black: 5 }, frozen: { white: {}, black: {} } } : null
        };

        const s1 = io.sockets.sockets.get(p1Id);
        const s2 = io.sockets.sockets.get(p2Id);
        if (s1) s1.join(room);
        if (s2) s2.join(room);
        socketToRoom[p1Id] = room;
        socketToRoom[p2Id] = room;

        io.to(p1Id).emit("start", { color: "white", room, mode, token: token1 });
        io.to(p2Id).emit("start", { color: "black", room, mode, token: token2 });
        emitUpdate(room);
      }
    });

    socket.on("move", (data) => {
      const start = Date.now();
      const taskId = `${Date.now()}-${Math.random()}`;
      const game = rooms[data.room];
      if (!game || game.manualStatus) return;
      
      const playerColor = game.players.white.socketId === socket.id ? "white" : "black";
      
      // FIX 1: Prevent Race Condition using a move lock
      if (game.turn !== playerColor || game.pendingMove) {
        return socket.emit("moveRejected", { reason: game.pendingMove ? "Move already pending" : "Not your turn" });
      }
      
      // Lock the game
      game.pendingMove = true;
      
      // Safety timeout: Release lock if worker hangs for more than 5s
      const safetyTimeout = setTimeout(() => {
        if (game.pendingMove) {
          console.warn(`[Room ${data.room}] Move validation timed out. Releasing lock.`);
          game.pendingMove = false;
        }
      }, 5000);

      const pieceType = chessRules.getPieceType(game.board[data.from[0]][data.from[1]]);
      const captured = game.board[data.to[0]][data.to[1]];
      const isPromo = pieceType === "p" && ((playerColor === "white" && data.to[0] === 0) || (playerColor === "black" && data.to[0] === 7));

      const worker = Object.values(cluster.workers)[Math.floor(Math.random() * Object.keys(cluster.workers).length)];
      
      const onMessage = (msg) => {
        if (msg.type === "VALIDATION_RESULT" && msg.taskId === taskId) {
          worker.off("message", onMessage);
          clearTimeout(safetyTimeout);
          game.pendingMove = false; // Release the lock
          
          if (!msg.isValid) {
            return socket.emit("moveRejected", { reason: "Illegal (validated by worker)" });
          }

          applyMove(game, data, playerColor);
          socket.emit("moveConfirmed", { from: data.from, to: data.to, captured, promoted: isPromo });
          
          totalMoves++;
          totalMoveTimeMs += (Date.now() - start);
          emitUpdate(data.room);
        }
      };

      worker.on("message", onMessage);
      worker.send({ 
        type: "VALIDATE_MOVE", 
        taskId, 
        board: game.board, 
        from: data.from, 
        to: data.to, 
        isWhite: (playerColor === "white"), 
        gameData: game 
      });
    });

    socket.on("resign", (data) => {
      const game = rooms[data.room];
      if (!game || game.manualStatus) return;
      const playerColor = game.players.white.socketId === socket.id ? "white" : "black";
      game.manualStatus = { status: "resigned", winner: playerColor === "white" ? "black" : "white" };
      socket.emit("resignConfirmed");
      emitUpdate(data.room);
    });

    socket.on("offerDraw", (data) => {
      const game = rooms[data.room];
      if (!game || game.manualStatus || game.drawOfferFrom) return;
      const playerColor = game.players.white.socketId === socket.id ? "white" : "black";
      game.drawOfferFrom = playerColor;
      socket.emit("drawOfferSent");
      const oppId = game.players[playerColor === "white" ? "black" : "white"].socketId;
      io.to(oppId).emit("drawOffered", { from: playerColor });
    });

    socket.on("respondDraw", (data) => {
      const game = rooms[data.room];
      if (!game || !game.drawOfferFrom) return;
      const playerColor = game.players.white.socketId === socket.id ? "white" : "black";
      if (playerColor === game.drawOfferFrom) return;
      if (data.accept) {
        game.manualStatus = { status: "draw" };
        io.to(data.room).emit("drawAccepted");
      } else {
        game.drawOfferFrom = null;
        io.to(data.room).emit("drawRejected");
      }
      emitUpdate(data.room);
    });

    socket.on("disconnect", () => {
      for (const m in queues) queues[m] = queues[m].filter(id => id !== socket.id);
      
      const room = socketToRoom[socket.id];
      if (room && rooms[room]) {
        const game = rooms[room];
        const playerColor = game.players.white.socketId === socket.id ? "white" : "black";
        const oppColor = playerColor === "white" ? "black" : "white";
        const oppSid = game.players[oppColor].socketId;
        
        // Notify the opponent
        io.to(oppSid).emit("opponentDisconnected", { color: playerColor });
        
        // Clean up mapping
        delete socketToRoom[socket.id];
      }
    });
  });

  function applyMove(game, data, color) {
    const [sr, sc] = data.from, [tr, tc] = data.to;
    const piece = game.board[sr][sc];
    const captured = game.board[tr][tc];
    game.board[tr][tc] = piece;
    game.board[sr][sc] = "";

    if (captured) {
      if (color === "white") game.capturedWhite.push(captured);
      else game.capturedBlack.push(captured);
    }
    
    if (chessRules.getPieceType(piece) === "p" && ((color === "white" && tr === 0) || (color === "black" && tr === 7))) {
      const p = String(data.promotion || "Q").toUpperCase();
      game.board[tr][tc] = color === "white" ? p : p.toLowerCase();
    }

    game.history.boards.push(chessRules.clone(game.board));
    game.history.moves.push({ from: [sr, sc], to: [tr, tc], captured });
    game.turn = color === "white" ? "black" : "white";
    game.lastActivity = Date.now();
    game.halfMoveClock = (chessRules.getPieceType(piece) === "p" || captured) ? 0 : game.halfMoveClock + 1;
    game.drawOfferFrom = null;
  }

  function emitUpdate(room) {
    const game = rooms[room];
    if (!game) return;
    const status = game.manualStatus || chessRules.getGameStatus(game.board, game.turn, game);
    
    if (game.mode === "fog-of-war") {
      ["white", "black"].forEach(color => {
        const sid = game.players[color].socketId;
        const s = io.sockets.sockets.get(sid);
        if (s) s.emit("update", { ...game, board: buildFogBoard(game.board, color), gameStatus: status });
      });
    } else {
      io.to(room).emit("update", { ...game, gameStatus: status });
    }
  }

  function buildFogBoard(board, color) {
    const isWhite = color === "white";
    return Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => {
      const p = board[r][c];
      if (p && chessRules.isFriendlyPiece(p, isWhite)) return p;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
            const neighbor = board[nr][nc];
            if (neighbor && chessRules.isFriendlyPiece(neighbor, isWhite)) {
              return p || "";
            }
          }
        }
      }
      return null;
    }));
  }

  function START_BOARD() {
    return [
      ["r","n","b","q","k","b","n","r"], ["p","p","p","p","p","p","p","p"],
      ["","","","","","","",""], ["","","","","","","",""],
      ["","","","","","","",""], ["","","","","","","",""],
      ["P","P","P","P","P","P","P","P"], ["R","N","B","Q","K","B","N","R"]
    ];
  }



  // --- SERVER START ---
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => console.log(`[Master] Server online at http://localhost:${PORT}`));

} else {
  // Worker process
  const chessRules = require("./js/chess-rules.js");

  process.on("message", (msg) => {
    if (msg.type === "VALIDATE_MOVE") {
      try {
        const isValid = chessRules.isMoveLegal(msg.board, msg.from, msg.to, msg.isWhite, msg.gameData);
        process.send({ type: "VALIDATION_RESULT", taskId: msg.taskId, isValid });
      } catch (err) {
        process.send({ type: "VALIDATION_RESULT", taskId: msg.taskId, isValid: false });
      }
    }
  });
}

if (isTestMode) {
  module.exports = { START_BOARD: () => [], GAME_MODES: { REGULAR: "regular" }, normalizeMode: (m) => m };
}