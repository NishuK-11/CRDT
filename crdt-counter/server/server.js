const {WebSocketServer} = require("y-websocket/bin/utils");
const port = 1234;

const ws = new WebSocketServer({
    port,
})

console.log(`Yjs WebSocket server running on port ${port}`);