
import { useEffect, useRef, useState } from "react";

const WIDTH = 800;
const HEIGHT = 500;
const ERASER_RADIUS = 14;

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointSegmentDistance(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;

  if (dx === 0 && dy === 0) {
    return distance(point, a);
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - a.x) * dx + (point.y - a.y) * dy) /
        (dx * dx + dy * dy)
    )
  );

  return distance(point, {
    x: a.x + t * dx,
    y: a.y + t * dy,
  });
}

function drawStroke(ctx, stroke) {
  if (!stroke || !stroke.points || stroke.points.length === 0) return;

  ctx.beginPath();
  ctx.strokeStyle = stroke.color || "#ff69b4";
  ctx.lineWidth = Number(stroke.width) || 5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const first = stroke.points[0];
  if (!first) return;
  ctx.moveTo(first.x, first.y);

  if (stroke.points.length === 1) {
    ctx.lineTo(first.x + 0.1, first.y + 0.1);
  } else {
    for (let i = 1; i < stroke.points.length; i++) {
      const point = stroke.points[i];
      if (point) {
        ctx.lineTo(point.x, point.y);
      }
    }
  }

  ctx.stroke();
}

function isNearEraser(point, a, b, radius) {
  return pointSegmentDistance(point, a, b) <= radius;
}

// Split one stroke around the erased area.
// Each remaining fragment gets its own ID.
function eraseStroke(stroke, point, radius) {
  const points = stroke.points;

  if (!points?.length) return [stroke];

  const near = points.map((p) => distance(p, point) <= radius);

  // A one-point stroke needs its own check.
  if (points.length === 1) {
    return near[0] ? [] : [stroke];
  }

  // Also check the line between points so fast pointer movements
  // don't leave obvious un-erased gaps.
  for (let i = 1; i < points.length; i++) {
    if (isNearEraser(point, points[i - 1], points[i], radius)) {
      near[i - 1] = true;
      near[i] = true;
    }
  }

  if (!near.some(Boolean)) return [stroke];

  const fragments = [];
  let currentPoints = [];

  function saveFragment() {
    if (currentPoints.length > 0) {
      fragments.push({
        ...stroke,
        id: crypto.randomUUID(),
        points: currentPoints,
      });
      currentPoints = [];
    }
  }

  for (let i = 0; i < points.length; i++) {
    if (near[i]) {
      saveFragment();
    } else {
      currentPoints.push(points[i]);
    }
  }

  saveFragment();
  return fragments;
}

function eraseAt(strokes, point) {
  return strokes.flatMap((stroke) =>
    eraseStroke(stroke, point, ERASER_RADIUS)
  );
}

