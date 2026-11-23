// SPDX-License-Identifier: GPL-3.0-or-later
// The 3D view of one defect cluster, drawn with three.js. It is loaded only when a cluster is opened (React.lazy),
// so three.js stays out of every other screen. Drag turns it, the wheel or a pinch zooms, right-drag or two fingers
// move it, and a click or tap on a face says what it is. With the view selected, the arrow keys turn it, + and -
// zoom, and 0 puts it back. It draws only when something changes, never in a loop.
import { Minus, Plus, RotateCcw } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState, type KeyboardEvent } from "react";
import {
  AmbientLight, BufferAttribute, BufferGeometry, Color, DirectionalLight, DoubleSide, LineBasicMaterial, LineSegments,
  Mesh, MeshBasicMaterial, MeshLambertMaterial, PerspectiveCamera, Raycaster, Scene, Vector2, WebGLRenderer,
  type Intersection,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Button } from "@/components/ui/button";
import { FACE_CLASSES, LOOK, type FaceClass, type PickedFace, type Shapes } from "./shapes";

interface View {
  reset: () => void;
  zoom: (factor: number) => void;
  turn: (across: number, up: number) => void;
}

type Problem = "cannot" | "lost" | null;

/** Whether this browser can draw with WebGL at all, tried on a canvas of its own that is let go at once. */
function canDraw(): boolean {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") ?? c.getContext("webgl");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return gl != null;
  } catch {
    return false;
  }
}

