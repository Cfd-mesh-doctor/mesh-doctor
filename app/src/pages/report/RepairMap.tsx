// SPDX-License-Identifier: GPL-3.0-or-later
// The repair map on a canvas: the model's wall faces in grey (darker where the mesh is finer), a heat layer
// if the report has one, rings where defects were found and repaired, dots where some were left. Pointing at
// a mark (or tapping it) shows what it is. Redrawn when the card's width or the colour theme changes.
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { flushSync } from "react-dom";
import {
  HEAT_HOVER, decodeDensity, defectRadius, defectText, frame, heatStyle, heatText, mapLabel, nearestMark,
  type HeatLayer, type MapSummary, type MapView, type Mark,
} from "@/report/map";

const MAX_HEIGHT = 560;

/** The wall-face density of each view as an alpha mask, made once per view. */
const masks = new WeakMap<MapView, HTMLCanvasElement | null>();

function maskFor(v: MapView): HTMLCanvasElement | null {
  if (masks.has(v)) return masks.get(v) ?? null;
  const alpha = decodeDensity(v);
  let mask: HTMLCanvasElement | null = null;
  const g = alpha && document.createElement("canvas").getContext("2d");
  if (alpha && g) {
    g.canvas.width = v.nx;
    g.canvas.height = v.ny;
    const img = g.createImageData(v.nx, v.ny);
    for (let i = 0; i < alpha.length; i++) img.data[4 * i + 3] = Math.round(alpha[i]! * 255);
    g.putImageData(img, 0, 0);
    mask = g.canvas;
  }
  masks.set(v, mask);
  return mask;
}

/** While a page is printed, the map is drawn in the light colours, which read on white paper (as the page is). */
let printing = false;

/** An element with the light colours (index.css's .light-colors), to read them from while printing. */
function lightColors(): Element {
  let el = document.getElementById("md-light-colors");
  if (!el) {
    el = Object.assign(document.createElement("div"), { id: "md-light-colors", className: "light-colors", hidden: true });
    document.body.append(el);
  }
  return el;
}

/** A colour token of the page (they are oklch() values, which canvases read too). */
const token = (name: string, fallback: string) =>
  getComputedStyle(printing ? lightColors() : document.documentElement).getPropertyValue(name).trim() || fallback;

/**
 * Changes whenever the light or dark theme is switched (the class on <html>), and when printing starts or ends. The
 * browser takes its picture of the page right after "beforeprint", so the map is redrawn at once (flushSync).
 */
function useThemeChange() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const redraw = (now: boolean) => {
      printing = now;
      flushSync(() => setN((k) => k + 1));
    };
    const before = () => redraw(true);
    const after = () => redraw(false);
    const print = window.matchMedia?.("print");
    const change = (e: MediaQueryListEvent) => redraw(e.matches);
    const mo = new MutationObserver(() => setN((k) => k + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    print?.addEventListener("change", change);
    return () => {
      mo.disconnect();
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
      print?.removeEventListener("change", change);
    };
  }, []);
  return n;
}

export function RepairMap({ map, view, layer }: { map: MapSummary; view: MapView; layer: HeatLayer | null }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const marks = useRef<Mark[]>([]);
  const [width, setWidth] = useState<number | null>(null);
  const theme = useThemeChange();
  const geo = width == null ? null : frame(view, width, MAX_HEIGHT);
  // The read-out belongs to one drawing: switching the view, the layer, the width or the theme hides it.
  const drawing = `${view.name}|${layer?.label ?? ""}|${width}|${theme}`;
  const [tip, setTip] = useState<{ drawing: string; x: number; y: number; lines: string[] } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = (w: number) => setWidth(w > 0 ? Math.max(160, Math.round(w)) : 640); // 0: no layout (tests)
    measure(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => measure(entries[0]?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const cv = canvas.current;
    const g = cv?.getContext("2d");
    if (!cv || !g || width == null) return;
    const f = frame(view, width, MAX_HEIGHT);
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(width * dpr);
    cv.height = Math.round(f.h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, f.h);

    const mask = maskFor(view);
    if (mask) {
      // Tint the mask with the text colour, then lay it on the card: the card's own colour shows through.
      const tint = document.createElement("canvas").getContext("2d");
      if (tint) {
        tint.canvas.width = mask.width;
        tint.canvas.height = mask.height;
        tint.drawImage(mask, 0, 0);
        tint.globalCompositeOperation = "source-in";
        tint.fillStyle = token("--foreground", "#2a2f36");
        tint.fillRect(0, 0, mask.width, mask.height);
        g.imageSmoothingEnabled = true;
        g.drawImage(tint.canvas, f.ox, 0, f.w, f.h);
      }
    }

    const [a, b] = view.axes;
    const out: Mark[] = [];
    if (layer) {
      // Weakest first, so the strongest cells are drawn on top.
      const k = layer.cells.length;
      for (let i = k - 1; i >= 0; i--) {
        const c = layer.cells[i]!, st = heatStyle(i, k);
        const px = f.X(c.at[a]), py = f.Y(c.at[b]);
        g.globalAlpha = st.alpha;
        g.fillStyle = st.color;
        g.beginPath();
        g.arc(px, py, st.radius, 0, 2 * Math.PI);
        g.fill();
        if (i < HEAT_HOVER) out.push({ px, py, lines: heatText(layer, i) });
      }
      g.globalAlpha = 1;
    }
    g.lineWidth = 1.5;
    g.strokeStyle = token("--chart-3", "#8e44ad");
    for (const d of map.before) {
      const px = f.X(d.c[a]), py = f.Y(d.c[b]);
      g.beginPath();
      g.arc(px, py, defectRadius(d), 0, 2 * Math.PI);
      g.stroke();
      out.push({ px, py, lines: defectText(d, false) });
    }
    g.fillStyle = token("--info", "#0b7fc7");
    for (const d of map.after) {
      const px = f.X(d.c[a]), py = f.Y(d.c[b]);
      g.beginPath();
      g.arc(px, py, defectRadius(d), 0, 2 * Math.PI);
      g.fill();
      out.push({ px, py, lines: defectText(d, true) });
    }
    marks.current = out;
  }, [map, view, layer, width, theme]);

  const onPointer = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const m = nearestMark(marks.current, x, y, e.pointerType === "touch" ? 16 : 8);
    setTip(m ? { drawing, x, y, lines: m.lines } : null);
  };

  const shown = tip && tip.drawing === drawing && geo ? tip : null;
  return (
    <div ref={box} className="relative w-full select-none">
      {geo && (
        <canvas
          ref={canvas}
          role="img"
          aria-label={mapLabel(map, view, layer)}
          className="block touch-pan-y"
          style={{ width: width ?? undefined, height: geo.h }}
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={() => setTip(null)}
        />
      )}
      {shown && geo && width != null && (
        <div
          aria-hidden
          className="pointer-events-none absolute z-10 max-w-72 rounded-lg border border-border bg-surface px-2.5 py-2 text-xs shadow-pop"
          style={{
            ...(shown.x > width - 220 ? { right: width - shown.x + 12 } : { left: shown.x + 12 }),
            ...(shown.y > geo.h - 110 ? { bottom: geo.h - shown.y + 12 } : { top: shown.y + 12 }),
          }}
        >
          {shown.lines.map((line, i) => (
            <p key={i} className={i === 0 ? "font-medium" : "mt-0.5 text-muted-foreground"}>{line}</p>
          ))}
        </div>
      )}
    </div>
  );
}
