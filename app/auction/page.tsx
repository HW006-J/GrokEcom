"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import type { AnamClient } from "@anam-ai/js-sdk";
import { loadObjects } from "@/lib/store";
import { gbp, type Lot, type Sale, type SaleStateResponse, type TickResponse } from "@/lib/types";
import { X, Dots, Users, Clock, Pause, Play, Share, Check, Chevron } from "@/components/icons";

const ROUND = 30;       // seconds of bidding per lot, matches lib/auctioneer.ts
const TICK_MS = 8000;   // how often the auctioneer speaks
const NUDGE_MS = 1500;  // debounce before reacting to a bid or a question
const STATE_MS = 1200;  // how often the stage re-reads the sale
const SALE_KEY = "sellout.sale";
const VIDEO_ID = "auctioneer-video";

type Status = "opening" | "ready" | "empty" | "error";

export default function AuctionScreen() {
  const router = useRouter();

  const [mock, setMock] = useState(false);
  const [status, setStatus] = useState<Status>("opening");
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [line, setLine] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [state, setState] = useState<SaleStateResponse | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setMock(new URLSearchParams(window.location.search).get("mock") === "1");
  }, []);

  /* ── Open or rejoin the sale. No sale means no screen; we never invent one. ── */
  useEffect(() => {
    let cancelled = false;

    const load = async (saleCode: string): Promise<boolean> => {
      const res = await fetch(`/api/sale/${saleCode}`).catch(() => null);
      if (!res?.ok) return false;
      const next = (await res.json()) as SaleStateResponse;
      if (cancelled) return true;
      setState(next);
      setCode(next.sale.code);
      setStatus("ready");
      return true;
    };

    (async () => {
      const existing = sessionStorage.getItem(SALE_KEY);
      if (existing && (await load(existing))) return;

      const picked = (loadObjects() ?? []).filter((o) => o.picked);
      if (!picked.length) { if (!cancelled) setStatus("empty"); return; }

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
            reserve: o.reserve ?? Math.round(o.low * 0.55),
          })),
        }),
      }).catch(() => null);

      if (!res?.ok) { if (!cancelled) setStatus("error"); return; }
      const { sale: created } = (await res.json()) as { sale: Sale };
      if (cancelled) return;
      sessionStorage.setItem(SALE_KEY, created.code);
      if (!(await load(created.code)) && !cancelled) setStatus("error");
    })();

    return () => { cancelled = true; };
  }, []);

  /* ── Smooth countdown ────────────────────────────────────── */
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  /* ── Poll the sale so a bid shows within a second ────────── */
  const nudge = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<() => void>(() => {});
  const lastHigh = useRef<number | null>(null);

  useEffect(() => {
    if (status !== "ready" || !code) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const pull = async () => {
      const res = await fetch(`/api/sale/${code}`).catch(() => null);
      if (!res?.ok || cancelled) return;
      const next = (await res.json()) as SaleStateResponse;
      if (cancelled) return;
      setState(next);

      const high = next.sale.high_bid === null ? null : Number(next.sale.high_bid);
      if (lastHigh.current !== null && high !== null && high > lastHigh.current) {
        if (nudge.current) clearTimeout(nudge.current);
        nudge.current = setTimeout(() => tickRef.current(), NUDGE_MS);
      }
      lastHigh.current = high;
    };

    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const start = () => { if (!timer) timer = setInterval(pull, STATE_MS); };
    const onVisibility = () => { if (document.hidden) stop(); else { pull(); start(); } };

    pull();
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [status, code]);

  /* ── The voice ───────────────────────────────────────────── */
  const { speak, connect, avatar, speaking } = useAuctioneerVoice(mock);

  /* ── Ticking, one at a time ──────────────────────────────── */
  const ticking = useRef(false);

  const doTick = useCallback(async () => {
    if (!started || paused || !code || ticking.current || document.hidden) return;
    ticking.current = true;
    try {
      const res = await fetch(`/api/sale/${code}/tick`, { method: "POST" }).catch(() => null);
      if (res?.ok) {
        const { say } = (await res.json()) as TickResponse;
        if (say?.trim()) { setLine(say); speak(say); }
      }
      const after = await fetch(`/api/sale/${code}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (after) setState(after as SaleStateResponse);
    } finally {
      ticking.current = false;
    }
  }, [started, paused, code, speak]);

  useEffect(() => { tickRef.current = doTick; }, [doTick]);

  useEffect(() => {
    if (!started || paused || status !== "ready") return;
    doTick();
    const t = setInterval(doTick, TICK_MS);
    return () => clearInterval(t);
  }, [started, paused, status, doTick]);

  /* ── Derived, entirely from the server ───────────────────── */
  const sale = state?.sale ?? null;
  const lot = state?.lot ?? null;
  const lots = state?.lots ?? [];

  const high = sale?.high_bid === null || sale?.high_bid === undefined ? null : Number(sale.high_bid);
  const opening = lot ? Math.round(Number(lot.reserve ?? 0) || Number(lot.low ?? 0) * 0.55) : 0;
  const left = sale?.lot_ends_at
    ? Math.max(0, Math.round((new Date(sale.lot_ends_at).getTime() - now) / 1000))
    : 0;
  const settled = sale?.phase === "sold";
  const ended = sale?.phase === "ended";

  const raised = useMemo(
    () => lots.reduce((sum, l) => sum + (l.status === "sold" ? Number(l.sold_for ?? 0) : 0), 0),
    [lots]
  );

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined" || !code) return "";
    return `${window.location.origin}/join/${code}`;
  }, [code]);

  const begin = async () => {
    setStarted(true);
    await connect();   // the tap is what lets the avatar play sound
  };

  /* ── States where there is nothing honest to show ────────── */
  if (status === "opening") {
    return (
      <main className="shell" style={{ display: "grid", placeItems: "center", padding: 24 }}>
        <p className="meta">Opening the room…</p>
      </main>
    );
  }

  if (status === "empty" || status === "error") {
    return (
      <main className="shell" style={{ display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ textAlign: "center" }}>
          <p className="title">{status === "empty" ? "Nothing in the sale yet" : "Could not open the sale"}</p>
          <p className="sub" style={{ marginTop: 8 }}>
            {status === "empty" ? "Scan a room and choose what to sell." : "Try again in a moment."}
          </p>
          <button className="pill pill--dark" style={{ marginTop: 16 }} onClick={() => router.push("/")}>
            Scan a room
          </button>
        </div>
      </main>
    );
  }

  const pct = settled || ended ? 100 : ((ROUND - left) / ROUND) * 100;
  const mmss = `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;

  return (
    <main className="shell">
      {/* Auctioneer */}
      <div style={{ position: "relative", padding: "0 12px", paddingTop: "max(12px, env(safe-area-inset-top))" }}>
        <div style={{ position: "relative", borderRadius: 20, overflow: "hidden", background: "#e9e9e7" }}>
          <Auctioneer state={avatar} speaking={speaking} mock={mock} />
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: 12, pointerEvents: "none" }}>
            <button className="icon-btn" style={{ pointerEvents: "auto" }} aria-label="Leave" onClick={() => router.push("/objects")}><X size={18} /></button>
            <button className="icon-btn" style={{ pointerEvents: "auto" }} aria-label="More" onClick={() => setSheet(true)}><Dots size={18} /></button>
          </div>
          {line && (
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
          )}
        </div>
      </div>

      {/* Lot */}
      <div style={{ flex: 1, minHeight: 0, display: "grid", placeItems: "center", padding: "10px 22px 0" }}>
        {lot?.image_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={lot.image_url} alt={lot.name} style={{ maxWidth: "76%", maxHeight: "100%", objectFit: "contain" }} />
        ) : (
          <p className="meta">{ended ? "That's the sale" : "Waiting for the first lot"}</p>
        )}
      </div>

      {/* Details */}
      <section className="pad safe-b" style={{ paddingTop: 6 }}>
        <h2 className="title">{lot?.name ?? (ended ? "Sale complete" : "Up next")}</h2>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: 12 }}>
          <div>
            <p className="meta" style={{ margin: 0 }}>
              {settled ? (lot?.status === "sold" ? "Sold for" : "Unsold") : high === null ? "Opening at" : "Current bid"}
            </p>
            <p className="numeral" style={{ margin: "2px 0 0" }}>{gbp(high ?? opening)}</p>
            {sale?.high_bidder && (
              <p className="sub" style={{ marginTop: 2 }}>
                {settled ? `${sale.high_bidder} wins` : `${sale.high_bidder} is winning`}
              </p>
            )}
            {!sale?.high_bidder && !settled && <p className="sub" style={{ marginTop: 2 }}>No bids yet</p>}
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center", color: "var(--ink-2)", fontSize: 13, paddingBottom: 6 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Users size={16} /> {new Set([...(state?.bids ?? []).map((b) => b.bidder), ...(state?.messages ?? []).map((m) => m.name)]).size}
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontVariantNumeric: "tabular-nums" }}>
              <Clock size={16} /> {mmss}
            </span>
          </div>
        </div>

        <div className="bar-track" style={{ marginTop: 14 }}>
          <div className="bar-fill" style={{ width: `${pct}%` }} />
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 16 }}>
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
        </div>
      </section>

      {/* The tap that lets the avatar speak, and starts the room */}
      {!started && <StartGate onStart={begin} lots={lots.length} code={code} />}

      {/* Hammer down */}
      {started && settled && lot && <WinnerFlash lot={lot} />}

      {/* Everything, at the end */}
      {started && ended && <SaleSummary lots={lots} raised={raised} onDone={() => router.push("/dashboard")} />}

      {sheet && <ShareSheet url={shareUrl} code={code} name={lot?.name ?? "this lot"} onClose={() => setSheet(false)} />}
    </main>
  );
}

