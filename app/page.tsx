"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { lotToObject } from "@/lib/mock";
import { loadName, saveFrame, saveName, saveObjects } from "@/lib/store";
import type { ScanResponse } from "@/lib/types";
import { Flip, List, Grid } from "@/components/icons";

export default function ScanScreen() {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const preview = useRef<string | null>(null);
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
    if (preview.current) URL.revokeObjectURL(preview.current);
  }, []);

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setElapsed(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  const scan = useCallback(async (photo: Blob) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (preview.current) URL.revokeObjectURL(preview.current);
    preview.current = URL.createObjectURL(photo);
    setStill(preview.current);
    setNote(null); setBusy(true); setElapsed(0);
    saveObjects([]);
    const form = new FormData(); form.append("frame", photo, "room.jpg");
    try {
      const res = await fetch("/api/scan", { method: "POST", body: form, signal: controller.signal });
      const data = await res.json() as ScanResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "The scan could not finish. Please try again.");
      if (controller.signal.aborted) return;
      saveFrame(data.frameUrl);
      saveObjects(data.lots.map(lotToObject));
      router.push("/review");
    } catch (e) {
      if (controller.signal.aborted) return;
      setNote(e instanceof Error ? e.message : "The scan could not finish. Please try again.");
      setBusy(false);
    }
  }, [router]);

  const capture = async () => {
    const v = video.current;
    if (!camera || !v?.videoWidth) { file.current?.click(); return; }
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(1280, v.videoWidth);
    canvas.height = Math.round(canvas.width * v.videoHeight / v.videoWidth);
    canvas.getContext("2d")?.drawImage(v, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", .9));
    if (blob) void scan(blob);
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
        {busy && <div className="scan-progress" role="status" aria-live="polite">
          <span className="scan-spinner" aria-hidden />
          <strong>Finding and separating items</strong>
          <span>{elapsed < 8 ? "Tracing the objects in your photo…" : `Still working · ${elapsed}s. You can cancel at any time.`}</span>
          <button onClick={cancel}>Cancel scan</button>
        </div>}
      </div>
      <footer className="capture-footer safe-b">
        {note && <p role="alert">{note}</p>}
        <div className="capture-actions">
          <button className="icon-btn" aria-label="Upload photo" onClick={() => file.current?.click()} disabled={busy}><Grid size={23} /></button>
          <button className="shutter" onClick={capture} aria-label="Scan the room" disabled={busy} />
          <button className="icon-btn" aria-label="Flip camera" onClick={() => setFacing(f => f === "user" ? "environment" : "user")} disabled={busy}><Flip size={23} /></button>
        </div>
      </footer>
      <input ref={file} type="file" accept="image/*" style={{ display: "none" }} onChange={e => {
        const photo = e.target.files?.[0]; e.target.value = ""; if (photo) void scan(photo);
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
