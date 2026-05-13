# Chess Game Logic Documentation

## Implemented Features

### 1. **Piece Movement Rules**
- ♙ **Pawn**: Moves forward 1 square (2 from start), captures diagonally
- ♘ **Knight**: L-shaped moves (2+1 or 1+2 squares)
- ♗ **Bishop**: Diagonal slides (any distance)
- ♖ **Rook**: Horizontal/vertical slides (any distance)
- ♕ **Queen**: Combined rook + bishop movement
- ♔ **King**: One square in any direction

### 2. **Check Detection** 
- Detects when a king is under attack
- `isSquareAttacked()` - Checks if enemy pieces attack a square
- Validates all attacking vectors (pawns, knights, sliding pieces)
- **King cannot move to a square attacked by enemy pieces**

### 3. **Legal Move Validation**
- `isMoveLegal()` - Full validation including:
  1. Piece follows movement rules
  2. Move doesn't capture friendly pieces
  3. **After the move, the king must NOT be in check** (most important!)
  
### 4. **Escape from Check**
- Three ways to escape check:
  1. **Move the king** to a safe square
  2. **Block the attack** (for sliding pieces) with another piece
  3. **Capture the attacking piece**

- `hasLegalMoves()` - Checks if current player has ANY legal moves:
  - Iterates through ALL friendly pieces
  - For each piece, gets all possible moves
  - Simulates each move on a test board
  - Returns `true` if any move leaves king NOT in check

### 5. **Checkmate Detection**
```
if (isInCheck(board, playerColor)) {
  if (!hasLegalMoves(board, playerColor)) {
    → CHECKMATE ✓
  } else {
    → CHECK (but player can escape)
  }
}
```

### 6. **Stalemate Detection**
- Current player NOT in check
- Current player has NO legal moves
- Result: Draw 🤝

### 9. **Powered King Mode**
- Kings have three unique abilities (consumes 1 turn):
    - ❄️ **Freeze**: Freeze an enemy piece for 1 turn (it cannot move or capture).
    - 🌌 **Teleport**: Move the king to any empty, safe square (forfeits castling).
    - 🔄 **Swap**: Swap positions with any friendly piece (forfeits castling).
- **Constraints**: 
    - Cannot use powers while the King is frozen.
    - Cannot swap or teleport into check.
    - Powers increment the 50-move clock.

### 10. **Fog of War Mode**
- **Visibility**: Players only see squares that are:
    1. Occupied by their own pieces.
    2. Reachable by a legal move of one of their pieces.
    3. Adjacent to one of their pieces.
- **Hidden Information**: Match history is hidden until the game ends to prevent analysis of invisible moves.

---

## 🛠 Parallel Validation Workflow (PDC)

The system delegates move legality checks to worker processes to maintain a high-performance coordinator.

1. **Client Action**: Player moves a piece on the UI.
2. **Master Request**: Master process generates a unique `taskId` and sends the board state to a Worker via IPC.
3. **Worker Computation**:
    - Worker imports `chess-rules.js`.
    - Runs `isMoveLegal()` (includes simulating the move and checking for king safety).
    - Returns boolean `isValid` via IPC.
4. **Master Resolution**: Master applies the move to the global state and broadcasts the update to all players.

---

## Key Functions

| Function | Purpose |
|----------|---------|
| `getValidMoves()` | Returns all basic moves for a piece type |
| `isMoveLegal()` | Checks if a specific move is legal (includes check validation) |
| `isInCheck()` | Detects if a player's king is in check |
| `isSquareAttacked()` | Checks if enemy pieces attack a square |
| `hasLegalMoves()` | Checks if player has ANY legal moves |
| `getGameStatus()` | Returns: active/check/checkmate/stalemate |

## Bug Fixes Applied

✅ **Fixed path clearing** - Correctly excludes source square  
✅ **Fixed check validation** - Checks enemy attack patterns accurately  
✅ **Fixed blocking** - Pieces can block checks by moving to intermediate squares  
✅ **Fixed capturing** - Pieces can capture the attacking piece to escape check  
✅ **Added comprehensive logging** - Server logs all game state changes  
✅ **Resolved IPC Sync** - Fixed race conditions in Master-Worker move validation  

---

## Testing Scenarios

### Test 1: King in Check with Escape
- Black rook checks white king.
- White should be able to move king to safe square.
- **Result**: CHECK status (not CHECKMATE).

### Test 2: King in Check with Block
- Black rook on e8 checking white king on e1.
- White has bishop that can move to block (e.g., e4).
- **Result**: CHECK status (block is legal move).

### Test 3: King in Check with Capture
- Black knight on e4 checking white king on e2.
- White has queen that can capture the knight.
- **Result**: CHECK status (capture is legal move).

### Test 4: True Checkmate
- Black has rook on e8 checking white king on e1.
- White has no escape squares (attacked or blocked).
- White cannot block (rook is adjacent).
- White cannot capture rook.
- **Result**: CHECKMATE - Black wins.

