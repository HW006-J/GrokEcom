"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { gbp, type ScannedObject } from "@/lib/mock";
import { loadObjects, saveObjects } from "@/lib/store";
import { Chevron, Grid, List, Scan } from "@/components/icons";

export default function ObjectsScreen() {
  const router = useRouter();
  const [objects, setObjects] = useState<ScannedObject[]>([]);
  const [layout, setLayout] = useState<"gallery" | "list">("gallery");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    Promise.resolve().then(() => { if (alive) { setObjects((loadObjects() ?? []).filter(o => o.picked)); setReady(true); } });
    return () => { alive = false; };
  }, []);
  const total = objects.reduce((n, o) => n + o.low, 0);
  const remove = (id: string) => {
    saveObjects((loadObjects() ?? []).map(o => o.id === id ? { ...o, picked: false } : o));
    setObjects(old => old.filter(o => o.id !== id));
  };
  return <main className="shell collection-shell">
    <header className="review-header safe-t"><div><h1>Your objects</h1><p>{objects.length} objects{total ? ` · ${gbp(total)} estimate` : ""}</p></div><div className="collection-toggle" aria-label="Display style"><button aria-label="Gallery view" aria-pressed={layout === "gallery"} onClick={() => setLayout("gallery")}><Grid size={18}/></button><button aria-label="List view" aria-pressed={layout === "list"} onClick={() => setLayout("list")}><List size={18}/></button></div></header>
    <div className="review-scroll">
      <div className={`collection-items collection-items--${layout}`}>{objects.map((o) => <article className="collection-item" key={o.id}>
        <button className="collection-image" aria-label={`Review ${o.name}`} onClick={() => router.push("/review?view=cloud")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={o.generatedImage || o.image} alt={o.name} />
        </button>
        <button className="collection-label" onClick={() => router.push("/review")}><span>{o.name}{o.low ? ` · ${gbp(o.low)}–${gbp(o.high)}` : ""}</span><Chevron size={14}/></button>
        {layout === "list" && <button className="collection-remove" onClick={() => remove(o.id)} aria-label={`Remove ${o.name}`}>Remove</button>}
        {o.generatedImage && <span className="generated-label">AI preview</span>}
      </article>)}</div>
      {ready && !objects.length && <div className="review-empty"><h2 className="title">No items selected</h2><p>Go back to your photo to choose what you want to sell.</p></div>}
    </div>
    <footer className="collection-dock safe-b"><button onClick={() => router.push("/")}><Scan size={21}/> Scan</button><button className="pill pill--primary" disabled={!objects.length || objects.some(o => !o.low)} onClick={() => router.push("/auction")}>Sell {objects.length || ""} <Chevron size={17} /></button></footer>
  </main>;
}