/* ── The voice ──────────────────────────────────────────────
   Anam speaks every line. One line at a time, never before the
   session is ready, and only ever the freshest line: an auction
   call goes stale in seconds, so a newer line replaces an
   unspoken one rather than queueing behind it.               */

type AvatarState = "idle" | "connecting" | "live" | "reconnecting" | "failed" | "mock";

function useAuctioneerVoice(mock: boolean) {
  const [avatar, setAvatar] = useState<AvatarState>("idle");
  const [speaking, setSpeaking] = useState(false);

  const clientRef = useRef<AnamClient | null>(null);
  const readyRef = useRef(false);
  const aliveRef = useRef(true);
  const connectingRef = useRef(false);
  const tokenRef = useRef<Promise<string> | null>(null);
  const pending = useRef<string | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const connectRef = useRef<(again?: boolean) => Promise<void>>(async () => {});
  const flushRef = useRef<() => void>(() => {});

  const fetchToken = useCallback(() => {
    const p = fetch("/api/session-token", { method: "POST" })
      .then((r) => { if (!r.ok) throw new Error("session token"); return r.json(); })
      .then((j: { sessionToken: string }) => j.sessionToken);
    tokenRef.current = p;
    return p;
  }, []);

  // Prefetch on load so the tap only has to attach media. Tokens last about an hour.
  useEffect(() => {
    aliveRef.current = true;
    if (mock) { setAvatar("mock"); return; }

    // Warm the connection before the tap.
    const pre = document.createElement("link");
    pre.rel = "preconnect";
    pre.href = "https://api.anam.ai";
    pre.crossOrigin = "";
    document.head.appendChild(pre);

    fetchToken().catch(() => {});
    return () => {
      aliveRef.current = false;
      pre.remove();
      clientRef.current?.stopStreaming().catch(() => {});
      clientRef.current = null;
    };
  }, [mock, fetchToken]);

  const flush = useCallback(() => {
    const line = pending.current;
    if (!line) return;
    const client = clientRef.current;
    if (!client || !readyRef.current) return; // stays queued until the session is ready
    pending.current = null;

    chain.current = chain.current.then(async () => {
      setSpeaking(true);
      try {
        await client.talk(line);
      } catch {
        // a dropped line is better than a stuck queue
      }
      // Let the line land before the next one starts, so calls never overlap.
      const settle = Math.min(6000, 400 + line.length * 55);
      await new Promise((r) => setTimeout(r, settle));
      setSpeaking(false);
      if (pending.current) flushRef.current();
    });
  }, []);

  useEffect(() => { flushRef.current = flush; }, [flush]);

  const connect = useCallback(async (again = false) => {
    if (mock || connectingRef.current || clientRef.current) return;
    connectingRef.current = true;
    setAvatar(again ? "reconnecting" : "connecting");
    try {
      const token = await (tokenRef.current ?? fetchToken());
      const { createClient, AnamEvent } = await import("@anam-ai/js-sdk");
      const c = createClient(token, { disableInputAudio: true });
      readyRef.current = false;

      c.addListener(AnamEvent.SESSION_READY, () => {
        if (!aliveRef.current) return;
        readyRef.current = true;
        setAvatar("live");
        flushRef.current();          // say whatever arrived while we were connecting
      });

      c.addListener(AnamEvent.CONNECTION_CLOSED, () => {
        // The free tier caps a session at three minutes. Start another and
        // keep the newest unspoken line so the sale does not lose its voice.
        readyRef.current = false;
        clientRef.current = null;
        connectingRef.current = false;
        tokenRef.current = null;
        if (!aliveRef.current) return;
        setAvatar("reconnecting");
        fetchToken().catch(() => {});
        setTimeout(() => connectRef.current(true), 800);
      });

      await c.streamToVideoElement(VIDEO_ID);
      clientRef.current = c;
      connectingRef.current = false;
      flushRef.current();
    } catch {
      connectingRef.current = false;
      tokenRef.current = null;
      if (!aliveRef.current) return;
      setAvatar("failed");
      setTimeout(() => { if (aliveRef.current) connectRef.current(true); }, 4000);
    }
  }, [mock, fetchToken]);

  useEffect(() => { connectRef.current = connect; }, [connect]);

  const speak = useCallback((text: string) => {
    const line = text.trim();
    if (!line) return;

    if (mock) {
      try {
        const synth = window.speechSynthesis;
        if (!synth) return;
        synth.cancel();
        const u = new SpeechSynthesisUtterance(line);
        const v = synth.getVoices().find((x) => /en-GB/i.test(x.lang)) ?? synth.getVoices().find((x) => /^en/i.test(x.lang));
        if (v) u.voice = v;
        u.rate = 1.08;
        u.onstart = () => setSpeaking(true);
        u.onend = () => setSpeaking(false);
        synth.speak(u);
      } catch {}
      return;
    }

    pending.current = line;   // freshest line wins
    flushRef.current();
  }, [mock]);

  return { speak, connect, avatar, speaking };
}

