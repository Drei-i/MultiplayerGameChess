const { io } = require("socket.io-client");

const SERVER_URL = "http://localhost:3000";
const NUM_PLAYERS = 50;

console.log(`🚀 MOCK TESTING: Spawning ${NUM_PLAYERS} Ghost Players...`);

for (let i = 0; i < NUM_PLAYERS; i++) {
    const socket = io(SERVER_URL);
    
    socket.on("connect", () => {
        // Each ghost joins the regular queue
        socket.emit("queue", { mode: "regular" });
        
        // Every 2 seconds, send a dummy validation task to keep workers busy
        setInterval(() => {
            socket.emit("stress-test");
        }, 2000);
    });
}

console.log(`✅ ${NUM_PLAYERS} players are now in the queue. Watch your dashboard fill with active games!`);
