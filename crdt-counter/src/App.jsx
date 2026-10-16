
// import { useEffect, useRef, useState } from "react";
// import { io } from "socket.io-client";

// const SERVER_URL = "http://localhost:5000";

// function mergeCRDT(local, incoming) {
//   const merged = { ...local };

//   for (const [id, value] of Object.entries(incoming)) {
//     if (
//       typeof value !== "number" ||
//       !Number.isSafeInteger(value) ||
//       value < 0
//     ) {
//       continue;
//     }

//     merged[id] = Math.max(merged[id] ?? 0, value);
//   }

//   return merged;
// }

// function sameState(a, b) {
//   const keys = new Set([
//     ...Object.keys(a),
//     ...Object.keys(b),
//   ]);

//   for (const key of keys) {
//     if ((a[key] ?? 0) !== (b[key] ?? 0)) {
//       return false;
//     }
//   }

//   return true;
// }

// function getReplicaId() {
//   let id = sessionStorage.getItem("crdt-replica-id");

//   if (!id) {
//     id = crypto.randomUUID();
//     sessionStorage.setItem("crdt-replica-id", id);
//   }

//   return id;
// }

// function getSavedState() {
//   try {
//     const saved = JSON.parse(
//       sessionStorage.getItem("crdt-local-state") || "{}"
//     );

//     if (
//       !saved ||
//       typeof saved !== "object" ||
//       Array.isArray(saved)
//     ) {
//       return {};
//     }

//     return saved;
//   } catch {
//     return {};
//   }
// }

// export default function App() {
//   const [replicaId] = useState(getReplicaId);

//   const [localState, setLocalState] = useState(getSavedState);
//   const [sharedState, setSharedState] = useState({});
//   const [connected, setConnected] = useState(false);

//   const socketRef = useRef(null);
//   const localStateRef = useRef(localState);

//   // Keep the latest local state available to event handlers.
//   useEffect(() => {
//     localStateRef.current = localState;

//     sessionStorage.setItem(
//       "crdt-local-state",
//       JSON.stringify(localState)
//     );
//   }, [localState]);

//   useEffect(() => {
//     const socket = io(SERVER_URL);
//     socketRef.current = socket;

//     socket.on("connect", () => {
//       setConnected(true);

//       socket.emit(
//         "replica-state",
//         localStateRef.current
//       );
//     });

//     socket.on("disconnect", () => {
//       setConnected(false);
//     });

//     socket.on("connect_error", (error) => {
//       setConnected(false);
//       console.error("Connection error:", error.message);
//     });

//     socket.on("crdt-state", (message) => {
//       if (
//         !message?.state ||
//         typeof message.state !== "object" ||
//         Array.isArray(message.state)
//       ) {
//         return;
//       }

//       const serverState = message.state;

//       const merged = mergeCRDT(
//         localStateRef.current,
//         serverState
//       );

//       localStateRef.current = merged;

//       setLocalState(merged);
//       setSharedState(merged);

//       sessionStorage.setItem(
//         "crdt-local-state",
//         JSON.stringify(merged)
//       );

//       // Publish local data that the server hasn't received yet.
//       if (!sameState(merged, serverState)) {
//         socket.emit("replica-state", merged);
//       }
//     });

//     return () => {
//       socket.disconnect();
//       socketRef.current = null;
//     };
//   }, []);

//   function publishState(next) {
//     localStateRef.current = next;
//     setLocalState(next);

//     sessionStorage.setItem(
//       "crdt-local-state",
//       JSON.stringify(next)
//     );

//     if (socketRef.current?.connected) {
//       socketRef.current.emit("replica-state", next);
//     }
//   }

//   function increment() {
//     if (!socketRef.current?.connected) {
//       alert("Server connected nahi hai. Backend check karo.");
//       return;
//     }

//     const current = localStateRef.current;

//     const next = {
//       ...current,
//       [replicaId]: (current[replicaId] ?? 0) + 1,
//     };

//     publishState(next);
//   }

//   function simulateFourUsers() {
//     if (!socketRef.current?.connected) {
//       alert("Server connected nahi hai. Backend check karo.");
//       return;
//     }

//     const current = localStateRef.current;
//     const next = { ...current };

//     const simulatedUsers = [
//       `${replicaId}-sim-A`,
//       `${replicaId}-sim-B`,
//       `${replicaId}-sim-C`,
//       `${replicaId}-sim-D`,
//     ];

//     // Each simulated user has an independent CRDT component.
//     for (const userId of simulatedUsers) {
//       next[userId] = (next[userId] ?? 0) + 1;
//     }

//     // Send all four increments in one state update.
//     publishState(next);
//   }

