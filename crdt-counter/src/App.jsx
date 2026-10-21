
import { useEffect, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import DrawingCanvas from "./components/Canvas";

const ROOM_NAME = "anicanvas-shared-drawing";

function createSharedPage(name) {
  const page = new Y.Map();
  page.set("name", name);
  page.set("strokes", new Y.Array());
  return page;
}

export default function App() {
  const [pages, setPages] = useState([]);
  const [activePageId, setActivePageId] = useState("page-1");
  const [connection, setConnection] = useState("Connecting...");
  const [renamingId, setRenamingId] = useState(null);
  const [nameDraft, setNameDraft] = useState("");
  const [doc, setDoc] = useState(null);
  const [sharedPages, setSharedPages] = useState(null);
  const [strokes, setStrokes] = useState([]);
  const [undoManager, setUndoManager] = useState(null);
  const [historyState, setHistoryState] = useState({
    canUndo: false,
    canRedo: false,
  });

  // Connect to the shared Yjs room.
  useEffect(() => {
    const ydoc = new Y.Doc();
    const provider = new WebsocketProvider(
      "ws://localhost:1234",
      ROOM_NAME,
      ydoc
    );

    const pageMap = ydoc.getMap("pages");

    function syncPages() {
      const result = [];

      pageMap.forEach((page, id) => {
        result.push({
          id,
          name: page.get("name"),
          strokes: page.get("strokes"),
        });
      });

      result.sort((a, b) => {
        if (a.id === "page-1") return -1;
        if (b.id === "page-1") return 1;
        return a.name.localeCompare(b.name);
      });

      setPages(result);

      setActivePageId((current) => {
        if (result.some((page) => page.id === current)) return current;
        return result[0]?.id ?? "page-1";
      });
    }

    function onStatus({ status }) {
      setConnection(status);
    }

    // Create the first page only when the room is empty.
    if (pageMap.size === 0) {
      pageMap.set("page-1", createSharedPage("Page 1"));
    }

    pageMap.observeDeep(syncPages);
    provider.on("status", onStatus);

    setDoc(ydoc);
    setSharedPages(pageMap);
    syncPages();

    return () => {
      pageMap.unobserveDeep(syncPages);
      provider.off("status", onStatus);
      provider.destroy();
      ydoc.destroy();
    };
  }, []);

  const activePage = pages.find((page) => page.id === activePageId);

  // Subscribe to the selected page's strokes.
  useEffect(() => {
    if (!sharedPages || !activePageId) return;

    const page = sharedPages.get(activePageId);

    if (!page) {
      setStrokes([]);
      return;
    }

    const sharedStrokes = page.get("strokes");

    function syncStrokes() {
      setStrokes(sharedStrokes.toArray());
    }

    sharedStrokes.observe(syncStrokes);
    syncStrokes();

    return () => {
      sharedStrokes.unobserve(syncStrokes);
    };
  }, [sharedPages, activePageId]);

  // Each page gets its own UndoManager.
  useEffect(() => {
    if (!sharedPages || !activePageId) {
      setUndoManager(null);
      setHistoryState({ canUndo: false, canRedo: false });
      return;
    }

    const page = sharedPages.get(activePageId);

    if (!page) return;

    const sharedStrokes = page.get("strokes");
    const manager = new Y.UndoManager(sharedStrokes);

    function updateHistory() {
      setHistoryState({
        canUndo: manager.undoStack.length > 0,
        canRedo: manager.redoStack.length > 0,
      });
    }

    manager.on("stack-item-added", updateHistory);
    manager.on("stack-item-popped", updateHistory);
    manager.on("stack-cleared", updateHistory);

    setUndoManager(manager);
    updateHistory();

    return () => {
      manager.off("stack-item-added", updateHistory);
      manager.off("stack-item-popped", updateHistory);
      manager.off("stack-cleared", updateHistory);
      manager.destroy();
    };
  }, [sharedPages, activePageId]);

  function addPage() {
    if (!sharedPages) return;

    const id = crypto.randomUUID();
    const number = pages.length + 1;

    sharedPages.set(id, createSharedPage(`Page ${number}`));
    setActivePageId(id);
    setRenamingId(null);
  }

  function renamePage(id) {
    const name = nameDraft.trim();
    if (!name || !sharedPages) return;

    const page = sharedPages.get(id);
    if (page) page.set("name", name);

    setRenamingId(null);
    setNameDraft("");
  }

  // Apply only the changes made by this drawing action.
  // Do not replace the complete shared array: that could overwrite
  // another user's stroke that arrived while this user was drawing.
  function commitStrokes(nextStrokes, baseStrokes) {
    if (!sharedPages || !activePageId) return;

    const page = sharedPages.get(activePageId);
    if (!page) return;

    const shared = page.get("strokes");
    const current = shared.toArray();

    const baseIds = new Set(baseStrokes.map((stroke) => stroke.id));
    const nextIds = new Set(nextStrokes.map((stroke) => stroke.id));
    const currentIds = new Set(current.map((stroke) => stroke.id));

    const removedIds = new Set(
      baseStrokes
        .filter((stroke) => !nextIds.has(stroke.id))
        .map((stroke) => stroke.id)
    );

    const additions = nextStrokes.filter(
      (stroke) => !currentIds.has(stroke.id)
    );

    doc.transact(() => {
      // Delete only strokes this action actually erased.
      // Delete from the end so array indexes remain valid.
      for (let i = shared.length - 1; i >= 0; i--) {
        const stroke = shared.get(i);
        if (removedIds.has(stroke.id)) {
          shared.delete(i, 1);
        }
      }

      // Add new brush strokes or the fragments left by the eraser.
      if (additions.length > 0) {
        shared.push(additions);
      }
    });
  }

  function undo() {
    undoManager?.undo();
  }

  function redo() {
    undoManager?.redo();
  }

  function clearPage() {
    if (!sharedPages || !activePageId) return;

    const page = sharedPages.get(activePageId);
    if (!page) return;

    const shared = page.get("strokes");

    // Clear the currently known strokes in one undoable transaction.
    doc.transact(() => {
      if (shared.length > 0) {
        shared.delete(0, shared.length);
      }
    });
  }

  useEffect(() => {
    function handleKeyDown(event) {
      const target = event.target;
      const isTyping =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

      if (isTyping || !(event.ctrlKey || event.metaKey)) return;

      const key = event.key.toLowerCase();

      if (key === "z" && event.shiftKey) {
        event.preventDefault();
        redo();
      } else if (key === "z") {
        event.preventDefault();
        undo();
      } else if (key === "y") {
        event.preventDefault();
        redo();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undoManager]);

  return (
    <main style={styles.app}>
      <header style={styles.header}>
        <h1>AniCanvas 🎨</h1>
        <p>Draw your anime story together.</p>
        <p>
          Connection:{" "}
          <strong>
            {connection === "connected" ? "🟢 Connected" : connection}
          </strong>
        </p>
      </header>

      <section style={styles.pagesSection}>
        <div style={styles.heading}>
          <h2>Shared Story Pages</h2>
          <button style={styles.primary} onClick={addPage}>
            + New Page
          </button>
        </div>

        <div style={styles.pageList}>
          {pages.map((page) => (
            <div
              key={page.id}
              style={{
                ...styles.pageCard,
                ...(page.id === activePageId ? styles.selectedPage : {}),
              }}
            >
              {renamingId === page.id ? (
                <form
                  style={styles.renameRow}
                  onSubmit={(event) => {
                    event.preventDefault();
                    renamePage(page.id);
                  }}
                >
                  <input
                    autoFocus
                    value={nameDraft}
                    maxLength={40}
                    onChange={(event) => setNameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setRenamingId(null);
                    }}
                  />
                  <button type="submit">Save</button>
                </form>
              ) : (
                <>
                  <button
                    style={styles.pageButton}
                    onClick={() => setActivePageId(page.id)}
                  >
                    <strong>{page.name}</strong>
                    <small>{page.strokes.length} strokes</small>
                  </button>

                  <button
                    style={styles.renameButton}
                    onClick={() => {
                      setRenamingId(page.id);
                      setNameDraft(page.name);
                    }}
                  >
                    ✎ Rename
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </section>

      <section style={styles.toolbar}>
        <button
          style={styles.toolButton}
          onClick={undo}
          disabled={!historyState.canUndo}
        >
          ↶ Undo
        </button>

        <button
          style={styles.toolButton}
          onClick={redo}
          disabled={!historyState.canRedo}
        >
          ↷ Redo
        </button>

        <button style={styles.clearButton} onClick={clearPage}>
          Clear Page
        </button>
      </section>

      {activePage && (
        <DrawingCanvas
          key={activePage.id}
          pageName={activePage.name}
          strokes={strokes}
          onCommit={commitStrokes}
        />
      )}

      <p style={styles.footer}>
        Active page: {activePage?.name ?? "Loading..."} · Pages: {pages.length}
        {" · "}Shared through Yjs
      </p>
    </main>
  );
}

const styles = {
  app: {
    maxWidth: 1000,
    margin: "30px auto",
    padding: 20,
    fontFamily: "Arial, sans-serif",
    color: "#f8fafc",
    background: "#111827",
    borderRadius: 16,
  },
  header: { textAlign: "center", marginBottom: 24 },
  pagesSection: {
    padding: 16,
    background: "#1f2937",
    borderRadius: 12,
    marginBottom: 16,
  },
  heading: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    marginBottom: 14,
  },
  primary: {
    padding: "10px 14px",
    border: 0,
    borderRadius: 8,
    background: "#db2777",
    color: "white",
    cursor: "pointer",
  },
  pageList: { display: "flex", flexWrap: "wrap", gap: 10 },
  pageCard: {
    width: 155,
    padding: 10,
    background: "#111827",
    border: "1px solid #475569",
    borderRadius: 10,
  },
  selectedPage: { border: "2px solid #f472b6" },
  pageButton: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 6,
    width: "100%",
    border: 0,
    background: "transparent",
    color: "white",
    cursor: "pointer",
    overflowWrap: "anywhere",
  },
  renameButton: {
    marginTop: 8,
    padding: "5px 7px",
    background: "transparent",
    border: "1px solid #64748b",
    borderRadius: 6,
    color: "#f9a8d4",
    cursor: "pointer",
  },
  renameRow: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
    marginTop: 8,
  },
  toolbar: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    marginBottom: 16,
  },
  toolButton: {
    padding: "9px 14px",
    border: "1px solid #64748b",
    borderRadius: 8,
    background: "#1f2937",
    color: "white",
    cursor: "pointer",
  },
  clearButton: {
    padding: "9px 14px",
    border: "1px solid #be123c",
    borderRadius: 8,
    background: "#881337",
    color: "white",
    cursor: "pointer",
  },
  footer: {
    textAlign: "center",
    color: "#cbd5e1",
    fontSize: 13,
  },
};
