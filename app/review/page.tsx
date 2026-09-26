"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { gbp, type ScannedObject } from "@/lib/mock";
import { loadFrame, loadObjects, saveObjects } from "@/lib/store";
import type { Comp } from "@/lib/types";
import { X, Chevron, Check, Scan } from "@/components/icons";

export default function ReviewScreen() {
  const router = useRouter();
  const [objects, setObjects] = useState<ScannedObject[]>([]);
  const [frame, setFrame] = useState<string>("");
  const [ratio, setRatio] = useState(4 / 3);
  const [focus, setFocus] = useState<string | null>(null);
  const [pricing, setPricing] = useState<string[]>([]);
  const refined = useRef<Set<string>>(new Set());
  const strip = useRef<HTMLDivElement>(null);

  // Whatever the scan actually produced. Nothing is invented here.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const found = loadObjects() ?? [];
    setObjects(found);
    setFocus(found[0]?.id ?? null);
    const f = loadFrame();
    if (f) setFrame(f);
    setReady(true);
  }, []);

  // Check what each thing actually sells for, one live web search apiece.
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

  // Isolating an object takes ~20s, so start it the moment we have objects.
  // By the time anyone reaches the cloud most cutouts have already landed.
  const cutting = useRef<Set<string>>(new Set());
  useEffect(() => {
    const todo = objects.filter((o) => !o.cutout && o.image && !cutting.current.has(o.id));
    if (todo.length === 0) return;
    todo.forEach((o) => cutting.current.add(o.id));

    todo.forEach(async (o) => {
      try {
        const res = await fetch("/api/cutout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrl: o.image }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const { imageUrl } = (await res.json()) as { imageUrl?: string };
        if (!imageUrl) return;
        setObjects((prev) => {
          const next = prev.map((x) => (x.id === o.id ? { ...x, image: imageUrl, cutout: true } : x));
          saveObjects(next);
          return next;
        });
      } catch {
        // the crop still works on the review photo; the cloud will just wait
      }
    });
  }, [objects]);

  const toggle = (id: string) => {
    setFocus(id);
    setObjects((prev) => {
      const next = prev.map((o) => (o.id === id ? { ...o, picked: !o.picked } : o));
      saveObjects(next);
      return next;
    });
  };

  const show = (id: string) => {
    setFocus(id);
    const card = strip.current?.querySelector<HTMLElement>(`[data-card="${id}"]`);
    card?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  };

  const picked = objects.filter((o) => o.picked);
  const busy = pricing.length > 0;

  const sell = () => {
    saveObjects(objects);
    router.push("/objects");
  };

  if (ready && objects.length === 0) {
    return (
      <main className="shell" style={{ display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ textAlign: "center" }}>
          <p className="title">No scan yet</p>
          <p className="sub" style={{ marginTop: 6 }}>Photograph a room and we will find what is worth selling.</p>
          <button className="pill pill--dark" style={{ marginTop: 18 }} onClick={() => router.push("/")}>
            <Scan size={18} /> Scan a room
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="pad safe-t" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 className="display">What shall we sell?</h1>
          <p className="sub" style={{ marginTop: 6 }}>
            {busy
              ? `${objects.length} found · checking live prices…`
              : `${picked.length} of ${objects.length} chosen · ${gbp(picked.reduce((s, o) => s + o.low, 0))}–${gbp(picked.reduce((s, o) => s + o.high, 0))}`}
          </p>
        </div>
        <button className="icon-btn icon-btn--light" aria-label="Back to camera" onClick={() => router.push("/")}>
          <X size={18} />
        </button>
      </header>

      {/* The photo, with everything worth money outlined on it */}
      <div style={{ padding: "14px 18px 0" }}>
        <div
          style={{
            position: "relative", width: "100%", aspectRatio: String(ratio),
            borderRadius: 20, overflow: "hidden", background: "#f2f2f0",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {frame ? <img
            src={frame}
            alt="Your room"
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth && img.naturalHeight) setRatio(img.naturalWidth / img.naturalHeight);
            }}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          /> : null}

          {objects.map((o) => {
            if (!o.bbox) return null;
            const on = o.picked;
            const isFocus = focus === o.id;
            return (
              <button
                key={o.id}
                onClick={() => { toggle(o.id); show(o.id); }}
                aria-label={`${o.name}, ${on ? "selected" : "not selected"}`}
                aria-pressed={on}
                style={{
                  position: "absolute",
                  left: `${o.bbox.x * 100}%`,
                  top: `${o.bbox.y * 100}%`,
                  width: `${o.bbox.w * 100}%`,
                  height: `${o.bbox.h * 100}%`,
                  minHeight: 0,
                  padding: 0,
                  borderRadius: 12,
                  border: on ? "2.5px solid var(--accent)" : "2px solid rgba(255,255,255,.85)",
                  boxShadow: on
                    ? "0 0 0 2px rgba(10,108,255,.18), inset 0 0 0 100vmax rgba(10,108,255,.10)"
                    : isFocus ? "0 0 0 2px rgba(255,255,255,.35)" : "0 1px 6px rgba(0,0,0,.18)",
                  transition: "border-color .18s ease, box-shadow .18s ease",
                }}
              >
                <span
                  className="obj-check"
                  style={{
                    right: -8, top: -8,
                    background: on ? "var(--accent)" : "rgba(255,255,255,.92)",
                    color: on ? "#fff" : "var(--ink-3)",
                    boxShadow: "0 2px 8px rgba(0,0,0,.2)",
                  }}
                >
                  <Check size={12} />
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* One card per object, so the price and the name have somewhere to live */}
      <div
        ref={strip}
        style={{
          display: "flex", gap: 10, overflowX: "auto", padding: "14px 18px 6px",
          scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch",
        }}
      >
        {objects.map((o) => {
          const on = o.picked;
          const waiting = pricing.includes(o.id);
          return (
            <button
              key={o.id}
              data-card={o.id}
              onClick={() => toggle(o.id)}
              style={{
                flex: "0 0 auto", width: 168, minHeight: 0, textAlign: "left",
                padding: 10, borderRadius: 16, scrollSnapAlign: "center",
                background: "#fff",
                border: on ? "1.5px solid var(--accent)" : "1.5px solid var(--line)",
                boxShadow: focus === o.id ? "var(--shadow-soft)" : "none",
                opacity: on ? 1 : 0.62,
                transition: "opacity .18s ease, border-color .18s ease",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 42, height: 42, borderRadius: 10, background: "#f6f6f4", overflow: "hidden", flex: "0 0 auto" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={o.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 500, letterSpacing: "-.2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {o.name}
                  </span>
                  <span className="meta" style={{ textTransform: "none", fontVariantNumeric: "tabular-nums" }}>
                    {waiting ? "pricing…" : `${gbp(o.low)}–${gbp(o.high)}`}
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <footer className="pad safe-b" style={{ paddingTop: 8, marginTop: "auto" }}>
        <div className="dock">
          <button className="pill pill--ghost" style={{ flex: "0 0 auto" }} onClick={() => router.push("/")}>
            <Scan size={18} /> Retake
          </button>
          <span className="dock-divider" />
          <button className="pill pill--primary" style={{ flex: 1 }} onClick={sell} disabled={picked.length === 0}>
            Sell {picked.length} <Chevron size={17} />
          </button>
        </div>
      </footer>
    </main>
  );
}
