/**
 * Collaborative CRDT WebSocket Server
 * Powers multi-user real-time document editing, multiple cursors, and awareness
 */

const http = require("http");
const WebSocket = require("ws");
const express = require("express");
const cors = require("cors");
const { setupWSConnection } = require("y-websocket/bin/utils.cjs");

const app = express();
app.use(cors());

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "CRDT Collaborative Server is running",
    websocket: "Connect via ws://localhost:1234/<room-name>"
  });
});

const server = http.createServer(app);

// Initialize WebSocket server
const wss = new WebSocket.Server({ noServer: true });

wss.on("connection", (ws, req) => {
  setupWSConnection(ws, req);
  console.log(`[CRDT WS] New peer connected to room: ${req.url.slice(1)}`);
});

server.on("upgrade", (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

const PORT = process.env.PORT || 1234;
const HOST = process.env.HOST || "0.0.0.0";

server.listen(PORT, HOST, () => {
  console.log(`===============================================`);
  console.log(`🚀 CRDT Server running at http://${HOST}:${PORT}`);
  console.log(`📡 WebSocket ready on ws://${HOST}:${PORT}`);
  console.log(`===============================================`);
});
