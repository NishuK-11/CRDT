
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

let crdtState = {};

function mergeCRDT(current, incoming) {
  const merged = { ...current };

  for (const [id, value] of Object.entries(incoming)) {
    if (
      typeof id !== "string" ||
      !Number.isSafeInteger(value) ||
      value < 0
    ) {
      continue;
    }

    merged[id] = Math.max(merged[id] ?? 0, value);
  }

  return merged;
}

function getTotal(state) {
  return Object.values(state).reduce(
    (sum, count) => sum + count,
    0
  );
}

function broadcastState() {
  io.emit("crdt-state", {
    state: crdtState,
    total: getTotal(crdtState),
  });
}

app.get("/", (req, res) => {
  res.send("CRDT server is running");
});

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Send current shared state to the newly connected client.
  socket.emit("crdt-state", {
    state: crdtState,
    total: getTotal(crdtState),
  });

  socket.on("replica-state", (incoming) => {
    if (
      !incoming ||
      typeof incoming !== "object" ||
      Array.isArray(incoming)
    ) {
      return;
    }

    crdtState = mergeCRDT(crdtState, incoming);

    console.log("Updated CRDT state:", crdtState);
    console.log("Shared total:", getTotal(crdtState));

    broadcastState();
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

const PORT = 5000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`CRDT server running on port ${PORT}`);
});
