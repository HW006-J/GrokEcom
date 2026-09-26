"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MOCK_OBJECTS } from "@/lib/mock";
import { saveObjects } from "@/lib/store";
import { X, Flash, Flip, ChevronUp, Scan } from "@/components/icons";

const SAMPLE_ROOM =
  "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=1200&q=80";

// Where the detection dots land, as a share of the frame.
const HOTSPOTS = [
  { x: 0.29, y: 0.34 },
  { x: 0.74, y: 0.29 },
  { x: 0.55, y: 0.57 },
  { x: 0.21, y: 0.72 },
];

type Phase = "live" | "scanning" | "found";

export default function ScanScreen() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [phase, setPhase] = useState<Phase>("live");
  const [dots, setDots] = useState(0);
  const [facing, setFacing] = useState<"environment" | "user">("environment");

  const start = useCallback(async (mode: "environment" | "user") => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode } },
        audio: false,
      });
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCameraOn(true);
    } catch {
      setCameraOn(false); // fall back to the sample room still
    }
  }, []);

  useEffect(() => {
    start(facing);
    return () => streamRef.current?.getTracks().forEach((t) => t.stop());
  }, [facing, start]);

  // Reveal dots one at a time, then settle on the count.
  useEffect(() => {
    if (phase !== "scanning") return;
    let n = 0;
    const tick = setInterval(() => {
      n += 1;
      setDots(n);
      if (n >= HOTSPOTS.length) {
        clearInterval(tick);
        setTimeout(() => setPhase("found"), 420);
      }
    }, 340);
    return () => clearInterval(tick);
  }, [phase]);

  const capture = () => {
    if (phase !== "live") return;
    setDots(0);
    setPhase("scanning");
  };

  const review = () => {
    saveObjects(MOCK_OBJECTS);
    router.push("/objects");
  };

  const frozen = phase !== "live";

  return (
    <main className="shell" style={{ background: "#0d0d0d" }}>
      <div className="cam">
        {cameraOn ? (
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            style={{ filter: frozen ? "brightness(.92)" : undefined, transition: "filter .3s ease" }}
          />
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            className="cam-still"
            src={SAMPLE_ROOM}
            alt="Sample room"
            style={{ filter: frozen ? "brightness(.92)" : undefined, transition: "filter .3s ease" }}
          />
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
        {HOTSPOTS.slice(0, dots).map((h, i) => (
          <span key={i} className="dot" style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%` }} />
        ))}

        {/* top controls */}
        <div
          className="safe-t"
          style={{ position: "absolute", insetInline: 0, top: 0, display: "flex", justifyContent: "space-between", paddingInline: 18 }}
        >
          <button className="icon-btn" aria-label="Close"><X size={18} /></button>
          <button className="icon-btn" aria-label="Flash"><Flash size={18} /></button>
        </div>

        {/* status line */}
        <div style={{ position: "absolute", insetInline: 0, bottom: 132, display: "grid", placeItems: "center" }}>
          {phase === "scanning" && (
            <span className="meta fade-in" style={{ color: "rgba(255,255,255,.9)" }}>Finding objects…</span>
          )}
          {phase === "found" && (
            <button
              onClick={review}
              className="fade-in"
              style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#fff", fontSize: 14, fontWeight: 500 }}
            >
              {HOTSPOTS.length} objects found <ChevronUp size={16} />
            </button>
          )}
          {phase === "live" && (
            <span className="meta" style={{ color: "rgba(255,255,255,.75)" }}>
              {cameraOn ? "Point at your room" : "Demo room — tap to scan"}
            </span>
          )}
        </div>

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

          <button className="shutter" onClick={capture} aria-label="Scan the room" disabled={phase === "scanning"} />

          <button
            className="icon-btn"
            aria-label="Flip camera"
            onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}
          >
            <Flip size={18} />
          </button>
        </div>
      </div>

      <style>{`@keyframes sweep { 0%{transform:translateY(-100%)} 100%{transform:translateY(100%)} }`}</style>
    </main>
  );
}
