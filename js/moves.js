
// PIECE VALIDATION (CLIENT-SIDE PREVIEW)
// =========================
const { getPieceType, isWhitePiece, isBlackPiece, isEnemyPiece, isFriendlyPiece, getValidMoves } = window.ChessRules;

// Wrap getValidMoves so it uses the global board and game object if needed, 
// but wait, the client's getValidMoves was simpler and didn't check for check.
// Using the server's getValidMoves provides full validation on the client!
window.getValidMovesPreview = function(r, c) {
    if (!board) return [];
    // gameStatus and turn are globals
    return getValidMoves(board, r, c, myColor === "white", {}); // We pass empty game for now, or we can pass game state if we have it
};
