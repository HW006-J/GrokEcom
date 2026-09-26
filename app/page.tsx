"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { lotToObject, type ScannedObject } from "@/lib/mock";
import { loadName, saveFrame, saveName, saveObjects } from "@/lib/store";
import type { ScanResponse } from "@/lib/types";
import { Flash, Flip, ChevronUp, Scan, List } from "@/components/icons";

const SAMPLE_ROOM =
  "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=1200&q=80";

type Phase = "live" | "scanning" | "revealing" | "found";
type Spot = { x: number; y: number };

export default function ScanScreen() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dead = useRef(false);
  const stillRef = useRef<HTMLImageElement>(null);
  const [fit, setFit] = useState<{ left: number; top: number; w: number; h: number } | null>(null);
  const [stillUrl, setStillUrl] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [phase, setPhase] = useState<Phase>("live");
  const [dots, setDots] = useState(0);
  const [spots, setSpots] = useState<Spot[]>([]);
  const [objects, setObjects] = useState<ScannedObject[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");

  /** Where the contained photo really is inside its box, so markers can follow it. */
  const measureStill = useCallback(() => {
    const img = stillRef.current;
    if (!img || !img.naturalWidth) return;
    const box = img.getBoundingClientRect();
    const scale = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    setFit({ left: (box.width - w) / 2, top: (box.height - h) / 2, w, h });
  }, []);

  useEffect(() => {
    if (phase === "live") return;
    measureStill();
  }, [measureStill, dots, phase]);

  const attach = useCallback((stream: MediaStream | null) => {
    const v = videoRef.current;
    if (!v || !stream) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    v.play().catch(() => {});
  }, []);

  const start = useCallback(async (mode: "environment" | "user") => {
    if (!navigator.mediaDevices?.getUserMedia) { setCameraOn(false); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode } },
        audio: false,
      });
      if (dead.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = stream;
      setCameraOn(true);
      attach(stream);
    } catch {
      setCameraOn(false);
    }
  }, [attach]);

  useEffect(() => {
    dead.current = false;
    // Off the effect body so the permission prompt never blocks the first paint.
    void Promise.resolve().then(() => start(facing));
    return () => { dead.current = true; };
  }, [facing, start]);

  // The <video> is always in the tree, so the stream has something to attach to
  // even on the first pass. Re-attach whenever React re-renders it.
  useEffect(() => { attach(streamRef.current); }, [attach, cameraOn, name]);

  // Stop the hardware only when the screen itself goes away.
  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => { setName(loadName()); }, []);

  // Reveal the dots one at a time once the scan comes back.
  useEffect(() => {
    if (phase !== "revealing" || spots.length === 0) return;
    let n = 0;
    const tick = setInterval(() => {
      n += 1;
      setDots(n);
      if (n >= spots.length) {
        clearInterval(tick);
        setTimeout(() => setPhase("found"), 420);
      }
    }, 340);
    return () => clearInterval(tick);
  }, [phase, spots.length]);

  const grabFrame = async (): Promise<Blob | null> => {
    const v = videoRef.current;
    if (!cameraOn || !v || !v.videoWidth) return null;
    const width = Math.min(1280, v.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = Math.round((v.videoHeight / v.videoWidth) * width);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85));
  };

  /** Send a frame to the scanner and drive the reveal. */
  const runScan = async (source: Blob | { sampleUrl: string }) => {
    setDots(0);
    setSpots([]);
    setNote(null);
    setPhase("scanning");

    const form = new FormData();
    if (source instanceof Blob) {
      form.append("frame", source, "room.jpg");
      saveFrame(source);
      setStillUrl(URL.createObjectURL(source));
    } else {
      form.append("sampleUrl", source.sampleUrl);
      saveFrame(source.sampleUrl);
    }

    try {
      const res = await fetch("/api/scan", { method: "POST", body: form });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as ScanResponse;
      const found = (data.lots ?? []).map(lotToObject);

      if (found.length === 0) {
        setNote("Nothing worth selling in view. Try another angle.");
        setPhase("live");
        return;
      }

      setObjects(found);
      setSpots(
        (data.lots ?? []).map((l) => ({
          x: l.bbox ? l.bbox.x + l.bbox.w / 2 : 0.5,
          y: l.bbox ? l.bbox.y + l.bbox.h / 2 : 0.5,
        }))
      );
      setPhase("revealing");
    } catch {
      setNote("The scan did not come back. Check the connection and try again.");
      setPhase("live");
    }
  };

  /**
   * With a live camera, grab the current frame. Without one, and that includes
   * every phone on a plain http address, open the native camera instead so the
   * scan still runs on the room the person is actually standing in.
   */
  const capture = async () => {
    if (phase !== "live") return;
    if (cameraOn) {
      const blob = await grabFrame();
      if (blob) return runScan(blob);
    }
    fileRef.current?.click();
  };

  const onPickPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setStillUrl(URL.createObjectURL(file));
    runScan(file);
  };

  const review = () => {
    if (objects.length === 0) return;
    saveObjects(objects);
    router.push("/review");
  };

  const frozen = phase !== "live";

  return (
    <main className="shell" style={{ background: "#0d0d0d" }}>
      <div className="cam">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          style={{
            transition: "filter .3s ease",
            opacity: cameraOn && !frozen ? 1 : 0,
          }}
        />

        {/* Once captured we show the exact frame we scanned, whole and uncropped,
            so the markers land on the objects rather than on a cover-crop of them. */}
        {frozen && stillUrl && (
          <div style={{ position: "absolute", inset: 0, background: "#0d0d0d" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={stillRef}
              src={stillUrl}
              alt="Your room"
              onLoad={measureStill}
              style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", filter: "brightness(.92)" }}
            />
          </div>
        )}
        {!cameraOn && !frozen && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "#0d0d0d" }}>
            {stillUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                className="cam-still"
                src={stillUrl}
                alt="Your room"
                style={{ filter: frozen ? "brightness(.92)" : undefined, transition: "filter .3s ease" }}
              />
            ) : (
              <p className="meta" style={{ color: "rgba(255,255,255,.7)", textAlign: "center", padding: 24 }}>
                Tap the button to photograph your room
              </p>
            )}
          </div>
        )}

        {/* scan sweep */}
        {phase === "scanning" && (
          <div
            aria-hidden
            style={{
              position: "absolute", inset: 0,
              background: "linear-gradient(180deg, transparent 0%, rgba(10,108,255,.22) 50%, transparent 100%)",
              animation: "sweep 1.4s ease-in-out infinite",
            }}
          />
        )}

        {/* detection dots */}
        {spots.slice(0, dots).map((h, i) => (
          <span
            key={i}
            className="dot"
            style={
              fit
                ? { left: fit.left + h.x * fit.w, top: fit.top + h.y * fit.h }
                : { left: `${h.x * 100}%`, top: `${h.y * 100}%` }
            }
          />
        ))}

        {/* top controls */}
        <div
          className="safe-t"
          style={{ position: "absolute", insetInline: 0, top: 0, display: "flex", justifyContent: "space-between", paddingInline: 18 }}
        >
          <button className="icon-btn" aria-label="Your sales" onClick={() => router.push("/dashboard")}>
            <List size={18} />
          </button>
          <button className="icon-btn" aria-label="Flash"><Flash size={18} /></button>
        </div>

        {/* status line */}
        <div style={{ position: "absolute", insetInline: 0, bottom: 132, display: "grid", placeItems: "center", paddingInline: 24, textAlign: "center" }}>
          {phase === "scanning" && (
            <span className="meta fade-in" style={{ color: "rgba(255,255,255,.9)" }}>Finding objects…</span>
          )}
          {(phase === "found" || phase === "revealing") && (
            <button
              onClick={review}
              className="fade-in"
              style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#fff", fontSize: 14, fontWeight: 500, opacity: phase === "found" ? 1 : 0.55 }}
            >
              {spots.length} {spots.length === 1 ? "object" : "objects"} found <ChevronUp size={16} />
            </button>
          )}
          {phase === "live" && (
            <span className="meta" style={{ color: "rgba(255,255,255,.75)" }}>
              {note ?? (cameraOn ? "Point at your room" : "Demo room — tap to scan")}
            </span>
          )}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onPickPhoto}
          style={{ display: "none" }}
        />

        {/* camera bar */}
        <div className="cam-bar">
          <button
            onClick={review}
            aria-label="Your objects"
            style={{
              width: 44, height: 44, minHeight: 44, borderRadius: 12, overflow: "hidden",
              border: "1.5px solid rgba(255,255,255,.55)", background: "rgba(255,255,255,.12)",
              display: "grid", placeItems: "center", color: "#fff",
            }}
          >
            <Scan size={18} />
          </button>

          <button className="shutter" onClick={capture} aria-label="Scan the room" disabled={phase !== "live"} />

          <button
            className="icon-btn"
            aria-label="Flip camera"
            onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}
          >
            <Flip size={18} />
          </button>
        </div>
      </div>

      {name === null && (
        <div
          style={{
            position: "absolute", inset: 0, zIndex: 30,
            background: "rgba(0,0,0,.45)", backdropFilter: "blur(6px)",
            display: "flex", alignItems: "flex-end",
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const v = draftName.trim();
              if (!v) return;
              saveName(v);
              setName(v);
            }}
            className="fade-in safe-b"
            style={{ width: "100%", background: "#fff", borderRadius: "26px 26px 0 0", padding: "24px 22px 14px" }}
          >
            <h2 className="title">First, who are you?</h2>
            <p className="sub" style={{ marginTop: 6 }}>
              Your name goes on the sale, and it is the name you bid under.
            </p>
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="Your name"
              maxLength={24}
              enterKeyHint="go"
              style={{
                width: "100%", marginTop: 18, padding: "14px 16px",
                borderRadius: 999, border: "1.5px solid var(--line-2)",
                fontSize: 16, fontFamily: "inherit", color: "var(--ink)", background: "#fff",
                outlineColor: "var(--accent)",
              }}
            />
            <button className="pill pill--primary" type="submit" style={{ width: "100%", marginTop: 12 }} disabled={!draftName.trim()}>
              Start scanning
            </button>
          </form>
        </div>
      )}

      <style>{`@keyframes sweep { 0%{transform:translateY(-100%)} 100%{transform:translateY(100%)} }`}</style>
    </main>
  );
}
