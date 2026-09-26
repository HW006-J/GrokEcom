"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { gbp, type ScannedObject } from "@/lib/mock";
import { PriceEvidence } from "@/components/price-evidence";
import { loadFrame, loadObjects, saveObjects } from "@/lib/store";
import type { BBox, Comp } from "@/lib/types";
import { X, Chevron, Check, Flip, Scan } from "@/components/icons";

import { ObjectCloud } from "@/components/object-cloud";

type Point = { x: number; y: number };
const boxBetween = (a: Point, b: Point): BBox => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });

export default function ReviewScreen() {
  const router = useRouter();
  const [objects, setObjects] = useState<ScannedObject[]>([]);
  const [frame, setFrame] = useState("");
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<"photo" | "cloud">("photo");
  const [focus, setFocus] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<string | null>(null); // 'new' or an existing item
  const [draftBox, setDraftBox] = useState<BBox | null>(null);
  const [segmenting, setSegmenting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pricing, setPricing] = useState<string[]>([]);
  const [failed, setFailed] = useState<string[]>([]);
  const origin = useRef<Point | null>(null);
  const requests = useRef(new Map<string, AbortController>());
  const regionRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.resolve().then(() => {
      if (!alive) return;
      const found = loadObjects() ?? [];
      setView(new URLSearchParams(window.location.search).get("view") === "cloud" ? "cloud" : "photo");
      setObjects(found); setFrame(loadFrame() ?? ""); setFocus(null); setReady(true);
    });
    const pending = requests.current;
    return () => { alive = false; pending.forEach(c => c.abort()); regionRequest.current?.abort(); };
  }, []);

  const change = (fn: (old: ScannedObject[]) => ScannedObject[]) => {
    setObjects(old => { const next = fn(old); saveObjects(next); return next; });
  };

  const estimate = async (item: ScannedObject) => {
    requests.current.get(item.id)?.abort();
    const controller = new AbortController(); requests.current.set(item.id, controller);
    setPricing(old => [...new Set([...old, item.id])]); setFailed(old => old.filter(id => id !== item.id));
    try {
      const response = await fetch("/api/price", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: item.name, category: item.category, condition: item.condition }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]),
      });
      if (!response.ok) throw new Error("Price unavailable");
      const est = await response.json() as { low: number; high: number; reserve: number; comps: Comp[] };
      if (!Number.isFinite(est.low) || est.low <= 0 || !Number.isFinite(est.high)) throw new Error("Price unavailable");
      change(old => old.map(o => o.id === item.id && o.name === item.name ? { ...o, ...est } : o));
    } catch {
      if (!controller.signal.aborted) setFailed(old => [...old, item.id]);
    } finally {
      if (requests.current.get(item.id) === controller) {
        requests.current.delete(item.id);
        setPricing(old => old.filter(id => id !== item.id));
      }
    }
  };

  const select = (item: ScannedObject) => {
    setFocus(item.id);
    if (item.name === "New item") { setNotice("Give this item a name before selecting it."); return; }
    change(old => old.map(o => o.id === item.id ? { ...o, picked: !o.picked } : o));
    if (!item.picked && !item.low) void estimate(item);
  };

  const rename = (item: ScannedObject, value: string) => {
    const name = value.trim().slice(0, 80) || item.name;
    if (name === item.name) return;
    requests.current.get(item.id)?.abort();
    const next = { ...item, name, low: 0, high: 0, reserve: 0, comps: [] };
    change(old => old.map(o => o.id === item.id ? next : o));
    if (next.picked) void estimate(next);
  };

  const position = (e: React.PointerEvent<HTMLDivElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)) };
  };

  const finishRegion = async (bbox: BBox) => {
    if (bbox.w < .025 || bbox.h < .025) { setNotice("Draw a box around the whole item, from one corner to the other."); return; }
    const target = drawing; setSegmenting(true); setNotice(null);
    const controller = new AbortController(); regionRequest.current = controller;
    try {
      const res = await fetch("/api/segment", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frame, bbox }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not separate this item. Try a tighter box.");
      const id = target === "new" ? crypto.randomUUID() : target!;
      change(old => target === "new" ? [...old, { id, name: "New item", category: "Other", image: data.imageUrl,
        maskUrl: data.maskUrl, bbox: data.bbox, cutout: true, low: 0, high: 0, condition: "Used — check condition", blurb: "", picked: false,
      }] : old.map(o => o.id === id ? { ...o, image: data.imageUrl, generatedImage: undefined, maskUrl: data.maskUrl, bbox: data.bbox, cutout: true } : o));
      setFocus(id); setDrawing(null); setDraftBox(null);
      setNotice(target === "new" ? "Item added. Give it a name, then select it." : "Outline updated. Check the cutout before selecting it.");
    } catch (e) {
      if (!controller.signal.aborted) setNotice(e instanceof Error ? e.message : "Could not separate this item.");
    } finally { setSegmenting(false); }
  };

  const regenerate = async (item: ScannedObject) => {
    if (!item.bbox || !frame || segmenting) return;
    setRegenerating(item.id); setSegmenting(true); setNotice(null);
    const controller = new AbortController(); regionRequest.current = controller;
    try {
      const res = await fetch("/api/object-image", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({image:item.image,name:item.name}), signal: AbortSignal.any([controller.signal,AbortSignal.timeout(180000)]) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not regenerate image.");
      change(old => old.map(o => o.id === item.id ? {...o,generatedImage:data.imageUrl} : o));
      setNotice("Preview regenerated.");
    } catch (error) {
      if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "Could not regenerate this image. Your previous image is still saved.");
    } finally { setRegenerating(null); setSegmenting(false); }
  };

  const generateCloud = async () => {
    if (generating) return;
    setGenerating(true); setNotice(null);
    try {
      for (const item of objects) {
        const res = await fetch("/api/object-image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: item.image, name: item.name }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        change(old => old.map(o => o.id === item.id && o.image === item.image ? { ...o, generatedImage: data.imageUrl } : o));
      }
    } catch (e) { setNotice(e instanceof Error ? e.message : "Could not generate images."); }
    finally { setGenerating(false); }
  };

  const picked = objects.filter(o => o.picked);
  const needsPrice = picked.some(o => !o.low || pricing.includes(o.id));
  const current = objects.find(o => o.id === focus);

  if (!ready) return <main className="shell" aria-busy="true" />;
  return (
    <main className="shell">
      <header className="review-header safe-t"><div><h1>Your objects</h1><p>{objects.length ? `${objects.length} found · ${picked.length} selected` : "No items detected"}</p></div>
        <button className="icon-btn icon-btn--light" aria-label="Retake photo" onClick={() => router.push("/")}><X size={18} /></button>
      </header>
      <nav className="review-view-toggle" aria-label="Object view">
        <button aria-pressed={view === "photo"} onClick={() => setView("photo")}>Photo</button>
        <button aria-pressed={view === "cloud"} onClick={() => { setView("cloud"); setDrawing(null); setDraftBox(null); }} disabled={segmenting}>Objects</button>
      </nav>
      <div className="review-scroll">
        {view === "cloud" && <ObjectCloud generating={generating} onGenerate={generateCloud} objects={objects} onSelect={select} onInspect={id => { setFocus(id); setView("photo"); requestAnimationFrame(() => document.getElementById(`item-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" })); }} />}
        <div hidden={view !== "photo"}>
        {frame && <div className="review-photo" data-editing={!!drawing} aria-label={drawing ? "Draw around an item" : "Detected items in your photo"}
          onPointerDown={e => { if (!drawing || segmenting) return; e.currentTarget.setPointerCapture(e.pointerId); origin.current = position(e); setDraftBox(null); }}
          onPointerMove={e => { if (origin.current && drawing) setDraftBox(boxBetween(origin.current, position(e))); }}
          onPointerCancel={() => { origin.current = null; setDraftBox(null); }}
          onPointerUp={e => { if (!origin.current || !drawing || segmenting) return; const box = boxBetween(origin.current, position(e)); origin.current = null; setDraftBox(box); void finishRegion(box); }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={frame} alt="Your room" draggable={false} />
          {!drawing && current?.maskUrl && <div className="object-mask" style={{ maskImage: `url("${current.maskUrl}")` }} />}
          {!drawing && objects.map((o, index) => o.bbox && <button className="object-pin" key={o.id} data-focus={focus === o.id}
            aria-label={`Inspect ${o.name}`} onClick={() => { setFocus(o.id); }}
            style={{ left: `${Math.min(.96, Math.max(.04, o.bbox.x + o.bbox.w / 2)) * 100}%`, top: `${Math.min(.94, Math.max(.06, o.bbox.y + o.bbox.h / 2)) * 100}%` }}>{index + 1}</button>)}
          {draftBox && drawing && <span className="draw-box" style={{ left: `${draftBox.x * 100}%`, top: `${draftBox.y * 100}%`, width: `${draftBox.w * 100}%`, height: `${draftBox.h * 100}%` }} />}
        </div>}
        <div className="review-tools"><p>{segmenting ? "Separating the pixels…" : drawing ? "Drag from corner to corner around the item." : objects.length ? "" : ""}</p>
          {frame && <button disabled={segmenting || (!drawing && objects.length >= 12)} onClick={() => { setDrawing(drawing ? null : "new"); setDraftBox(null); }}>{drawing ? "Cancel" : "+ Add item"}</button>}
        </div>
        {notice && <p className="review-notice" role="status">{notice}</p>}
        {!objects.length && <div className="review-empty"><h2 className="title">Find your item</h2><p>Tap Add item and draw around it, or try another photo.</p><button className="pill pill--quiet" onClick={() => router.push("/")}>Retake photo</button></div>}
        <div className="item-list">
          {objects.map(o => <article className="review-item" data-card={o.id} data-focus={focus === o.id} key={o.id} id={`item-${o.id}`}>
            <div className="item-summary">
              <button className="item-thumb" aria-label={`Inspect cutout of ${o.name}`} onClick={() => setFocus(o.id)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={o.image} alt={o.name} /></button>
              <div className="item-copy"><button onClick={() => setFocus(focus === o.id ? null : o.id)}>{o.name}</button>
                <p>{pricing.includes(o.id) ? "Estimating…" : o.low ? `${gbp(o.low)}–${gbp(o.high)} estimated` : failed.includes(o.id) ? "Price unavailable — retry below" : "Select for estimate"}</p>
                {o.low > 0 && !pricing.includes(o.id) && focus !== o.id && !!o.comps?.length && <PriceEvidence comps={o.comps} compact />}
              </div>
              <button className="item-select" aria-label={`${o.picked ? "Deselect" : "Select"} ${o.name}`} aria-pressed={o.picked} onClick={() => select(o)}>{o.picked ? <Check size={18} /> : "+"}</button>
            </div>
            {focus === o.id && <div className="item-details">
              <div className="cutout-preview" aria-busy={regenerating === o.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={o.generatedImage || o.image} alt={`Isolated ${o.name}`} />
                {regenerating === o.id && <span role="status">Regenerating…</span>}
                <div className="image-edit-tools">
                  <button aria-label="Regenerate image" title="Regenerate image" disabled={segmenting} onClick={() => void regenerate(o)}><Flip size={18}/></button>
                  <button aria-label="Adjust outline" title="Adjust outline" disabled={segmenting} onClick={() => { setDrawing(o.id); setDraftBox(null); document.querySelector(".review-photo")?.scrollIntoView({block:"start",behavior:"smooth"}); }}><Scan size={18}/></button>
                </div>
              </div>
              <div className="item-name-wrap"><input aria-label="Item name" className="item-name-input" key={`${o.id}-${o.name}`} defaultValue={o.name} onBlur={e => rename(o,e.target.value)} maxLength={80}/>
                <button aria-label={`Remove ${o.name}`} title="Remove item" onClick={() => { requests.current.get(o.id)?.abort(); change(old => old.filter(x => x.id !== o.id)); setFocus(null); }}><X size={18}/></button>
              </div>
              {o.low > 0 && !pricing.includes(o.id) && <PriceEvidence comps={o.comps} />}
              {failed.includes(o.id) && <button onClick={() => void estimate(o)}>Retry price</button>}
            </div>}
          </article>)}
        </div>
        </div>
        {view === "cloud" && notice && <p className="review-notice" role="status">{notice}</p>}
      </div>
      {objects.length > 0 && <footer className="review-footer safe-b"><button className="pill pill--primary" disabled={!picked.length || needsPrice || segmenting} onClick={() => { saveObjects(objects); router.push("/objects"); }}>
        {picked.length === 0 ? "Select items" : needsPrice ? "Estimating…" : `Continue with ${picked.length} ${picked.length === 1 ? "item" : "items"}`} {!needsPrice && picked.length > 0 && <Chevron size={17} />}
      </button></footer>}
    </main>
  );
}
