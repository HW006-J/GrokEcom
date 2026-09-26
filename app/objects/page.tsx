"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { gbp, type ScannedObject } from "@/lib/mock";
import { loadObjects, saveObjects } from "@/lib/store";
import { Grid, List, Chevron, Check, Scan } from "@/components/icons";


export default function ObjectsScreen() {
  const router = useRouter();
  const [objects, setObjects] = useState<ScannedObject[]>([]);
  const [view, setView] = useState<"cloud" | "list">("cloud");
  const [focus, setFocus] = useState(0);
  const asked = useRef<Set<string>>(new Set());

  // Only what was chosen on the photo makes it into the sale. Nothing is invented.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setObjects((loadObjects() ?? []).filter((o) => o.picked));
    setReady(true);
  }, []);

  // Lift each object off its background so the cloud reads as cutouts, not crops.
  useEffect(() => {
    const todo = objects.filter((o) => !o.cutout && o.image && !asked.current.has(o.id));
    if (todo.length === 0) return;
    todo.forEach((o) => asked.current.add(o.id));

    todo.forEach(async (o) => {
      try {
        const res = await fetch("/api/cutout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrl: o.image }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const { imageUrl } = (await res.json()) as { imageUrl: string };
        if (!imageUrl) return;
        setObjects((prev) => {
          const next = prev.map((x) => (x.id === o.id ? { ...x, image: imageUrl, cutout: true } : x));
          saveObjects(next);
          return next;
        });
      } catch {
        // the crop still reads fine blended over white
      }
    });
  }, [objects]);

  const total = objects.reduce((s, o) => [s[0] + o.low, s[1] + o.high] as [number, number], [0, 0] as [number, number]);

  const drop = (id: string) => {
    const next = objects.filter((o) => o.id !== id);
    setObjects(next);
    setFocus((f) => Math.min(f, Math.max(0, next.length - 1)));
    const all = loadObjects() ?? [];
    saveObjects(all.map((o) => (o.id === id ? { ...o, picked: false } : o)));
  };

  const start = () => {
    const all = loadObjects() ?? objects;
    const ids = new Set(objects.map((o) => o.id));
    saveObjects(all.map((o) => ({ ...o, picked: ids.has(o.id) })));
    router.push("/auction");
  };

  if (ready && objects.length === 0) {
    return (
      <main className="shell" style={{ display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ textAlign: "center" }}>
          <p className="title">Nothing chosen yet</p>
          <p className="sub" style={{ marginTop: 6 }}>Pick what you want to sell from your photo.</p>
          <button className="pill pill--dark" style={{ marginTop: 18 }} onClick={() => router.push("/review")}>
            Back to the photo
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="pad safe-t" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 className="display">Your sale</h1>
          <p className="sub" style={{ marginTop: 6 }}>
            {objects.length} {objects.length === 1 ? "lot" : "lots"} · {gbp(total[0])}–{gbp(total[1])}
          </p>
        </div>
        <div className="seg" role="tablist" aria-label="View">
          <button data-on={view === "cloud"} onClick={() => setView("cloud")} aria-label="Cloud view"><Grid size={17} /></button>
          <button data-on={view === "list"} onClick={() => setView("list")} aria-label="List view"><List size={17} /></button>
        </div>
      </header>

      {view === "cloud" ? (
        <Cloud objects={objects} focus={focus} setFocus={setFocus} />
      ) : (
        <ListView objects={objects} onDrop={drop} />
      )}

      <footer className="pad safe-b" style={{ paddingTop: 10 }}>
        <div className="dock">
          <button className="pill pill--ghost" style={{ flex: "0 0 auto" }} onClick={() => router.push("/review")}>
            <Scan size={18} /> Edit
          </button>
          <span className="dock-divider" />
          <button className="pill pill--primary" style={{ flex: 1 }} onClick={start} disabled={objects.length === 0}>
            Start the sale <Chevron size={17} />
          </button>
        </div>
      </footer>
    </main>
  );
}

/* ── Floating cloud ─────────────────────────────────────────── */

type Body = { id: string; x: number; y: number; vx: number; vy: number; r: number; seed: number };

function Cloud({
  objects, focus, setFocus,
}: {
  objects: ScannedObject[];
  focus: number;
  setFocus: (i: number) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const nodes = useRef<Map<string, HTMLButtonElement>>(new Map());
  const bodies = useRef<Map<string, Body>>(new Map());
  const list = useRef<ScannedObject[]>(objects);
  const focusRef = useRef(focus);
  const chipRef = useRef<HTMLSpanElement>(null);
  const [chip, setChip] = useState<{ x: number; y: number } | null>(null);

  list.current = objects;
  focusRef.current = focus;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    let raf = 0;
    let w = 0;
    let h = 0;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Size each object to fill the space without crowding, and keep any body
    // that already exists where it is so arriving cutouts do not make it jump.
    const measure = () => {
      const rect = el.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      const items = list.current;
      const n = Math.max(1, items.length);
      const base = Math.sqrt((w * h * 0.34) / (Math.PI * n));
      const r = Math.min(base, Math.min(w, h) * 0.30);

      const seen = new Set<string>();
      items.forEach((o, i) => {
        seen.add(o.id);
        let b = bodies.current.get(o.id);
        if (!b) {
          const angle = i * 2.399963;
          const rad = Math.sqrt((i + 0.5) / n) * Math.min(w, h) * 0.34;
          b = {
            id: o.id,
            x: w / 2 + Math.cos(angle) * rad,
            y: h / 2 + Math.sin(angle) * rad,
            vx: 0, vy: 0, r,
            seed: i * 1.7 + 0.3,
          };
          bodies.current.set(o.id, b);
        }
        b.r = r;
        b.x = Math.max(r, Math.min(w - r, b.x));
        b.y = Math.max(r, Math.min(h - r, b.y));
        const node = nodes.current.get(o.id);
        if (node) node.style.width = node.style.height = `${r * 2}px`;
      });
      for (const id of [...bodies.current.keys()]) if (!seen.has(id)) bodies.current.delete(id);
    };

    const step = (t: number) => {
      const bs = [...bodies.current.values()];

      if (!still) {
        // A slow wander, so the cloud is always breathing.
        for (const b of bs) {
          b.vx += Math.cos(t * 0.00019 + b.seed) * 0.010;
          b.vy += Math.sin(t * 0.00023 + b.seed * 1.3) * 0.010;
          b.vx *= 0.94;
          b.vy *= 0.94;
          b.x += b.vx;
          b.y += b.vy;
        }

        // Nothing may sit on top of anything else.
        for (let i = 0; i < bs.length; i++) {
          for (let j = i + 1; j < bs.length; j++) {
            const a = bs[i];
            const c = bs[j];
            const dx = c.x - a.x;
            const dy = c.y - a.y;
            const d = Math.hypot(dx, dy) || 0.001;
            const min = a.r + c.r + 20;
            if (d < min) {
              const push = (min - d) / 2;
              const ux = dx / d;
              const uy = dy / d;
              a.x -= ux * push; a.y -= uy * push;
              c.x += ux * push; c.y += uy * push;
              a.vx -= ux * 0.05; a.vy -= uy * 0.05;
              c.vx += ux * 0.05; c.vy += uy * 0.05;
            }
          }
        }

        // And nothing leaves the frame.
        for (const b of bs) {
          if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx) * 0.5; }
          if (b.x > w - b.r) { b.x = w - b.r; b.vx = -Math.abs(b.vx) * 0.5; }
          if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy) * 0.5; }
          if (b.y > h - b.r) { b.y = h - b.r; b.vy = -Math.abs(b.vy) * 0.5; }
        }
      }

      for (const b of bs) {
        const node = nodes.current.get(b.id);
        if (node) node.style.transform = `translate(${b.x - b.r}px, ${b.y - b.r}px)`;
      }

      const f = list.current[focusRef.current];
      const fb = f ? bodies.current.get(f.id) : undefined;
      if (fb) {
        const half = (chipRef.current?.offsetWidth ?? 180) / 2 + 10;
        const above = fb.y - fb.r - 20;
        setChip({
          x: Math.max(half, Math.min(w - half, fb.x)),
          y: above < 30 ? fb.y + fb.r + 20 : above,
        });
      }
      raf = requestAnimationFrame(step);
    };

    measure();
    raf = requestAnimationFrame(step);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [objects.length]);

  const current = objects[focus];

  return (
    <div className="cloud" ref={wrap}>
      {objects.map((o, i) => (
        <button
          key={o.id}
          ref={(n) => {
            if (n) nodes.current.set(o.id, n);
            else nodes.current.delete(o.id);
          }}
          className="obj"
          onClick={() => setFocus(i)}
          aria-label={`${o.name}, ${gbp(o.low)} to ${gbp(o.high)}`}
        >
          {o.cutout && o.image ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={o.image} alt="" />
          ) : (
            <span className="obj-pending" aria-hidden />
          )}
          <span className="obj-shadow" />
        </button>
      ))}

      {chip && current && (
        <span ref={chipRef} className="chip" style={{ left: chip.x, top: chip.y }}>
          <span className="chip-name">{current.name}</span>
          <span className="chip-price">{gbp(current.low)}–{gbp(current.high)}</span>
        </span>
      )}
    </div>
  );
}

/* ── List ───────────────────────────────────────────────────── */

function ListView({ objects, onDrop }: { objects: ScannedObject[]; onDrop: (id: string) => void }) {
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "14px 22px 4px" }}>
      {objects.map((o) => (
        <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
          <span style={{ width: 58, height: 58, borderRadius: 14, background: "#f6f6f4", display: "grid", placeItems: "center", overflow: "hidden", flex: "0 0 auto" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={o.image} alt="" style={{ width: "100%", height: "100%", objectFit: o.cutout ? "contain" : "cover" }} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 15, fontWeight: 500, letterSpacing: "-.2px" }}>{o.name}</span>
            <span className="meta" style={{ textTransform: "none" }}>{o.condition}</span>
          </span>
          <span style={{ textAlign: "right", flex: "0 0 auto" }}>
            <span style={{ display: "block", fontSize: 14, fontVariantNumeric: "tabular-nums" }}>{gbp(o.low)}–{gbp(o.high)}</span>
            <button className="meta" style={{ minHeight: 0, marginTop: 4, color: "var(--ink-3)" }} onClick={() => onDrop(o.id)}>
              Remove
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}
