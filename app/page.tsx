"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { lotToObject } from "@/lib/mock";
import { loadName, saveFrames, saveFrame, saveName, saveObjects } from "@/lib/store";
import type { ScanResponse } from "@/lib/types";
import { Flip, List, Grid } from "@/components/icons";

export default function ScanScreen() {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const previews = useRef<string[]>([]);
  const [photos, setPhotos] = useState<{id:string; blob:Blob; url:string; result?:ScanResponse}[]>([]);
  const [progress, setProgress] = useState(0);
  const [camera, setCamera] = useState(false);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [name, setName] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [still, setStill] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.resolve().then(() => { if (alive) setName(loadName()); });
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: { ideal: facing } }, audio: false })
      .then(s => {
        if (!alive) { s.getTracks().forEach(t => t.stop()); return; }
        stream.current = s;
        if (video.current) { video.current.srcObject = s; void video.current.play().catch(() => {}); }
        setCamera(true);
      }).catch(() => { if (alive) setCamera(false); });
    return () => { alive = false; stream.current?.getTracks().forEach(t => t.stop()); };
  }, [facing]);

  useEffect(() => () => {
    request.current?.abort();
    previews.current.forEach(url => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setElapsed(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  const addPhotos = (blobs: Blob[]) => {
    const added = blobs.slice(0, Math.max(0, 6 - photos.length)).map(blob => {
      const url = URL.createObjectURL(blob); previews.current.push(url);
      return { id: crypto.randomUUID(), blob, url };
    });
    setPhotos(old => [...old, ...added]); setNote(null); setStill(null);
  };

  const scan = async () => {
    if (!photos.length || busy) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setElapsed(0); setNote(null);
    const results: ScanResponse[] = [];
    try {
      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i]; setProgress(i + 1); setStill(photo.url);
        let data = photo.result;
        if (!data) {
          const form = new FormData(); form.append("frame", photo.blob, "room.jpg");
          const res = await fetch("/api/scan", { method:"POST", body:form, signal:controller.signal });
          const body = await res.json();
          if (!res.ok) throw new Error(body.error ?? "Could not scan this photo. Try again.");
          data = body as ScanResponse;
          setPhotos(old => old.map(p => p.id === photo.id ? {...p,result:data} : p));
        }
        if (controller.signal.aborted) return;
        results.push(data);
      }
      saveFrames(results.map(result => result.frameUrl));
      saveFrame(results[0].frameUrl);
      saveObjects(results.flatMap(result => result.lots.map(lot => ({
        ...lotToObject(lot), source_image_url:result.frameUrl,
      }))));
      router.push("/review");
    } catch (e) {
      if (!controller.signal.aborted) setNote(e instanceof Error ? e.message : "Scan failed. Try again.");
      setBusy(false); setStill(null);
    }
  };

  const capture = async () => {
    const v = video.current;
    if (!camera || !v?.videoWidth) { file.current?.click(); return; }
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(1280, v.videoWidth);
    canvas.height = Math.round(canvas.width * v.videoHeight / v.videoWidth);
    canvas.getContext("2d")?.drawImage(v, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", .9));
    if (blob) addPhotos([blob]);
  };

  const cancel = () => {
    request.current?.abort();
    setBusy(false); setStill(null); setNote(null);
  };

  return (
    <main className="shell capture-shell">
      <header className="capture-header safe-t">
        <button className="icon-btn" aria-label="Your sales" onClick={() => router.push("/dashboard")}><List size={20} /></button>
        <span aria-hidden="true" />
        <button className="icon-btn" aria-label="Flip camera" disabled={busy} onClick={() => setFacing(f => f === "user" ? "environment" : "user")}><Flip size={20} /></button>
      </header>
      <div className="capture-view">
        <video ref={video} playsInline muted autoPlay style={{ opacity: still ? 0 : 1 }} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {still && <img src={still} alt="Photo being scanned" />}
        {!camera && !still && <p>Add a photo<br /><span>Keep the whole item in view.</span></p>}

      </div>
      <footer className="capture-footer safe-b">
        {note && <p role="alert">{note}</p>}
        {!!photos.length && <div className="capture-filmstrip" aria-label="Captured photos">
          {photos.map((photo,i) => <div key={photo.id} data-active={busy && progress === i + 1}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.url} alt={`Photo ${i+1}`}/>
            {!busy && <button aria-label={`Remove photo ${i+1}`} disabled={busy} onClick={() => {
              URL.revokeObjectURL(photo.url); setPhotos(old => old.filter(p => p.id !== photo.id));
            }}>×</button>}
          </div>)}
        </div>}
        {busy && <div className="capture-scan-status" role="status" aria-live="polite">
          <span className="scan-spinner" aria-hidden />
          <strong>Scanning photo {progress} of {photos.length}</strong>
          <span>{elapsed < 8 ? "Finding your items…" : `Still working · ${elapsed}s`}</span>
          <button onClick={cancel}>Cancel scan</button>
        </div>}
        {!busy && <>
        <div className="capture-actions">
          <button className="icon-btn" aria-label="Upload photos" onClick={() => file.current?.click()} disabled={busy}><Grid size={23} /></button>
          <button className="shutter" onClick={capture} aria-label="Take photo" disabled={busy || photos.length >= 6} />
          <button className="icon-btn" aria-label="Flip camera" onClick={() => setFacing(f => f === "user" ? "environment" : "user")} disabled={busy}><Flip size={23} /></button>
        </div>
        {!!photos.length && <button className="capture-review" disabled={busy} onClick={() => void scan()}>Review {photos.length} {photos.length === 1 ? "photo" : "photos"} <span aria-hidden="true">›</span></button>}
        </>}
      </footer>
      <input ref={file} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={e => {
        const selected = Array.from(e.target.files ?? []); e.target.value = ""; addPhotos(selected);
      }} />
      {name === null && <div className="name-gate"><form onSubmit={e => {
        e.preventDefault(); if (!draft.trim()) return; saveName(draft); setName(draft.trim());
      }}>
        <h2 className="title">Your name</h2><p className="sub">Your name will appear on your sale.</p>
        <input autoFocus placeholder="Your name" value={draft} onChange={e => setDraft(e.target.value)} maxLength={24} />
        <button className="pill pill--dark" type="submit" disabled={!draft.trim()}>Continue</button>
      </form></div>}
    </main>
  );
}