/** A CSS colour (the app's are oklch) as rgb() for three.js, read back from a one-pixel canvas. */
function rgb(css: string, fallback: string): string {
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g || !css) return fallback;
  g.fillStyle = fallback;
  g.fillStyle = css; // one it can't read leaves the fallback
  g.fillRect(0, 0, 1, 1);
  const [r = 0, gr = 0, b = 0] = g.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${gr}, ${b})`;
}

/** A polygon's sides and its fan of triangles, from its moved corners. */
function outlineOf(v: Float32Array): { sides: Float32Array; tris: Float32Array } {
  const m = v.length / 3, sides = new Float32Array(m * 6), tris = new Float32Array(Math.max(0, m - 2) * 9);
  for (let k = 0; k < m; k++) {
    const j = (k + 1) % m;
    sides.set(v.subarray(3 * k, 3 * k + 3), 6 * k);
    sides.set(v.subarray(3 * j, 3 * j + 3), 6 * k + 3);
  }
  for (let k = 1; k < m - 1; k++) {
    tris.set(v.subarray(0, 3), (k - 1) * 9);
    tris.set(v.subarray(3 * k, 3 * k + 6), (k - 1) * 9 + 3);
  }
  return { sides, tris };
}

function geometry(positions: Float32Array): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(positions, 3));
  return g;
}

export default function ClusterScene({ shapes, extent, onPick, label }: {
  shapes: Shapes;
  /** How far away the view starts: the cluster's largest side, or (null) worked out from its corners. */
  extent: number | null;
  /** Said when a face is clicked or tapped, and null for a click on nothing. */
  onPick: (face: PickedFace | null) => void;
  /** What the view shows, for a screen reader. */
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const view = useRef<View | null>(null);
  const [problem, setProblem] = useState<Problem>(() => (canDraw() ? null : "cannot"));
  const picked = useEffectEvent((face: PickedFace | null) => onPick(face));

  useEffect(() => {
    const wrap = box.current;
    if (!wrap || problem) return;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      const id = requestAnimationFrame(() => setProblem("cannot"));
      return () => cancelAnimationFrame(id);
    }
    // A canvas of its own each time: a canvas whose context was let go can't draw again.
    const canvas = renderer.domElement;
    canvas.className = "block size-full";
    wrap.prepend(canvas);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const scene = new Scene();
    const camera = new PerspectiveCamera(45, 1, 1e-6, 1);
    camera.up.set(0, 0, 1); // z up, as in the engine's own viewer
    const sun = new DirectionalLight(0xffffff, 2);
    sun.position.set(0.4, 0.6, 1);
    camera.add(sun); // a light by the viewer's shoulder: the faces turned towards you are the bright ones
    scene.add(camera, new AmbientLight(0xffffff, 1.3));

    const made: { dispose: () => void }[] = [];
    const meshes = new Map<Mesh, FaceClass>();
    const mats: Partial<Record<FaceClass, MeshLambertMaterial>> = {};
    for (const cls of FACE_CLASSES) {
      const L = shapes.layers[cls];
      if (!L.owner.length) continue;
      const solid = LOOK[cls].opacity >= 1;
      const g = geometry(L.positions);
      g.computeVertexNormals();
      const m = new MeshLambertMaterial({ side: DoubleSide, transparent: !solid, opacity: LOOK[cls].opacity, depthWrite: solid });
      const mesh = new Mesh(g, m);
      mesh.renderOrder = solid ? 0 : cls === "fine" ? 1 : 2; // see-through faces after the solid ones
      mats[cls] = m;
      meshes.set(mesh, cls);
      scene.add(mesh);
      made.push(g, m);
    }
    const ink = [new LineBasicMaterial({ transparent: true, opacity: 0.5 }), new LineBasicMaterial({ transparent: true, opacity: 0.15 })];
    const cellSides = FACE_CLASSES.filter((c) => c !== "wall").map((c) => shapes.layers[c].edges);
    const allCellSides = new Float32Array(cellSides.reduce((n, e) => n + e.length, 0));
    let at = 0;
    for (const e of cellSides) {
      allCellSides.set(e, at);
      at += e.length;
    }
    [allCellSides, shapes.layers.wall.edges].forEach((e, i) => {
      const mat = ink[i];
      if (!e.length || !mat) return;
      const lines = new LineSegments(geometry(e), mat);
      lines.renderOrder = 3;
      scene.add(lines);
      made.push(lines.geometry);
    });
    made.push(...ink);

    // The picked face: a shade over it and its outline, drawn over everything else.
    const markMat = new LineBasicMaterial({ depthTest: false, transparent: true });
    const shadeMat = new MeshBasicMaterial({ depthTest: false, transparent: true, opacity: 0.6, side: DoubleSide });
    const mark = new LineSegments(new BufferGeometry(), markMat);
    const shade = new Mesh(new BufferGeometry(), shadeMat);
    mark.renderOrder = shade.renderOrder = 4;
    mark.visible = shade.visible = false;
    scene.add(shade, mark);
    made.push(markMat, shadeMat);
    const outline = (i: number | null) => {
      const v = i == null ? undefined : shapes.corners[i];
      mark.visible = shade.visible = v != null;
      if (!v) return;
      const o = outlineOf(v);
      mark.geometry.dispose();
      shade.geometry.dispose();
      mark.geometry = geometry(o.sides);
      shade.geometry = geometry(o.tris);
    };

    const paint = () => {
      const css = getComputedStyle(document.documentElement);
      const col = (token: string, fallback: string) => new Color(rgb(css.getPropertyValue(token).trim(), fallback));
      for (const cls of FACE_CLASSES) mats[cls]?.color.copy(col(LOOK[cls].token, "#888888"));
      const fg = col("--foreground", "#222222");
      for (const m of [...ink, markMat, shadeMat]) m.color.copy(fg);
    };
    const render = () => renderer.render(scene, camera);
    const size = () => {
      const w = Math.max(1, wrap.clientWidth), h = Math.max(1, wrap.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
    };

    const controls = new OrbitControls(camera, canvas);
    controls.addEventListener("change", render);
    const reach = 2.2 * (extent ?? 2 * Math.max(shapes.radius, 1e-6));
    controls.minDistance = reach / 40;
    controls.maxDistance = reach * 20;
    camera.near = reach / 400;
    camera.far = reach * 60;
    const settle = () => {
      controls.update();
      render();
    };
    const reset = () => {
      const yaw = 0.7, pitch = 0.5; // the engine's viewer starts from here too
      camera.position.set(reach * Math.cos(pitch) * Math.cos(yaw), reach * Math.cos(pitch) * Math.sin(yaw), reach * Math.sin(pitch));
      controls.target.set(0, 0, 0);
      settle();
    };
    const zoom = (f: number) => {
      const off = camera.position.clone().sub(controls.target).multiplyScalar(f);
      camera.position.copy(controls.target).add(off);
      settle();
    };
    const turn = (across: number, up: number) => {
      const t = controls.target, off = camera.position.clone().sub(t), r = off.length();
      const az = Math.atan2(off.y, off.x) + across;
      const el = Math.max(-1.45, Math.min(1.45, Math.asin(Math.max(-1, Math.min(1, off.z / r))) + up));
      camera.position.set(t.x + r * Math.cos(el) * Math.cos(az), t.y + r * Math.cos(el) * Math.sin(az), t.z + r * Math.sin(el));
      settle();
    };
    view.current = { reset, zoom, turn };

    // A click or tap that didn't move: the face under it. Through see-through faces you see the solid ones, so the
    // nearest solid face wins, then the nearest see-through one, then a boundary face.
    const ray = new Raycaster();
    const targets = [...meshes.keys()];
    const rank = (h: Intersection) => {
      const c = meshes.get(h.object as Mesh);
      return c === "wall" ? 2 : c === "fine" ? 1 : 0;
    };
    let down: { x: number; y: number; id: number } | null = null;
    let pointers = 0;
    const onDown = (e: PointerEvent) => {
      pointers++;
      down = pointers === 1 ? { x: e.clientX, y: e.clientY, id: e.pointerId } : null;
    };
    const onUp = (e: PointerEvent) => {
      pointers = Math.max(0, pointers - 1);
      const d = down;
      down = null;
      if (!d || d.id !== e.pointerId || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
      const r = canvas.getBoundingClientRect();
      ray.setFromCamera(new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2), camera);
      let best: Intersection | null = null;
      for (const h of ray.intersectObjects(targets, false)) if (!best || rank(h) < rank(best)) best = h;
      const cls = best ? meshes.get(best.object as Mesh) : undefined;
      const i = cls && best?.faceIndex != null ? shapes.layers[cls].owner[best.faceIndex] : undefined;
      outline(i ?? null);
      render();
      picked(i == null ? null : (shapes.faces[i] ?? null));
    };
    const onCancel = () => {
      pointers = Math.max(0, pointers - 1);
      down = null;
    };
    const onLost = (e: Event) => {
      e.preventDefault();
      setProblem("lost");
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onCancel);
    canvas.addEventListener("webglcontextlost", onLost);

    const themes = new MutationObserver(() => {
      paint();
      render();
    });
    themes.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    const sizes = new ResizeObserver(size);
    sizes.observe(wrap);
    paint();
    size();
    reset();

    return () => {
      view.current = null;
      sizes.disconnect();
      themes.disconnect();
      controls.dispose();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("webglcontextlost", onLost);
      mark.geometry.dispose();
      shade.geometry.dispose();
      for (const m of made) m.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    };
  }, [shapes, extent, problem]);

  if (problem) {
    return (
      <div role="note" className="flex h-[min(55dvh,420px)] items-center justify-center rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        {problem === "lost"
          ? "The 3D view stopped: the browser took its graphics back. Close this and open the cluster again."
          : "This browser can't draw in 3D (WebGL is off or missing), so there is no view. The list still gives each cluster's numbers."}
      </div>
    );
  }
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const v = view.current, step = Math.PI / 18; // 10°
    if (!v || e.altKey || e.ctrlKey || e.metaKey) return;
    const act: Record<string, () => void> = {
      ArrowLeft: () => v.turn(step, 0),
      ArrowRight: () => v.turn(-step, 0),
      ArrowUp: () => v.turn(0, step),
      ArrowDown: () => v.turn(0, -step),
      "+": () => v.zoom(0.8),
      "=": () => v.zoom(0.8),
      "-": () => v.zoom(1.25),
      "0": v.reset,
      Home: v.reset,
    };
    const a = act[e.key];
    if (a) {
      e.preventDefault();
      a();
    }
  };
  return (
    <div className="relative">
      <div ref={box} role="img" aria-label={label} tabIndex={0} onKeyDown={key}
        className="h-[min(55dvh,420px)] w-full touch-none overflow-hidden rounded-lg border border-border bg-surface-2" />
      <div className="absolute top-2 right-2 flex gap-1">
        <Button variant="secondary" size="icon-sm" aria-label="Zoom in" onClick={() => view.current?.zoom(0.8)}><Plus /></Button>
        <Button variant="secondary" size="icon-sm" aria-label="Zoom out" onClick={() => view.current?.zoom(1.25)}><Minus /></Button>
        <Button variant="secondary" size="icon-sm" aria-label="Back to the first view" onClick={() => view.current?.reset()}>
          <RotateCcw />
        </Button>
      </div>
    </div>
  );
}
