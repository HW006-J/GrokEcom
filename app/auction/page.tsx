"use client";

import { TalkingAuctioneer } from "@/components/talking-auctioneer";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { loadObjects } from "@/lib/store";
import { EnableWinSound, WinSound } from "@/components/win-sound";
import { SaleConfetti } from "@/components/sale-confetti";
import { SaleReceipt } from "@/components/sale-receipt";
import { WaitingOrbit } from "@/components/waiting-orbit";
import { PriceEvidence } from "@/components/price-evidence";
import { CALL_SECONDS, windowSeconds } from "@/lib/sale-timing";
import { LiveBids } from "@/components/live-bids";
import { gbp, type Lot, type Sale, type SaleStateResponse, type TickResponse } from "@/lib/types";
import { X, Dots, Users, Clock, Pause, Play, Share, Check, Chevron } from "@/components/icons";

const TICK_MS = 8000;   // backstop; the key moments are scheduled exactly below
const NUDGE_MS = 1500;  // debounce before reacting to a bid or a question
const STATE_MS = 1200;  // how often the stage re-reads the sale
const SALE_KEY = "sellout.sale";


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
      // A finished rehearsal must not swallow the next sale opened from this tab.
      if (next.sale.phase === "ended") { sessionStorage.removeItem(SALE_KEY); return false; }
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
            image_url: o.generatedImage || o.image,
            low: o.low,
            high: o.high,
            reserve: o.reserve ?? Math.round(o.low * 0.55),
            comps: o.comps ?? [],
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
  const { speak, connect, avatar, speaking, analyser } = useAuctioneerVoice(mock, state?.sale.phase === "ended");

  /* ── Ticking, one at a time ──────────────────────────────── */
  const ticking = useRef(false);

  const doTick = useCallback(async () => {
    if (!started || paused || !code || state?.sale.phase === "ended" || ticking.current || document.hidden) return;
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
  }, [started, paused, code, speak, state?.sale.phase]);

  useEffect(() => { tickRef.current = doTick; }, [doTick]);

  useEffect(() => {
    if (!started || paused || status !== "ready" || state?.sale.phase === "ended") return;
    doTick();
    const t = setInterval(doTick, TICK_MS);
    return () => clearInterval(t);
  }, [started, paused, status, doTick]);

  /* ── Tick at the moments that matter, not just on the interval ── */
  const phase = state?.sale.phase;
  const endsAt = state?.sale.lot_ends_at ?? null;
  const startAt = state?.sale.starts_at ?? null;
  useEffect(() => {
    if (!started || paused || !phase || phase === "ended") return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number) => {
      const fire = () => { if (ticking.current) timers.push(setTimeout(fire, 400)); else tickRef.current(); };
      if (ms > 0) timers.push(setTimeout(fire, ms));
    };
    const t = Date.now();
    if (phase === "idle" && startAt) at(Math.max(50, Date.parse(startAt) - t + 100));
    if (phase === "presenting" && endsAt) at(Math.max(50, Date.parse(endsAt) - t + 100));
    if (phase === "bidding" && endsAt) {
      at(Date.parse(endsAt) - t - CALL_SECONDS * 1000); // going once, going twice
      at(Math.max(50, Date.parse(endsAt) - t + 250));   // the hammer
    }
    if (phase === "sold") { at(4000); at(8000); }          // land the result, then the next lot
    return () => timers.forEach(clearTimeout);
  }, [started, paused, phase, endsAt, startAt]);

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

  const [startIn, setStartIn] = useState(30);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [endPrompt, setEndPrompt] = useState(false);
  const [endError, setEndError] = useState("");
  const [previewNote, setPreviewNote] = useState("");
  useEffect(() => {
    if (!code || started) return;
    let alive = true;
    setPreviewNote("Creating clean previews…");
    fetch(`/api/sale/${code}/previews`, {method:"POST"}).then(r => {
      if (alive) setPreviewNote(r.ok ? "" : "Preview unavailable · refresh to retry");
    }).catch(() => { if (alive) setPreviewNote("Preview unavailable · refresh to retry"); });
    return () => { alive = false; };
  }, [code, started]);

  const begin = async () => {
    if (starting) return;
    setStarting(true); setEndError("");
    // Unlock audio inside the tap itself: iOS Safari refuses once we have awaited anything.
    const unlock = connect();
    try {
      const res = await fetch(`/api/sale/${code}/timing`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({inSeconds:startIn})});
      if (!res.ok && state?.sale.phase === "idle") throw new Error();
      const { startsAt } = res.ok ? (await res.json()) as { startsAt: string } : { startsAt: null };
      if (startsAt) setState(s => s && { ...s, sale: { ...s.sale, starts_at: startsAt } });
      setStarted(true);
      await unlock;
    } catch {setEndError("Could not schedule the start. Try again.");}
    finally {setStarting(false);}   // the tap is what lets the avatar play sound
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

  const span = windowSeconds(high);
  const pct = settled || ended ? 100 : sale?.phase === "bidding" ? Math.min(100, ((span - left) / span) * 100) : 0;
  const untilStart = sale?.starts_at ? Math.max(0, Math.ceil((Date.parse(sale.starts_at) - now) / 1000)) : null;
  const mmss = `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;

  return (
    <main className="shell auction-shell"><EnableWinSound/>
      {/* Auctioneer */}
      <div style={{ position: "relative", padding: "0 12px", paddingTop: "max(12px, env(safe-area-inset-top))" }}>
        <div style={{ position: "relative", borderRadius: 20, overflow: "hidden", background: "#e9e9e7" }}>
          <Auctioneer state={avatar} speaking={speaking} mock={mock} analyser={analyser} />
          {avatar === "failed" && <button className="avatar-retry" onClick={() => void connect()}>Retry auctioneer</button>}
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: 12, pointerEvents: "none" }}>
            <button className="icon-btn" style={{ pointerEvents: "auto" }} aria-label="Leave" onClick={() => router.push("/objects")}><X size={18} /></button>
            <button className="icon-btn" style={{ pointerEvents: "auto" }} aria-label="More" onClick={() => setSheet(true)}><Dots size={18} /></button>
          </div>
          {started && !ended && <LiveBids bids={state?.bids ?? []} lotId={lot?.id ?? null} now={now} hasCaption={!!line} />}
          {line && (
            <p
              className="fade-in auction-caption"
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
      <div className="auction-stage">
        {lot?.image_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={lot.image_url} alt={lot.name} className="auction-product" />
        ) : (
          <p className="meta">{ended ? "That's the sale" : "Waiting for the first lot"}</p>
        )}
      </div>

      {/* Details */}
      <section className="pad safe-b auction-details" style={{ paddingTop: 6 }}>
        <h2 className="title">{lot?.name ?? (ended ? "Sale complete" : "Up next")}</h2>
        {lot && !ended && <PriceEvidence comps={lot.comps} compact />}

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
      {(!started || (sale?.phase === "idle" && untilStart !== null)) && <StartGate onStart={begin} lots={lots.length} code={code} url={shareUrl} items={lots} note={previewNote} startIn={startIn} onStartIn={setStartIn} untilStart={started ? untilStart : null} starting={starting} error={endError} />}

      {started && sale?.phase === "presenting" && <div className="bidding-countdown" role="status"><span>Bidding starts in</span><strong key={Math.ceil((Date.parse(sale.lot_ends_at ?? "") - now) / 1000)}>{Math.max(0, Math.ceil((Date.parse(sale.lot_ends_at ?? "") - now) / 1000)) || "Go"}</strong></div>}
      {started && !ended && <button className="end-auction-control" onClick={() => setEndPrompt(true)}>End auction</button>}
      {endPrompt && !ended && <div className="end-auction-overlay" role="dialog" aria-modal="true" aria-labelledby="end-auction-title"><div>
        <h2 id="end-auction-title">End the auction?</h2><p>The current highest bid wins. Remaining items won’t be sold.</p>
        {endError && <p role="alert">{endError}</p>}
        <button className="pill pill--primary" disabled={ending} onClick={async () => {
          setEnding(true); setEndError("");
          try {
            const res = await fetch(`/api/sale/${code}/end`,{method:"POST"});
            if (!res.ok) throw new Error();
            const next = await fetch(`/api/sale/${code}`).then(r=>r.json()); setState(next); setEndPrompt(false);
          } catch { setEndError("Could not end auction. Try again."); } finally {setEnding(false);}
        }}>{ending ? "Ending…" : "End auction"}</button>
        <button className="pill" disabled={ending} onClick={()=>setEndPrompt(false)}>Keep going</button>
      </div></div>}
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

function useAuctioneerVoice(mock: boolean, ended: boolean) {
  const [avatar,setAvatar] = useState<AvatarState>("idle");
  const [speaking,setSpeaking] = useState(false);
  const context = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const source = useRef<AudioBufferSourceNode | null>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const stopped = useRef(ended);
  const pendingLine = useRef("");
  const connect = useCallback(async () => {
    if(stopped.current) return;
    context.current ??= new AudioContext();
    await context.current.resume();
    setAvatar("live");
  },[]);
  const speak = useCallback((text:string) => {
    if(stopped.current || !text.trim()) return;
    pendingLine.current=text;
    const turn=++generation.current;
    request.current?.abort();
    source.current?.stop(); source.current=null;
    setSpeaking(false);
    const controller=new AbortController();request.current=controller;
    void (async()=>{
      try {
        context.current ??= new AudioContext();
        const res=await fetch("/api/voice",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text}),signal:controller.signal});
        if(!res.ok) throw new Error("Voice unavailable");
        const buffer=await context.current.decodeAudioData(await res.arrayBuffer());
        if(stopped.current || turn!==generation.current) return;
        await context.current.resume();
        if(stopped.current || turn!==generation.current) return;
        const audio=context.current.createBufferSource();audio.buffer=buffer;
        analyser.current?.disconnect();
        const meter=context.current.createAnalyser();meter.fftSize=512;
        analyser.current=meter;audio.connect(meter);meter.connect(context.current.destination);
        source.current=audio;setSpeaking(true);setAvatar("live");
        audio.onended=()=>{if(turn===generation.current)setSpeaking(false);};audio.start();
      } catch {if(!controller.signal.aborted && !stopped.current){setAvatar("failed");setSpeaking(false);}}
    })();
  },[]);
  const retry = useCallback(async()=>{await connect();if(pendingLine.current)speak(pendingLine.current);},[connect,speak]);
  useEffect(()=>{
    // Take no new lines once the sale is over, but let the sign-off already playing finish.
    stopped.current=ended;
  },[ended]);
  useEffect(()=>()=>{stopped.current=true;generation.current++;request.current?.abort();source.current?.stop();void context.current?.close();},[]);
  return {speak,connect:retry,avatar,analyser,speaking: speaking && !ended};
}

function Auctioneer({ state, speaking, analyser }: { state: AvatarState; speaking:boolean; mock:boolean; analyser: React.RefObject<AnalyserNode | null> }) {
  return <div className="character-stage" data-speaking={speaking}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <TalkingAuctioneer analyser={analyser} speaking={speaking}/>
    <div className="character-status">{state==="failed" ? "Voice unavailable" : speaking ? "Speaking" : "Your auctioneer"}<span className="voice-bars" aria-hidden="true"><i/><i/><i/><i/></span></div>
  </div>;
}

function StartGate({ onStart, lots, code, url, items, note, startIn, onStartIn, untilStart, starting, error }: { startIn: number; onStartIn: (n:number)=>void; untilStart: number | null; starting:boolean; error:string; items: Lot[]; note: string; onStart: () => void; lots: number; code: string | null; url: string }) {
  return (
    <div className="sale-start sale-start--orbit">
      <header className="waiting-host-header"><h2>In your orbit.</h2><p>{code ? `Room ${code}` : "Getting ready"} · {lots} {lots === 1 ? "item" : "items"}</p></header>
      <WaitingOrbit lots={items}/>
      <div className="sale-start-content">
        <p className="sale-start-room">{code ? `Room ${code}` : "Getting ready"}<span aria-hidden="true"> · </span>{lots} {lots === 1 ? "item" : "items"}</p>

        <p className="waiting-preview-note" role="status">{note}</p>
        {url && <div className="lobby-qr"><QRCodeSVG value={url} size={200} marginSize={2}/></div>}
        <a className="lobby-link" href={url} target="_blank" rel="noreferrer">Scan to join ↗</a>
        {untilStart !== null ? <div className="bidding-countdown" role="timer" aria-live="polite" style={{ position: "static", transform: "none" }}>
          <span>Auction starts in</span><strong>{untilStart ? `${Math.floor(untilStart / 60)}:${String(untilStart % 60).padStart(2, "0")}` : "Go"}</strong>
        </div> : <>
          <label className="duration-picker">Start the auction<select value={startIn} onChange={e=>onStartIn(Number(e.target.value))} disabled={starting}>
            <option value={0}>Now</option><option value={30}>In 30 seconds</option><option value={60}>In 1 minute</option><option value={120}>In 2 minutes</option><option value={300}>In 5 minutes</option>
          </select></label>
          {error && <p role="alert">{error}</p>}
          <button className="pill pill--primary" disabled={starting} onClick={onStart}>
            {startIn ? "Start countdown" : "Start auction"} <Chevron size={17} />
          </button>
        </>}
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
      {sold && <><WinSound id={lot.id}/><SaleConfetti id={lot.id}/></>}
      <div style={{ textAlign: "center", width: "100%" }}>
        {lot.image_url && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={lot.image_url} alt={lot.name} style={{ maxWidth: "68%", maxHeight: "40svh", objectFit: "contain", filter: "drop-shadow(0 18px 22px rgba(0,0,0,.16))" }} />
        )}
        <p className="meta" style={{ marginTop: 20 }}>{sold ? "Sold" : "Unsold"}</p>
        <p className="numeral" style={{ margin: "4px 0 0" }}>{sold ? gbp(Number(lot.sold_for ?? 0)) : "—"}</p>
        <p className="title" style={{ marginTop: 10 }}>{sold ? `${lot.sold_to} has won the item` : "No bids"}</p>
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
        {lots.map((l) => l.status === "sold" ? <SaleReceipt key={l.id} lot={l}/> : (
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
                No bids
              </span>
            </span>
            <span style={{ fontSize: 15, fontVariantNumeric: "tabular-nums", color: "var(--ink-3)" }}>
              —
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