export default function DrawingCanvas({ strokes, onCommit, pageName }) {
  const canvasRef = useRef(null);
  const previewRef = useRef(null);
  const activeStrokeRef = useRef(null);
  const baseStrokesRef = useRef([]);

  const [color, setColor] = useState("#ff69b4");
  const [brushSize, setBrushSize] = useState(5);
  const [isEraser, setIsEraser] = useState(false);
  const [preview, setPreview] = useState(null);
  const [activeStroke, setActiveStroke] = useState(null);
  const [isDrawing, setIsDrawing] = useState(false);

  function getPoint(event) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();

    return {
      x: ((event.clientX - rect.left) / rect.width) * WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * HEIGHT,
    };
  }

  function startDrawing(event) {
    if (event.button !== 0) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const point = getPoint(event);

    setIsDrawing(true);
    baseStrokesRef.current = strokes;

    if (isEraser) {
      const result = eraseAt(strokes, point);
      previewRef.current = result;
      setPreview(result);
      return;
    }

    const newStroke = {
      id: crypto.randomUUID(),
      color,
      width: brushSize,
      points: [point],
    };

    activeStrokeRef.current = newStroke;
    setActiveStroke(newStroke);
  }

  function moveDrawing(event) {
    if (!isDrawing) return;

    const point = getPoint(event);

    if (isEraser) {
      const currentPreview = previewRef.current ?? baseStrokesRef.current;
      const result = eraseAt(currentPreview, point);

      previewRef.current = result;
      setPreview(result);
      return;
    }

    const current = activeStrokeRef.current;
    if (!current) return;

    const updated = {
      ...current,
      points: [...current.points, point],
    };

    activeStrokeRef.current = updated;
    setActiveStroke(updated);
  }

  function stopDrawing(event) {
    if (!isDrawing) return;

    if (event?.currentTarget?.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    setIsDrawing(false);

    if (isEraser) {
      const result = previewRef.current;

      // Use the ref instead of React state to avoid stale-state bugs
      // when the user clicks once with the eraser.
      if (result) {
        onCommit(result, baseStrokesRef.current);
      }

      previewRef.current = null;
      baseStrokesRef.current = [];
      setPreview(null);
      return;
    }

    const finishedStroke = activeStrokeRef.current;

    if (finishedStroke) {
      onCommit(
        [...baseStrokesRef.current, finishedStroke],
        baseStrokesRef.current
      );
    }

    activeStrokeRef.current = null;
    baseStrokesRef.current = [];
    setActiveStroke(null);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");

    if (!ctx) return;

    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    const visibleStrokes = preview ?? (Array.isArray(strokes) ? strokes : []);
    console.log("Strokes received:", visibleStrokes.length);

    for (const stroke of visibleStrokes) {
      drawStroke(ctx, stroke);
    }

    if (activeStroke) {
      drawStroke(ctx, activeStroke);
    }
  }, [strokes, preview, activeStroke]);

  return (
    <section style={styles.wrapper}>
      <div style={styles.toolbar}>
        <strong style={styles.pageName}>{pageName}</strong>

        <button
          type="button"
          style={{
            ...styles.button,
            ...(isEraser ? styles.selectedButton : {}),
          }}
          onClick={() => setIsEraser(true)}
        >
          🧽 Eraser
        </button>

        <button
          type="button"
          style={{
            ...styles.button,
            ...(!isEraser ? styles.selectedButton : {}),
          }}
          onClick={() => setIsEraser(false)}
        >
          ✏️ Brush
        </button>

        <label style={styles.label}>
          Color
          <input
            type="color"
            value={color}
            onChange={(event) => {
              setColor(event.target.value);
              setIsEraser(false);
            }}
          />
        </label>

        <label style={styles.label}>
          Size: {brushSize}
          <input
            type="range"
            min="1"
            max="20"
            value={brushSize}
            onChange={(event) =>
              setBrushSize(Number(event.target.value))
            }
          />
        </label>
      </div>

      <div style={styles.canvasFrame}>
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          onPointerDown={startDrawing}
          onPointerMove={moveDrawing}
          onPointerUp={stopDrawing}
          onPointerCancel={stopDrawing}
          style={styles.canvas}
        />
      </div>

      <p style={styles.hint}>
        Draw together in the same room. Undo and Redo apply to the
        currently selected page.
      </p>
    </section>
  );
}

const styles = {
  wrapper: {
    padding: 16,
    background: "#1f2937",
    borderRadius: 12,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 14,
  },
  pageName: {
    color: "#f9a8d4",
    marginRight: 8,
  },
  button: {
    padding: "8px 12px",
    border: "1px solid #64748b",
    borderRadius: 8,
    background: "#111827",
    color: "white",
    cursor: "pointer",
  },
  selectedButton: {
    border: "2px solid #f472b6",
    background: "#4a1942",
  },
  label: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    color: "#e2e8f0",
    fontSize: 13,
  },
  canvasFrame: {
    overflow: "hidden",
    border: "1px solid #64748b",
    borderRadius: 8,
    background: "white",
  },
  canvas: {
    display: "block",
    width: "100%",
    height: "auto",
    touchAction: "none",
    cursor: "crosshair",
  },
  hint: {
    color: "#cbd5e1",
    fontSize: 12,
    marginBottom: 0,
  },
};
