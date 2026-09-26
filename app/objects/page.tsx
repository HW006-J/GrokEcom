"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { gbp, type ScannedObject } from "@/lib/mock";
import { loadObjects, saveObjects } from "@/lib/store";
import { Grid, List, Chevron, Check, Scan } from "@/components/icons";

type Body = { x: number; y: number; r: number };

export default function ObjectsScreen() {
  const router = useRouter();
  const [objects, setObjects] = useState<ScannedObject[]>([]);
  const [view, setView] = useState<"cloud" | "list">("cloud");
  const [focus, setFocus] = useState(0);
  const [cut, setCut] = useState<Set<string>>(new Set());
  const asked = useRef<Set<string>>(new Set());

  // Only what was chosen on the photo makes it into the sale. Nothing is invented.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setObjects((loadObjects() ?? []).filter((o) => o.picked));
    setReady(true);
  }, []);

  // Lift each object off its background so the cloud reads as cutouts, not crops.
  useEffect(() => {
    const todo = objects.filter((o) => !asked.current.has(o.id));
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
          const next = prev.map((x) => (x.id === o.id ? { ...x, image: imageUrl } : x));
          saveObjects(next);
          return next;
        });
        setCut((c) => new Set(c).add(o.id));
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
        <Cloud objects={objects} cut={cut} focus={focus} setFocus={setFocus} />
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

/** Push overlapping objects apart until everything has room, then keep it in frame. */
function relax(bodies: Body[], w: number, h: number, gap: number, margin: number) {
  for (let pass = 0; pass < 220; pass++) {
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i];
        const b = bodies[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.001;
        const min = a.r + b.r + gap;
        if (d < min) {
          const push = (min - d) / 2;
          const ux = dx / d;
          const uy = dy / d;
          a.x -= ux * push; a.y -= uy * push;
          b.x += ux * push; b.y += uy * push;
        }
      }
    }
    for (const b of bodies) {
      b.x = Math.max(b.r + margin, Math.min(w - b.r - margin, b.x));
      b.y = Math.max(b.r + margin, Math.min(h - b.r - margin, b.y));
    }
  }
}

function Cloud({
  objects, cut, focus, setFocus,
}: {
  objects: ScannedObject[];
  cut: Set<string>;
  focus: number;
  setFocus: (i: number) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const nodes = useRef<(HTMLButtonElement | null)[]>([]);
  const bodies = useRef<Body[]>([]);
  const [chip, setChip] = useState<{ x: number; y: number } | null>(null);

  // Bigger things read bigger, but only gently, so nothing dominates.
  const weights = useMemo(
    () => objects.map((o) => {
      const v = Math.max(1, o.high);
      return 0.8 + Math.min(0.5, Math.log10(v) / 6);
    }),
    [objects]
  );

  useEffect(() => {
    const el = wrap.current;
    if (!el || objects.length === 0) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const n = objects.length;

      // Size the objects so they comfortably fill, never crowd, the space available.
      const weightSum = weights.reduce((s, x) => s + x * x, 0) || 1;
      const targetArea = w * h * 0.30;
      const base = Math.sqrt(targetArea / (Math.PI * weightSum));
      const cap = Math.min(w, h) * 0.26;

      // Start on a phyllotaxis spiral, which spreads evenly, then relax.
      bodies.current = objects.map((_, i) => {
        const angle = i * 2.399963;
        const rad = Math.sqrt((i + 0.5) / n) * Math.min(w, h) * 0.38;
        return {
          x: w / 2 + Math.cos(angle) * rad,
          y: h / 2 + Math.sin(angle) * rad * 0.92,
          r: Math.min(cap, base * weights[i]),
        };
      });

      relax(bodies.current, w, h, Math.max(14, base * 0.28), 10);

      bodies.current.forEach((b, i) => {
        const node = nodes.current[i];
        if (node) node.style.width = node.style.height = `${b.r * 2}px`;
      });
    };

    // Selection is over, so the cloud settles and stays put. No drifting.
    const place = () => {
      bodies.current.forEach((b, i) => {
        const node = nodes.current[i];
        if (!node) return;
        node.style.transform = `translate(${b.x - b.r}px, ${b.y - b.r}px)`;
      });
      const f = bodies.current[focus];
      if (f) setChip({ x: f.x, y: f.y - f.r - 18 });
    };

    const settle = () => { measure(); place(); };
    settle();
    const ro = new ResizeObserver(settle);
    ro.observe(el);
    return () => ro.disconnect();
  }, [objects, weights, focus]);

  const current = objects[focus];

  return (
    <div className="cloud" ref={wrap}>
      {objects.map((o, i) => (
        <button
          key={o.id}
          ref={(n) => { nodes.current[i] = n; }}
          className="obj"
          onClick={() => setFocus(i)}
          aria-label={`${o.name}, ${gbp(o.low)} to ${gbp(o.high)}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={o.image}
            alt=""
            style={{ mixBlendMode: cut.has(o.id) ? "normal" : "multiply" }}
          />
          <span className="obj-shadow" />
        </button>
      ))}

      {chip && current && (
        <span className="chip" style={{ left: chip.x, top: chip.y }}>
          {current.name}
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
            <img src={o.image} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
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