function Auctioneer({ state, speaking, mock }: { state: AvatarState; speaking: boolean; mock: boolean }) {
  const label =
    state === "mock" ? "REHEARSAL"
    : state === "live" ? "LIVE"
    : state === "connecting" ? "CONNECTING"
    : state === "reconnecting" ? "RECONNECTING"
    : state === "failed" ? "NO AVATAR"
    : "READY";

  const dot =
    state === "live" ? (speaking ? "#3ddc84" : "#c9c9c9")
    : state === "failed" ? "#e2564a"
    : state === "mock" ? "#8a8a8a"
    : "#f0b429";

  return (
    <div style={{ position: "relative", width: "100%", aspectRatio: "4 / 3", background: "#e9e9e7" }}>
      <video
        id={VIDEO_ID}
        autoPlay
        playsInline
        className="auctioneer"
        style={{ height: "100%", display: state === "live" || state === "connecting" ? "block" : "none" }}
      />
      {!(state === "live" || state === "connecting") && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "#e9e9e7" }}>
          <p className="meta" style={{ color: "var(--ink-3)" }}>
            {state === "failed" ? "Auctioneer unavailable" : state === "mock" ? "Rehearsal voice" : "Auctioneer standing by"}
          </p>
        </div>
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
            width: 6, height: 6, borderRadius: 999, background: dot,
            animation: speaking && state === "live" ? "blink 1.2s ease-in-out infinite" : undefined,
          }}
        />
        {label}
      </span>
      <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:.35} }`}</style>
    </div>
  );
}

/* ── The tap that starts the room ───────────────────────────── */
function StartGate({ onStart, lots, code }: { onStart: () => void; lots: number; code: string | null }) {
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 25, background: "rgba(255,255,255,.92)", backdropFilter: "blur(6px)", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ textAlign: "center", maxWidth: 300 }}>
        <p className="meta">{code ? `Room ${code}` : "Getting ready"}</p>
        <h2 className="display" style={{ marginTop: 10 }}>Ready when you are</h2>
        <p className="sub" style={{ marginTop: 8 }}>
          {lots} {lots === 1 ? "lot" : "lots"} up. Share the room first, then start the auctioneer.
        </p>
        <button className="pill pill--primary" style={{ width: "100%", marginTop: 20 }} onClick={onStart}>
          Start the sale <Chevron size={17} />
        </button>
      </div>
    </div>
  );
}

/* ── Hammer down ────────────────────────────────────────────── */
function WinnerFlash({ lot }: { lot: Lot }) {
  const [gone, setGone] = useState(false);
  useEffect(() => { setGone(false); const t = setTimeout(() => setGone(true), 5200); return () => clearTimeout(t); }, [lot.id]);
  if (gone) return null;

  const sold = lot.status === "sold" && lot.sold_to;

  return (
    <div className="fade-in" style={{ position: "absolute", inset: 0, zIndex: 24, background: "rgba(255,255,255,.96)", display: "grid", placeItems: "center", padding: 28 }}>
      <div style={{ textAlign: "center", width: "100%" }}>
        {lot.image_url && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={lot.image_url} alt={lot.name} style={{ maxWidth: "68%", maxHeight: "40svh", objectFit: "contain", filter: "drop-shadow(0 18px 22px rgba(0,0,0,.16))" }} />
        )}
        <p className="meta" style={{ marginTop: 20 }}>{sold ? "Sold" : "Unsold"}</p>
        <p className="numeral" style={{ margin: "4px 0 0" }}>{sold ? gbp(Number(lot.sold_for ?? 0)) : "—"}</p>
        <p className="title" style={{ marginTop: 10 }}>{sold ? `to ${lot.sold_to}` : "No bids"}</p>
        <p className="sub" style={{ marginTop: 6 }}>{lot.name}</p>
      </div>
    </div>
  );
}

/* ── The close ──────────────────────────────────────────────── */
function SaleSummary({ lots, raised, onDone }: { lots: Lot[]; raised: number; onDone: () => void }) {
  return (
    <div className="fade-in" style={{ position: "absolute", inset: 0, zIndex: 26, background: "#fff", display: "flex", flexDirection: "column" }}>
      <header className="pad safe-t">
        <p className="meta">That&apos;s the sale</p>
        <h2 className="display" style={{ marginTop: 8 }}>{gbp(raised)} raised</h2>
        <p className="sub" style={{ marginTop: 6 }}>
          {lots.filter((l) => l.status === "sold").length} of {lots.length} lots sold
        </p>
      </header>

      <div style={{ flex: 1, overflowY: "auto", padding: "14px 22px 4px" }}>
        {lots.map((l) => (
          <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
            <span style={{ width: 52, height: 52, borderRadius: 12, background: "#f6f6f4", overflow: "hidden", flex: "0 0 auto" }}>
              {l.image_url && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={l.image_url} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
              )}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 15, fontWeight: 500, letterSpacing: "-.2px" }}>{l.name}</span>
              <span className="meta" style={{ textTransform: "none" }}>
                {l.status === "sold" ? `to ${l.sold_to}` : "no bids"}
              </span>
            </span>
            <span style={{ fontSize: 15, fontVariantNumeric: "tabular-nums", color: l.status === "sold" ? "var(--ink)" : "var(--ink-3)" }}>
              {l.status === "sold" ? gbp(Number(l.sold_for ?? 0)) : "—"}
            </span>
          </div>
        ))}
      </div>

      <footer className="pad safe-b" style={{ paddingTop: 10 }}>
        <button className="pill pill--primary" style={{ width: "100%" }} onClick={onDone}>
          See your earnings <Chevron size={17} />
        </button>
      </footer>
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
      style={{ position: "absolute", inset: 0, zIndex: 30, background: "rgba(0,0,0,.35)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-end" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="fade-in safe-b"
        style={{ position: "relative", width: "100%", background: "#fff", borderRadius: "26px 26px 0 0", padding: "22px 22px 12px" }}
      >
        <div style={{ width: 38, height: 4, borderRadius: 999, background: "var(--line-2)", margin: "0 auto 14px" }} />
        {/* The backdrop is a thin strip above a full-width sheet on a phone, so
            there has to be a button you can actually hit to get out of here. */}
        <button
          onClick={onClose}
          aria-label="Close"
          className="icon-btn icon-btn--light"
          style={{ position: "absolute", right: 18, top: 16 }}
        >
          <X size={18} />
        </button>
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
