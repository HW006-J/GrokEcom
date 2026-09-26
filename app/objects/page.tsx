"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MOCK_OBJECTS, gbp, lotToObject, type ScannedObject } from "@/lib/mock";
import { loadObjects, saveObjects } from "@/lib/store";
import { supabaseBrowser } from "@/lib/supabase";
import type { Comp, Lot } from "@/lib/types";
import { Grid, List, Scan, Chevron, Check } from "@/components/icons";

// Lots from a real scan carry a uuid; the sample set does not.
const IS_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Body = { x: number; y: number; r: number; phase: number; amp: number; speed: number };

export default function ObjectsScreen() {
  const router = useRouter();
  const [objects, setObjects] = useState<ScannedObject[]>(MOCK_OBJECTS);
  const [view, setView] = useState<"cloud" | "list">("cloud");
  const [focus, setFocus] = useState(0);
  const [pricing, setPricing] = useState<string[]>([]);
  const refined = useRef<Set<string>>(new Set());

  // Whatever the last scan produced, else the most recent lots, else the sample set.
  useEffect(() => {
    let alive = true;

    const hydrate = async (): Promise<ScannedObject[] | null> => {
      const saved = loadObjects();
      if (saved?.length) return saved;
      try {
        const { data } = await supabaseBrowser()
          .from("lots")
          .select("*")
          .order("created_at", { ascending: false })
          .order("sort_order", { ascending: true })
          .limit(12);
        if (data?.length) return (data as Lot[]).map(lotToObject);
      } catch {
        // no Supabase configured; the sample set already on screen is the fallback
      }
      return null;
    };

    hydrate().then((found) => {
      if (!alive || !found) return;
      setObjects(found);
      saveObjects(found);
    });

    return () => { alive = false; };
  }, []);


  // The scan hands us a quick estimate. Now check what these actually sell for,
  // one live web search per object, and let the prices settle in place.
  useEffect(() => {
    const todo = objects.filter((o) => !refined.current.has(o.id) && !(o.comps && o.comps.length));
    if (todo.length === 0) return;
    todo.forEach((o) => refined.current.add(o.id));
    setPricing((p) => [...p, ...todo.map((o) => o.id)]);

    todo.forEach(async (o) => {
      try {
        const res = await fetch("/api/price", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: o.name, category: o.category, condition: o.condition }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const est = (await res.json()) as { low: number; high: number; reserve: number; comps: Comp[] };
        setObjects((prev) => {
          const next = prev.map((x) =>
            x.id === o.id ? { ...x, low: est.low, high: est.high, reserve: est.reserve, comps: est.comps } : x
          );
          saveObjects(next);
          return next;
        });
      } catch {
        // keep the quick estimate rather than showing nothing
      } finally {
        setPricing((p) => p.filter((id) => id !== o.id));
      }
    });
  }, [objects]);

  const picked = objects.filter((o) => o.picked);

  const toggle = (id: string) => {
    const picking = !(objects.find((o) => o.id === id)?.picked ?? false);
    const next = objects.map((o) => (o.id === id ? { ...o, picked: picking } : o));
    setObjects(next);
    saveObjects(next);
    if (IS_UUID.test(id)) {
      fetch(`/api/lots/${id}/pick`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ picked: picking }),
      }).catch(() => {}); // the screen has already moved on
    }
  };

  const review = () => {
    saveObjects(objects);
    router.push("/auction");
  };

  return (
    <main className="shell">
      <header className="pad safe-t" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 className="display">Your objects</h1>
          <p className="sub" style={{ marginTop: 6 }}>
            {pricing.length > 0
              ? `${objects.length} objects · checking live prices…`
              : `${objects.length} objects · ${gbp(picked.reduce((s, o) => s + o.low, 0))}–${gbp(picked.reduce((s, o) => s + o.high, 0))}`}
          </p>
        </div>
        <div className="seg" role="tablist" aria-label="View">
          <button data-on={view === "cloud"} onClick={() => setView("cloud")} aria-label="Cloud view"><Grid size={17} /></button>
          <button data-on={view === "list"} onClick={() => setView("list")} aria-label="List view"><List size={17} /></button>
        </div>
      </header>

      {view === "cloud" ? (
        <Cloud objects={objects} focus={focus} setFocus={setFocus} onToggle={toggle} />
      ) : (
        <ListView objects={objects} onToggle={toggle} />
      )}

      <footer className="pad safe-b" style={{ paddingTop: 10 }}>
        <div className="dock">
          <button className="pill pill--ghost" style={{ flex: "0 0 auto" }} onClick={() => router.push("/")}>
            <Scan size={18} /> Scan
          </button>
          <span className="dock-divider" />
          <button className="pill pill--primary" style={{ flex: 1 }} onClick={review} disabled={picked.length === 0}>
            Sell {picked.length} <Chevron size={17} />
          </button>
        </div>
      </footer>
    </main>
  );
}

/* ── Floating cloud ─────────────────────────────────────────── */