//   const total = Object.values(sharedState).reduce(
//     (sum, value) => sum + value,
//     0
//   );

//   return (
//     <main
//       style={{
//         fontFamily: "Arial, sans-serif",
//         maxWidth: 720,
//         margin: "40px auto",
//         padding: 24,
//         background: "#111827",
//         color: "#f9fafb",
//         borderRadius: 14,
//         minHeight: 400,
//       }}
//     >
//       <h1>CRDT Patient Counter</h1>

//       <p>
//         Connection:{" "}
//         {connected ? "🟢 Connected" : "🔴 Disconnected"}
//       </p>

//       <p>
//         My Replica ID: <code>{replicaId.slice(0, 8)}</code>
//       </p>

//       <h2>
//         My local count: {localState[replicaId] ?? 0}
//       </h2>

//       <div
//         style={{
//           display: "flex",
//           flexWrap: "wrap",
//           gap: 12,
//           margin: "20px 0",
//         }}
//       >
//         <button
//           onClick={increment}
//           disabled={!connected}
//           style={buttonStyle}
//         >
//           Add patient +1
//         </button>

//         <button
//           onClick={simulateFourUsers}
//           disabled={!connected}
//           style={buttonStyle}
//         >
//           Simulate 4 Users (+4)
//         </button>
//       </div>

//       <h2>Server shared total: {total}</h2>

//       <h3>Merged CRDT state</h3>

//       <pre
//         style={{
//           background: "#030712",
//           color: "#86efac",
//           padding: 16,
//           borderRadius: 8,
//           overflowX: "auto",
//           whiteSpace: "pre-wrap",
//           overflowWrap: "anywhere",
//         }}
//       >
//         {JSON.stringify(sharedState, null, 2)}
//       </pre>
//     </main>
//   );
// }

// const buttonStyle = {
//   padding: "12px 16px",
//   border: "none",
//   borderRadius: 8,
//   cursor: "pointer",
//   fontWeight: "bold",
// };



import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

const SERVER_URL = "ws://localhost:1234";
const ROOM_NAME = "nishu-first-document";

export default function App() {
  const [text, setText] = useState("");
  const [status, setStatus] = useState("Connecting...");

  const ytextRef = useRef(null);

  useEffect(() => {
    // 1. Create a Yjs document
    const ydoc = new Y.Doc();

    // 2. Get shared text from the Yjs document
    const ytext = ydoc.getText("editor");
    ytextRef.current = ytext;

    // 3. Connect this document to the WebSocket server
    const provider = new WebsocketProvider(
      SERVER_URL,
      ROOM_NAME,
      ydoc
    );

    // 4. Show connection status
    const handleStatus = ({ status }) => {
      setStatus(status);
    };

    provider.on("status", handleStatus);

    // 5. Update React whenever Yjs text changes
    const syncText = () => {
      setText(ytext.toString());
    };

    ytext.observe(syncText);
    syncText();

    // 6. Cleanup when the component unmounts
    return () => {
      provider.off("status", handleStatus);
      ytext.unobserve(syncText);
      provider.destroy();
      ydoc.destroy();
      ytextRef.current = null;
    };
  }, []);

  // Find the changed portion and apply it to Yjs
  function handleChange(event) {
    const ytext = ytextRef.current;

    if (!ytext) return;

    const oldText = ytext.toString();
    const newText = event.target.value;

    // Find the common beginning
    let start = 0;

    while (
      start < oldText.length &&
      start < newText.length &&
      oldText[start] === newText[start]
    ) {
      start++;
    }

    // Find the common ending
    let oldEnd = oldText.length;
    let newEnd = newText.length;

    while (
      oldEnd > start &&
      newEnd > start &&
      oldText[oldEnd - 1] === newText[newEnd - 1]
    ) {
      oldEnd--;
      newEnd--;
    }

    // Apply only the changed section
    ytext.doc.transact(() => {
      const deleteCount = oldEnd - start;

      if (deleteCount > 0) {
        ytext.delete(start, deleteCount);
      }

      const insertedText = newText.slice(start, newEnd);

      if (insertedText.length > 0) {
        ytext.insert(start, insertedText);
      }
    });
  }

  return (
    <div style={{ maxWidth: "700px", margin: "40px auto", padding: "20px" }}>
      <h1>Yjs Collaborative Text Editor</h1>

      <p>
        Connection:{" "}
        <strong>
          {status}
        </strong>
      </p>

      <textarea
        value={text}
        onChange={handleChange}
        placeholder="Start typing here..."
        rows={12}
        style={{
          width: "100%",
          padding: "12px",
          fontSize: "16px",
          boxSizing: "border-box",
          resize: "vertical",
        }}
      />

      <p>Characters: {text.length}</p>
    </div>
  );
}
