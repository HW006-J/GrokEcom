"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { MOCK_OBJECTS, gbp, type ScannedObject } from "@/lib/mock";
import { loadObjects } from "@/lib/store";
import { X, Dots, Heart, Users, Clock, Pause, Play, Share, Check } from "@/components/icons";

const ROUND = 30; // seconds per lot

const LINES = [
  "Right, this is the one I'd take home myself.",
  "Fluted ceramic, pleated shade, not a chip on it.",
  "Seventy-two with Maya. Do I hear seventy-five?",
  "Seventy-five at the back. That's a steal at this price.",
  "Last chance now, going once…",
];

const BIDDERS = ["Maya", "Tom", "Priya", "Sam", "Alex", "Noor"];

export default function AuctionScreen() {
  const router = useRouter();
  const [lots, setLots] = useState<ScannedObject[]>(MOCK_OBJECTS.filter((o) => o.picked));
  const [index, setIndex] = useState(0);
  const [bid, setBid] = useState(0);
  const [bidder, setBidder] = useState<string | null>(null);
  const [left, setLeft] = useState(ROUND);
  const [watchers, setWatchers] = useState(5);
  const [line, setLine] = useState(LINES[0]);
  const [paused, setPaused] = useState(false);
  const [sold, setSold] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [liked, setLiked] = useState(false);
  const lineIdx = useRef(0);

  useEffect(() => {
    const saved = loadObjects();
    const picked = (saved ?? MOCK_OBJECTS).filter((o) => o.picked);
    if (picked.length) setLots(picked);
  }, []);

  const lot = lots[index];

  // Reset per lot
  useEffect(() => {
    if (!lot) return;
    setBid(Math.round(lot.low * 0.7));
    setBidder(null);
    setLeft(ROUND);
    setSold(false);
    lineIdx.current = 0;
    setLine(LINES[0]);
  }, [lot]);

  // Clock, bids, patter
  useEffect(() => {
    if (paused || sold || !lot) return;
    const t = setInterval(() => {
      setLeft((s) => {
        if (s <= 1) { setSold(true); return 0; }
        return s - 1;
      });

      // a bid lands now and then, more often near the end
      setBid((b) => {
        const heat = Math.random() < 0.32;
        if (!heat) return b;
        setBidder(BIDDERS[Math.floor(Math.random() * BIDDERS.length)]);
        return b + (Math.random() < 0.5 ? 3 : 5);
      });

      setWatchers((w) => Math.max(3, w + (Math.random() < 0.3 ? 1 : 0)));

      if (Math.random() < 0.35) {
        lineIdx.current = (lineIdx.current + 1) % LINES.length;
        setLine(LINES[lineIdx.current]);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [paused, sold, lot]);

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/auction`;
  }, []);

  if (!lot) {
    return (
      <main className="shell" style={{ display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ textAlign: "center" }}>
          <p className="title">Nothing in the sale yet</p>
          <button className="pill pill--dark" style={{ marginTop: 16 }} onClick={() => router.push("/")}>Scan a room</button>
        </div>
      </main>
    );
  }

  const pct = ((ROUND - left) / ROUND) * 100;
  const mmss = `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;

  return (
    <main className="shell">
      {/* Auctioneer */}
      <div style={{ position: "relative", padding: "0 12px", paddingTop: "max(12px, env(safe-area-inset-top))" }}>
        <div style={{ position: "relative", borderRadius: 20, overflow: "hidden", background: "#e9e9e7" }}>
          <Auctioneer speaking={!paused && !sold} />
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: 12 }}>
            <button className="icon-btn" aria-label="Leave" onClick={() => router.push("/objects")}><X size={18} /></button>
            <button className="icon-btn" aria-label="More" onClick={() => setSheet(true)}><Dots size={18} /></button>
          </div>
          <p
            className="fade-in"
            key={line}
            style={{
              position: "absolute", left: 12, right: 12, bottom: 12, margin: 0,
              padding: "8px 12px", borderRadius: 14,
              background: "rgba(20,20,20,.55)", backdropFilter: "blur(12px)",
              color: "#fff", fontSize: 13, lineHeight: 1.35, letterSpacing: "-.1px",
            }}
          >
            {line}
          </p>
        </div>
      </div>

      {/* Lot */}
      <div style={{ flex: 1, minHeight: 0, display: "grid", placeItems: "center", padding: "10px 22px 0" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={lot.image}
          alt={lot.name}
          style={{ maxWidth: "76%", maxHeight: "100%", objectFit: "contain", mixBlendMode: "multiply" }}
        />
      </div>

      {/* Details */}
      <section className="pad safe-b" style={{ paddingTop: 6 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <h2 className="title">{lot.name}</h2>
          <button
            className="icon-btn icon-btn--light"
            aria-label="Save"
            onClick={() => setLiked((v) => !v)}
            style={{ color: liked ? "var(--accent)" : "var(--ink)" }}
          >
            <Heart size={18} />
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: 12 }}>
          <div>
            <p className="meta" style={{ margin: 0 }}>{sold ? "Sold for" : "Current bid"}</p>
            <p className="numeral" style={{ margin: "2px 0 0" }}>{gbp(bid)}</p>
            {bidder && <p className="sub" style={{ marginTop: 2 }}>{sold ? `${bidder} wins` : `${bidder} leads`}</p>}
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center", color: "var(--ink-2)", fontSize: 13, paddingBottom: 6 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Users size={16} /> {watchers}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontVariantNumeric: "tabular-nums" }}>
              <Clock size={16} /> {mmss}
            </span>
          </div>
        </div>

        <div className="bar-track" style={{ marginTop: 14 }}>
          <div className="bar-fill" style={{ width: `${sold ? 100 : pct}%` }} />
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 16 }}>
          {sold ? (
            <button
              className="pill pill--dark"
              style={{ flex: 1 }}
              onClick={() => (index + 1 < lots.length ? setIndex(index + 1) : router.push("/objects"))}
            >
              {index + 1 < lots.length ? "Next lot" : "Finish sale"}
            </button>
          ) : (
            <>
              <button className="icon-btn icon-btn--light" style={{ width: 52, height: 52, minHeight: 52 }} aria-label="Share" onClick={() => setSheet(true)}>
                <Share size={19} />
              </button>
              <button
                className="icon-btn icon-btn--light"
                style={{ width: 52, height: 52, minHeight: 52 }}
                aria-label={paused ? "Resume" : "Pause"}
                onClick={() => setPaused((p) => !p)}
              >
                {paused ? <Play size={19} /> : <Pause size={19} />}
              </button>
            </>
          )}
        </div>
      </section>

      {sheet && <ShareSheet url={shareUrl} lot={lot} onClose={() => setSheet(false)} />}
    </main>
  );
}

/* ── Auctioneer placeholder. Track B swaps in the live avatar. ── */
function Auctioneer({ speaking }: { speaking: boolean }) {
  return (
    <div style={{ position: "relative", width: "100%", aspectRatio: "4 / 3", background: "#e9e9e7" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="auctioneer"
        src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&q=80"
        alt="Auctioneer"
        style={{ height: "100%" }}
      />
      <span
        style={{
          position: "absolute", left: 12, top: 12,
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "5px 10px", borderRadius: 999,
          background: "rgba(20,20,20,.5)", backdropFilter: "blur(12px)",
          color: "#fff", fontSize: 11, fontFamily: "var(--mono)", letterSpacing: ".06em",
        }}
      >
        <span
          style={{
            width: 6, height: 6, borderRadius: 999, background: speaking ? "#3ddc84" : "#c9c9c9",
            animation: speaking ? "blink 1.2s ease-in-out infinite" : undefined,
          }}
        />
        LIVE
      </span>
      <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:.35} }`}</style>
    </div>
  );
}

/* ── Share sheet: QR, WhatsApp, link ───────────────────────── */
function ShareSheet({ url, lot, onClose }: { url: string; lot: ScannedObject; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const wa = `https://wa.me/?text=${encodeURIComponent(`Bidding on a ${lot.name.toLowerCase()} right now — come and join: ${url}`)}`;

  return (
    <div
      onClick={onClose}
      style={{ position: "absolute", inset: 0, zIndex: 20, background: "rgba(0,0,0,.35)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-end" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="fade-in safe-b"
        style={{ width: "100%", background: "#fff", borderRadius: "26px 26px 0 0", padding: "22px 22px 12px" }}
      >
        <div style={{ width: 38, height: 4, borderRadius: 999, background: "var(--line-2)", margin: "0 auto 18px" }} />
        <h3 className="title" style={{ textAlign: "center" }}>Bring people in</h3>
        <p className="sub" style={{ textAlign: "center", marginTop: 6 }}>Anyone with the link can bid. No app needed.</p>

        <div style={{ display: "grid", placeItems: "center", margin: "20px 0" }}>
          <div style={{ padding: 14, borderRadius: 20, border: "1px solid var(--line)" }}>
            <QRCodeSVG value={url || "https://thesellout.app"} size={148} level="M" bgColor="#ffffff" fgColor="#151515" />
          </div>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <a className="pill pill--dark" href={wa} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
            Share on WhatsApp
          </a>
          <button
            className="pill pill--quiet"
            onClick={() => { navigator.clipboard?.writeText(url).then(() => setCopied(true)).catch(() => {}); }}
          >
            {copied ? <><Check size={16} /> Link copied</> : "Copy live link"}
          </button>
        </div>
      </div>
    </div>
  );
}
