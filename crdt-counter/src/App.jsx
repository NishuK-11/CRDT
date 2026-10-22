import { useEffect, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import DrawingCanvas from "./components/Canvas";

const ROOM_NAME = "anicanvas-shared-drawing";

function getServerUrl() {
  if (typeof window !== "undefined" && window.location && window.location.hostname) {
    return `ws://${window.location.hostname}:1234`;
  }
  return "ws://10.16.3.101:1234";
}

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

  // Connect to the shared Yjs room
  useEffect(() => {
    const ydoc = new Y.Doc();
    const serverUrl = getServerUrl();
    const provider = new WebsocketProvider(serverUrl, ROOM_NAME, ydoc);
    const pageMap = ydoc.getMap("pages");

    function syncAll() {
      const pageList = [];
      pageMap.forEach((page, id) => {
        if (!page || typeof page.get !== "function") return;
        const sharedStrokes = page.get("strokes");
        const count = sharedStrokes?.length ?? 0;
        pageList.push({
          id,
          name: page.get("name") || id,
          strokeCount: count,
        });
      });

      pageList.sort((a, b) => {
        if (a.id === "page-1") return -1;
        if (b.id === "page-1") return 1;
        return a.name.localeCompare(b.name);
      });

      setPages(pageList);

      // Synchronize active page strokes directly from the document
      setActivePageId((currentActiveId) => {
        const targetId = pageList.some((p) => p.id === currentActiveId)
          ? currentActiveId
          : (pageList[0]?.id ?? "page-1");

        const targetPage = pageMap.get(targetId);
        if (targetPage && typeof targetPage.get === "function") {
          const s = targetPage.get("strokes");
          if (s && typeof s.toArray === "function") {
            setStrokes(s.toArray());
          } else {
            setStrokes([]);
          }
        } else {
          setStrokes([]);
        }

        return targetId;
      });
    }

    function onStatus({ status }) {
      console.log("Yjs connection status:", status);
      setConnection(status);
    }

    function onConnectionError(event) {
      console.error("WebSocket connection error:", event);
    }

    // Observe all deep mutations in pageMap (new pages, renaming, added/removed strokes)
    pageMap.observeDeep(syncAll);
    provider.on("status", onStatus);
    provider.on("connection-error", onConnectionError);

    // Initialize initial page ONLY after websocket syncs and room is truly empty
    provider.on("synced", (isSynced) => {
      if (isSynced) {
        if (pageMap.size === 0) {
          ydoc.transact(() => {
            pageMap.set("page-1", createSharedPage("Page 1"));
          });
        }
        syncAll();
      }
    });

    setDoc(ydoc);
    setSharedPages(pageMap);
    syncAll();

    return () => {
      pageMap.unobserveDeep(syncAll);
      provider.off("status", onStatus);
      provider.off("connection-error", onConnectionError);
      provider.destroy();
      ydoc.destroy();
    };
  }, []);

  function handleSelectPage(pageId) {
    setActivePageId(pageId);
    if (sharedPages) {
      const targetPage = sharedPages.get(pageId);
      if (targetPage && typeof targetPage.get === "function") {
        const s = targetPage.get("strokes");
        setStrokes(s && typeof s.toArray === "function" ? s.toArray() : []);
      } else {
        setStrokes([]);
      }
    }
  }

  const activePage = pages.find((page) => page.id === activePageId);

  // Per-page Undo/Redo manager
  useEffect(() => {
    if (!sharedPages || !activePageId) {
      setUndoManager(null);
      setHistoryState({ canUndo: false, canRedo: false });
      return;
    }

    const page = sharedPages.get(activePageId);
    if (!page || typeof page.get !== "function") {
      setUndoManager(null);
      return;
    }

    const sharedStrokes = page.get("strokes");
    if (!sharedStrokes || typeof sharedStrokes.toArray !== "function") {
      setUndoManager(null);
      return;
    }

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
    if (!sharedPages || !doc) return;

    const id = crypto.randomUUID();
    const number = pages.length + 1;

    doc.transact(() => {
      sharedPages.set(id, createSharedPage(`Page ${number}`));
    });

    handleSelectPage(id);
    setRenamingId(null);
  }

  function renamePage(id) {
    const name = nameDraft.trim();
    if (!name || !sharedPages || !doc) return;

    const page = sharedPages.get(id);
    if (page && typeof page.set === "function") {
      doc.transact(() => {
        page.set("name", name);
      });
    }

    setRenamingId(null);
    setNameDraft("");
  }

  // Save new strokes and erase removed strokes collaboratively
  function commitStrokes(nextStrokes, baseStrokes) {
    if (!sharedPages || !activePageId || !doc) {
      console.error("Cannot save: Yjs document or page is missing");
      return;
    }

    // 1. Optimistic UI update so stroke never flickers or disappears
    setStrokes(nextStrokes);

    let page = sharedPages.get(activePageId);
    if (!page) {
      doc.transact(() => {
        page = createSharedPage("Page 1");
        sharedPages.set(activePageId, page);
      });
    }

    let shared = page.get("strokes");
    if (!shared || typeof shared.toArray !== "function") {
      doc.transact(() => {
        shared = new Y.Array();
        page.set("strokes", shared);
      });
    }

    const current = shared.toArray();

    const nextIds = new Set(nextStrokes.map((s) => s.id));
    const currentIds = new Set(current.map((s) => s.id));
    const removedIds = new Set(
      baseStrokes.filter((s) => !nextIds.has(s.id)).map((s) => s.id)
    );
    const additions = nextStrokes.filter((s) => !currentIds.has(s.id));

    doc.transact(() => {
      // Remove strokes in reverse index order
      for (let i = shared.length - 1; i >= 0; i--) {
        const stroke = shared.get(i);
        if (stroke && removedIds.has(stroke.id)) {
          shared.delete(i, 1);
        }
      }

      // Add newly drawn strokes
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
    if (!sharedPages || !activePageId || !doc) return;

    const page = sharedPages.get(activePageId);
    if (!page) return;

    const shared = page.get("strokes");
    if (!shared) return;

    // Optimistically clear local state immediately
    setStrokes([]);

    doc.transact(() => {
      if (shared.length > 0) {
        shared.delete(0, shared.length);
      }
    });
  }

  // Keyboard shortcuts: Ctrl/Cmd + Z and Ctrl/Cmd + Y
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
          <button
            style={styles.primary}
            onClick={addPage}
            disabled={!sharedPages}
          >
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
                    onClick={() => handleSelectPage(page.id)}
                  >
                    <strong>{page.name}</strong>
                    <small>{page.strokeCount} strokes</small>
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

        <button
          style={styles.clearButton}
          onClick={clearPage}
          disabled={!activePage}
        >
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
        Active page: {activePage?.name ?? "Loading..."} · Pages: {pages.length} · Shared through Yjs
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
  header: {
    textAlign: "center",
    marginBottom: 24,
  },
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
  pageList: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
  },
  pageCard: {
    width: 155,
    padding: 10,
    background: "#111827",
    border: "1px solid #475569",
    borderRadius: 10,
  },
  selectedPage: {
    border: "2px solid #f472b6",
  },
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
