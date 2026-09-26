"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import type { AnamClient } from "@anam-ai/js-sdk";
import { MOCK_OBJECTS, gbp, type ScannedObject } from "@/lib/mock";
import { loadObjects } from "@/lib/store";
import { supabaseBrowser } from "@/lib/supabase";
import type { Lot, Sale, SaleStateResponse, TickResponse } from "@/lib/types";
import { X, Dots, Heart, Users, Clock, Pause, Play, Share, Check } from "@/components/icons";

const ROUND = 30;           // seconds of bidding per lot, matches lib/auctioneer.ts
const TICK_MS = 8000;       // how often the auctioneer speaks
const NUDGE_MS = 1500;      // debounce before reacting to a bid or a question
const SALE_KEY = "sellout.sale";

const LINES = [
  "Right, this is the one I'd take home myself.",
  "Fluted ceramic, pleated shade, not a chip on it.",
  "Seventy-two with Maya. Do I hear seventy-five?",
  "Seventy-five at the back. That's a steal at this price.",
  "Last chance now, going once…",
];

const BIDDERS = ["Maya", "Tom", "Priya", "Sam", "Alex", "Noor"];

type Mode = "connecting" | "live" | "offline";

/** One shape for the screen, whether the numbers come from the server or the local rehearsal. */
type View = {
  name: string;
  image: string;
  bid: number;
  bidder: string | null;
  left: number;
  sold: boolean;
  ended: boolean;
  lastOfSale: boolean;
};

