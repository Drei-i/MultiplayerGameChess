
// PIECE VALIDATION (CLIENT-SIDE PREVIEW)
// =========================

/**
 * getValidMovesPreview
 * Calculates moves for the UI to show as dots.
 */
window.getValidMovesPreview = function(r, c) {
    // Access globals from window
    const board = window.board;
    const gameData = window.gameData;
    const myColor = window.myColor;
    const rules = window.ChessRules;

    if (!board || !board[r] || !board[r][c] || !rules) return [];

    const piece = board[r][c];
    const isWhite = rules.isWhitePiece(piece);
    
    try {
        const potentialMoves = rules.getValidMoves(board, r, c, isWhite, gameData || {});
        return potentialMoves.filter(m => rules.isMoveLegal(board, [r, c], m, isWhite, gameData || {}));
    } catch (err) {
        console.error("Move preview error:", err);
        return [];
    }
};