function Cloud({
  objects, focus, setFocus, onToggle,
}: {
  objects: ScannedObject[];
  focus: number;
  setFocus: (i: number) => void;
  onToggle: (id: string) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const nodes = useRef<(HTMLButtonElement | null)[]>([]);
  const bodies = useRef<Body[]>([]);
  const [chip, setChip] = useState<{ x: number; y: number } | null>(null);

  // Relative layout: loose, organic, no overlap. Tuned for up to 6 objects.
  const layout = useMemo(
    () => [
      { x: 0.5, y: 0.22, w: 1.15 },
      { x: 0.2, y: 0.44, w: 0.85 },
      { x: 0.78, y: 0.47, w: 0.95 },
      { x: 0.34, y: 0.73, w: 1.1 },
      { x: 0.75, y: 0.78, w: 0.8 },
      { x: 0.12, y: 0.2, w: 0.7 },
    ],
    []
  );

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    let raf = 0;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

    const measure = () => {
      const r = el.getBoundingClientRect();
      const base = Math.min(r.width, r.height) * 0.3;
      bodies.current = objects.map((_, i) => {
        const L = layout[i % layout.length];
        return {
          x: L.x * r.width,
          y: L.y * r.height,
          r: base * L.w * 0.5,
          phase: i * 1.7,
          amp: 5 + (i % 3) * 3,
          speed: 0.00035 + (i % 4) * 0.00008,
        };
      });
      bodies.current.forEach((b, i) => {
        const n = nodes.current[i];
        if (!n) return;
        n.style.width = n.style.height = `${b.r * 2}px`;
      });
    };

    const frame = (t: number) => {
      bodies.current.forEach((b, i) => {
        const n = nodes.current[i];
        if (!n) return;
        const dy = reduce ? 0 : Math.sin(t * b.speed + b.phase) * b.amp;
        const dx = reduce ? 0 : Math.cos(t * b.speed * 0.8 + b.phase) * (b.amp * 0.5);
        n.style.transform = `translate(${b.x - b.r + dx}px, ${b.y - b.r + dy}px)`;
      });
      const f = bodies.current[focus];
      if (f) setChip({ x: f.x, y: f.y - f.r - 20 });
      raf = requestAnimationFrame(frame);
    };

    measure();
    raf = requestAnimationFrame(frame);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [objects, layout, focus]);

  const current = objects[focus];

  return (
    <div className="cloud" ref={wrap}>
      {objects.map((o, i) => (
        <button
          key={o.id}
          ref={(n) => { nodes.current[i] = n; }}
          className="obj"
          data-picked={o.picked}
          onClick={() => (i === focus ? onToggle(o.id) : setFocus(i))}
          aria-label={`${o.name}, ${gbp(o.low)} to ${gbp(o.high)}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={o.image} alt="" />
          <span className="obj-shadow" />
          {o.picked && <span className="obj-check"><Check size={12} /></span>}
        </button>
      ))}

      {chip && current && (
        <button
          className="chip"
          style={{ left: chip.x, top: chip.y }}
          onClick={() => onToggle(current.id)}
        >
          {current.name.split(" ").slice(-1)[0].replace(/^./, (c) => c.toUpperCase())}
          <span className="chip-price">{gbp(current.low)}–{gbp(current.high)}</span>
          <Chevron size={14} />
        </button>
      )}
    </div>
  );
}

/* ── List ───────────────────────────────────────────────────── */

function ListView({ objects, onToggle }: { objects: ScannedObject[]; onToggle: (id: string) => void }) {
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "14px 22px 4px" }}>
      {objects.map((o) => (
        <button
          key={o.id}
          onClick={() => onToggle(o.id)}
          style={{
            width: "100%", display: "flex", alignItems: "center", gap: 14,
            padding: "12px 0", borderBottom: "1px solid var(--line)", textAlign: "left",
          }}
        >
          <span
            style={{
              width: 58, height: 58, borderRadius: 14, background: "#f6f6f4",
              display: "grid", placeItems: "center", overflow: "hidden", flex: "0 0 auto",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={o.image} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", mixBlendMode: "multiply" }} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 15, fontWeight: 500, letterSpacing: "-.2px" }}>{o.name}</span>
            <span className="meta" style={{ textTransform: "none" }}>{o.condition}</span>
          </span>
          <span style={{ textAlign: "right", flex: "0 0 auto" }}>
            <span style={{ display: "block", fontSize: 14, fontVariantNumeric: "tabular-nums" }}>
              {gbp(o.low)}–{gbp(o.high)}
            </span>
            <span
              style={{
                display: "inline-grid", placeItems: "center", marginTop: 6,
                width: 22, height: 22, borderRadius: 999,
                background: o.picked ? "var(--accent)" : "transparent",
                border: o.picked ? "none" : "1.5px solid var(--line-2)",
                color: "#fff",
              }}
            >
              {o.picked && <Check size={12} />}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