export default function AuctionScreen() {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("connecting");
  const [mock, setMock] = useState(false);
  const [paused, setPaused] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [liked, setLiked] = useState(false);
  const [line, setLine] = useState(LINES[0]);
  const [watchers, setWatchers] = useState(1);

  // live
  const [code, setCode] = useState<string | null>(null);
  const [sale, setSale] = useState<Sale | null>(null);
  const [lot, setLot] = useState<Lot | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // offline rehearsal
  const [lots, setLots] = useState<ScannedObject[]>(MOCK_OBJECTS.filter((o) => o.picked));
  const [index, setIndex] = useState(0);
  const [simBid, setSimBid] = useState(0);
  const [simBidder, setSimBidder] = useState<string | null>(null);
  const [simLeft, setSimLeft] = useState(ROUND);
  const [simSold, setSimSold] = useState(false);
  const lineIdx = useRef(0);

  useEffect(() => {
    setMock(new URLSearchParams(window.location.search).get("mock") === "1");
  }, []);

  /* ── Open or rejoin the sale ─────────────────────────────── */
  useEffect(() => {
    let cancelled = false;

    const goOffline = () => {
      if (cancelled) return;
      const saved = loadObjects();
      const picked = (saved ?? MOCK_OBJECTS).filter((o) => o.picked);
      if (picked.length) setLots(picked);
      setMode("offline");
    };

    const load = async (saleCode: string): Promise<boolean> => {
      const res = await fetch(`/api/sale/${saleCode}`).catch(() => null);
      if (!res?.ok) return false;
      const state = (await res.json()) as SaleStateResponse;
      if (cancelled) return true;
      setSale(state.sale);
      setLot(state.lot);
      setCode(state.sale.code);
      setMode("live");
      return true;
    };

    (async () => {
      const existing = sessionStorage.getItem(SALE_KEY);
      if (existing && (await load(existing))) return;

      const picked = (loadObjects() ?? MOCK_OBJECTS).filter((o) => o.picked);
      if (!picked.length) return goOffline();

      const res = await fetch("/api/sale", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "The Sellout",
          lots: picked.map((o) => ({
            name: o.name,
            category: o.category,
            condition: o.condition,
            blurb: o.blurb,
            image_url: o.image,
            low: o.low,
            high: o.high,
            reserve: Math.round(o.low * 0.55),
          })),
        }),
      }).catch(() => null);

      if (!res?.ok) return goOffline();
      const { sale: created } = (await res.json()) as { sale: Sale };
      if (cancelled) return;
      sessionStorage.setItem(SALE_KEY, created.code);
      await load(created.code);
    })();

    return () => { cancelled = true; };
  }, []);

  /* ── Realtime: sale state, bids, questions, who is watching ── */
  const nudge = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (mode !== "live" || !code || !sale) return;
    let channel: ReturnType<ReturnType<typeof supabaseBrowser>["channel"]> | null = null;
    try {
      const db = supabaseBrowser();
      channel = db
        .channel(`sale:${code}`, { config: { presence: { key: `stage-${Math.random().toString(36).slice(2)}` } } })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "sales", filter: `id=eq.${sale.id}` },
          (p) => setSale(p.new as Sale))
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "sale_bids", filter: `sale_id=eq.${sale.id}` },
          () => {
            if (nudge.current) clearTimeout(nudge.current);
            nudge.current = setTimeout(() => tickRef.current(), NUDGE_MS);
          })
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "sale_messages", filter: `sale_id=eq.${sale.id}` },
          () => {
            if (nudge.current) clearTimeout(nudge.current);
            nudge.current = setTimeout(() => tickRef.current(), NUDGE_MS);
          })
        .on("presence", { event: "sync" }, () => {
          const count = Object.keys(channel?.presenceState() ?? {}).length;
          setWatchers(Math.max(1, count));
        })
        .subscribe((status) => { if (status === "SUBSCRIBED") channel?.track({ role: "stage" }); });
    } catch {
      // Realtime unavailable: polling after each tick still moves the screen along.
    }
    return () => { if (channel) supabaseBrowser().removeChannel(channel); };
  }, [mode, code, sale?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Follow the lot on the block ─────────────────────────── */
  useEffect(() => {
    if (mode !== "live" || !code || !sale) return;
    if (!sale.current_lot_id) { setLot(null); return; }
    if (lot?.id === sale.current_lot_id) return;
    (async () => {
      const res = await fetch(`/api/sale/${code}`).catch(() => null);
      if (!res?.ok) return;
      const state = (await res.json()) as SaleStateResponse;
      setLot(state.lot);
    })();
  }, [mode, code, sale?.current_lot_id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Local clock so the countdown is smooth ──────────────── */
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  /* ── The voice ───────────────────────────────────────────── */
  const { speak, avatarState, videoId } = useAuctioneerVoice(mock, paused);

  const doTick = useCallback(async () => {
    if (mode !== "live" || !code || paused) return;
    const res = await fetch(`/api/sale/${code}/tick`, { method: "POST" }).catch(() => null);
    if (!res?.ok) return;
    const { say } = (await res.json()) as TickResponse;
    if (say?.trim()) { setLine(say); speak(say); }
    // pick up whatever the tick changed
    const state = await fetch(`/api/sale/${code}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (state) { setSale((state as SaleStateResponse).sale); setLot((state as SaleStateResponse).lot); }
  }, [mode, code, paused, speak]);

  useEffect(() => { tickRef.current = doTick; }, [doTick]);

  // Regular cadence, and one straight away when the sale opens.
  useEffect(() => {
    if (mode !== "live" || paused) return;
    doTick();
    const t = setInterval(doTick, TICK_MS);
    return () => clearInterval(t);
  }, [mode, paused, doTick]);

  /* ── Offline rehearsal, unchanged ────────────────────────── */
  const simLot = lots[index];

  useEffect(() => {
    if (mode !== "offline" || !simLot) return;
    setSimBid(Math.round(simLot.low * 0.7));
    setSimBidder(null);
    setSimLeft(ROUND);
    setSimSold(false);
    lineIdx.current = 0;
    setLine(LINES[0]);
  }, [mode, simLot]);

  useEffect(() => {
    if (mode !== "offline" || paused || simSold || !simLot) return;
    const t = setInterval(() => {
      setSimLeft((s) => { if (s <= 1) { setSimSold(true); return 0; } return s - 1; });
      setSimBid((b) => {
        if (Math.random() >= 0.32) return b;
        setSimBidder(BIDDERS[Math.floor(Math.random() * BIDDERS.length)]);
        return b + (Math.random() < 0.5 ? 3 : 5);
      });
      setWatchers((w) => Math.max(3, w + (Math.random() < 0.3 ? 1 : 0)));
      if (Math.random() < 0.35) {
        lineIdx.current = (lineIdx.current + 1) % LINES.length;
        setLine(LINES[lineIdx.current]);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [mode, paused, simSold, simLot]);

  /* ── One view model ──────────────────────────────────────── */
  const view: View | null = useMemo(() => {
    if (mode === "live") {
      if (!lot) {
        if (sale?.phase === "ended") {
          return { name: "That's the sale", image: "", bid: 0, bidder: null, left: 0, sold: true, ended: true, lastOfSale: true };
        }
        return null;
      }
      const opening = Math.round(Number(lot.reserve ?? 0) || Number(lot.low ?? 0) * 0.55);
      const left = sale?.lot_ends_at
        ? Math.max(0, Math.round((new Date(sale.lot_ends_at).getTime() - now) / 1000))
        : sale?.phase === "presenting" ? ROUND : 0;
      return {
        name: lot.name,
        image: lot.image_url ?? "",
        bid: sale?.high_bid === null || sale?.high_bid === undefined ? opening : Number(sale.high_bid),
        bidder: sale?.high_bidder ?? null,
        left,
        sold: sale?.phase === "sold",
        ended: sale?.phase === "ended",
        lastOfSale: false,
      };
    }
    if (!simLot) return null;
    return {
      name: simLot.name,
      image: simLot.image,
      bid: simBid,
      bidder: simBidder,
      left: simLeft,
      sold: simSold,
      ended: false,
      lastOfSale: index + 1 >= lots.length,
    };
  }, [mode, lot, sale, now, simLot, simBid, simBidder, simLeft, simSold, index, lots.length]);

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return code ? `${window.location.origin}/join/${code}` : `${window.location.origin}/auction`;
  }, [code]);

  if (mode === "connecting") {
    return (
      <main className="shell" style={{ display: "grid", placeItems: "center", padding: 24 }}>
        <p className="meta">Opening the room…</p>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="shell" style={{ display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ textAlign: "center" }}>
          <p className="title">Nothing in the sale yet</p>
          <button className="pill pill--dark" style={{ marginTop: 16 }} onClick={() => router.push("/")}>Scan a room</button>
        </div>
      </main>
    );
  }

  const pct = ((ROUND - view.left) / ROUND) * 100;
  const mmss = `${String(Math.floor(view.left / 60)).padStart(2, "0")}:${String(view.left % 60).padStart(2, "0")}`;

  const advance = () => {
    if (mode === "live") { doTick(); return; }
    if (index + 1 < lots.length) setIndex(index + 1);
    else router.push("/objects");
  };

  return (
    <main className="shell">
      {/* Auctioneer */}
      <div style={{ position: "relative", padding: "0 12px", paddingTop: "max(12px, env(safe-area-inset-top))" }}>
        <div style={{ position: "relative", borderRadius: 20, overflow: "hidden", background: "#e9e9e7" }}>
          <Auctioneer speaking={!paused && !view.sold} state={avatarState} videoId={videoId} mock={mock} />
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
        {view.image ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={view.image}
            alt={view.name}
            style={{ maxWidth: "76%", maxHeight: "100%", objectFit: "contain", mixBlendMode: "multiply" }}
          />
        ) : (
          <p className="meta">Sale complete</p>
        )}
      </div>

      {/* Details */}
      <section className="pad safe-b" style={{ paddingTop: 6 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <h2 className="title">{view.name}</h2>
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
            <p className="meta" style={{ margin: 0 }}>{view.sold ? "Sold for" : "Current bid"}</p>
            <p className="numeral" style={{ margin: "2px 0 0" }}>{gbp(view.bid)}</p>
            {view.bidder && <p className="sub" style={{ marginTop: 2 }}>{view.sold ? `${view.bidder} wins` : `${view.bidder} leads`}</p>}
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center", color: "var(--ink-2)", fontSize: 13, paddingBottom: 6 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Users size={16} /> {watchers}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontVariantNumeric: "tabular-nums" }}>
              <Clock size={16} /> {mmss}
            </span>
          </div>
        </div>

        <div className="bar-track" style={{ marginTop: 14 }}>
          <div className="bar-fill" style={{ width: `${view.sold ? 100 : pct}%` }} />
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 16 }}>
          {view.sold ? (
            <button className="pill pill--dark" style={{ flex: 1 }} onClick={advance}>
              {view.ended ? "Finish sale" : view.lastOfSale ? "Finish sale" : "Next lot"}
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

      {sheet && <ShareSheet url={shareUrl} code={code} name={view.name} onClose={() => setSheet(false)} />}
    </main>
  );
}

/* ── The voice: Anam when we have it, browser speech when rehearsing ── */

type AvatarState = "mock" | "connecting" | "live" | "error";

function useAuctioneerVoice(mock: boolean, paused: boolean) {
  const [avatarState, setAvatarState] = useState<AvatarState>("connecting");
  const client = useRef<AnamClient | null>(null);
  const connecting = useRef(false);
  const alive = useRef(true);
  const reconnect = useRef<() => void>(() => {});
  const videoId = "auctioneer-video";

  const connect = useCallback(async () => {
    if (connecting.current || client.current || !alive.current) return;
    connecting.current = true;
    try {
      const res = await fetch("/api/session-token", { method: "POST" });
      if (!res.ok) throw new Error("no session token");
      const { sessionToken } = (await res.json()) as { sessionToken: string };
      const { createClient, AnamEvent } = await import("@anam-ai/js-sdk");
      const c = createClient(sessionToken, { disableInputAudio: true });
      c.addListener(AnamEvent.SESSION_READY, () => alive.current && setAvatarState("live"));
      c.addListener(AnamEvent.CONNECTION_CLOSED, () => {
        // The free tier caps a session at three minutes, so simply start another.
        client.current = null;
        if (!alive.current) return;
        setAvatarState("connecting");
        setTimeout(() => { connecting.current = false; reconnect.current(); }, 1000);
      });
      await c.streamToVideoElement(videoId);
      client.current = c;
      setAvatarState("live");
    } catch {
      if (alive.current) setAvatarState("error");
      setTimeout(() => { connecting.current = false; }, 4000);
      return;
    }
    connecting.current = false;
  }, []);

  useEffect(() => { reconnect.current = connect; }, [connect]);

  useEffect(() => {
    alive.current = true;
    if (mock) { setAvatarState("mock"); return; }
    connect();
    return () => {
      alive.current = false;
      client.current?.stopStreaming().catch(() => {});
      client.current = null;
    };
  }, [mock, connect]);

  const speak = useCallback((text: string) => {
    if (paused) return;
    if (mock || !client.current) {
      try {
        const synth = window.speechSynthesis;
        if (!synth) return;
        synth.cancel();
        const u = new SpeechSynthesisUtterance(text);
        const voice = synth.getVoices().find((v) => /en-GB/i.test(v.lang)) ?? synth.getVoices().find((v) => /^en/i.test(v.lang));
        if (voice) u.voice = voice;
        u.rate = 1.08;
        synth.speak(u);
      } catch {}
      return;
    }
    client.current.talk(text).catch(() => {});
  }, [mock, paused]);

  return { speak, avatarState, videoId };
}

function Auctioneer({ speaking, state, videoId, mock }: { speaking: boolean; state: AvatarState; videoId: string; mock: boolean }) {
  const showVideo = !mock && (state === "live" || state === "connecting");
  return (
    <div style={{ position: "relative", width: "100%", aspectRatio: "4 / 3", background: "#e9e9e7" }}>
      <video
        id={videoId}
        autoPlay
        playsInline
        className="auctioneer"
        style={{ height: "100%", display: showVideo ? "block" : "none" }}
      />
      {!showVideo && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          className="auctioneer"
          src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&q=80"
          alt="Auctioneer"
          style={{ height: "100%" }}
        />
      )}
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
            width: 6, height: 6, borderRadius: 999,
            background: state === "connecting" ? "#f0b429" : speaking ? "#3ddc84" : "#c9c9c9",
            animation: speaking && state !== "connecting" ? "blink 1.2s ease-in-out infinite" : undefined,
          }}
        />
        {state === "connecting" ? "CONNECTING" : "LIVE"}
      </span>
      <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:.35} }`}</style>
    </div>
  );
}

/* ── Share sheet: QR, WhatsApp, link ───────────────────────── */
function ShareSheet({ url, code, name, onClose }: { url: string; code: string | null; name: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const wa = `https://wa.me/?text=${encodeURIComponent(`Bidding on a ${name.toLowerCase()} right now — come and join: ${url}`)}`;

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
        <p className="sub" style={{ textAlign: "center", marginTop: 6 }}>
          {code ? <>Anyone with the link can bid. Room code <strong>{code}</strong>.</> : "Anyone with the link can bid. No app needed."}
        </p>

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
