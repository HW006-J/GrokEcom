"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { gbp, useCountdown, useShow } from "@/components/useShow";
import { Phase } from "@/app/watch/[showId]/WatchClient";
import type { HostTickResponse } from "@/lib/types";
import type { AnamClient } from "@anam-ai/js-sdk";

type Status = "idle" | "connecting" | "live" | "mock" | "error";

export default function StageClient({ showId, mock }: { showId: string; mock: boolean }) {
  const { show, item, bids, messages, error, loaded, lastEvent } = useShow(showId);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [caption, setCaption] = useState("");
  const [ticking, setTicking] = useState(false);
  const anamRef = useRef<AnamClient | null>(null);
  const stoppedRef = useRef(false);
  const tickingRef = useRef(false);
  const left = useCountdown(show?.phase === "auction" ? show.auction_ends_at : null);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? (typeof window !== "undefined" ? window.location.origin : "");
  const watchUrl = `${appUrl}/watch/${showId}`;

  // ---- speaking ----
  const speak = useCallback(async (text: string) => {
    if (!text) return;
    setCaption(text);
    if (mock) {
      try {
        const u = new SpeechSynthesisUtterance(text);
        const voices = window.speechSynthesis.getVoices();
        u.voice = voices.find((v) => v.lang.startsWith("en-GB")) ?? voices.find((v) => v.lang.startsWith("en")) ?? null;
        u.rate = 1.05;
        window.speechSynthesis.speak(u);
      } catch { /* no TTS available */ }
      return;
    }
    const client = anamRef.current;
    if (!client) return;
    try {
      await client.talk(text);
    } catch (e) {
      console.warn("talk failed", e);
    }
  }, [mock]);

  // ---- Anam connection with auto-reconnect ----
  const connectAnam = useCallback(async () => {
    if (mock) { setStatus("mock"); return; }
    setStatus("connecting");
    try {
      const res = await fetch("/api/session-token", { method: "POST" });
      if (!res.ok) throw new Error(`session-token ${res.status}`);
      const { sessionToken } = (await res.json()) as { sessionToken: string };
      const { createClient, AnamEvent } = await import("@anam-ai/js-sdk");
      const client = createClient(sessionToken, { disableInputAudio: true });
      client.addListener(AnamEvent.SESSION_READY, () => setStatus("live"));
      client.addListener(AnamEvent.CONNECTION_CLOSED, () => {
        anamRef.current = null;
        if (!stoppedRef.current) {
          setStatus("connecting");
          setTimeout(() => { if (!stoppedRef.current) connectAnam(); }, 1000);
        }
      });
      anamRef.current = client;
      await client.streamToVideoElement("persona-video");
    } catch (e) {
      console.error(e);
      setStatus("error");
      if (!stoppedRef.current) setTimeout(() => { if (!stoppedRef.current) connectAnam(); }, 4000);
    }
  }, [mock]);

  // ---- host loop ----
  const tick = useCallback(async () => {
    if (tickingRef.current) return;
    tickingRef.current = true;
    setTicking(true);
    try {
      const res = await fetch("/api/host/tick", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showId }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as HostTickResponse;
      await speak(data.say);
    } catch (e) {
      console.warn("tick failed", e);
    } finally {
      tickingRef.current = false;
      setTicking(false);
    }
  }, [showId, speak]);

  useEffect(() => {
    if (!running) return;
    stoppedRef.current = false;
    connectAnam();
    tick();
    const id = setInterval(tick, 8000);
    return () => {
      clearInterval(id);
      stoppedRef.current = true;
      anamRef.current?.stopStreaming().catch(() => {});
      anamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  // Immediate (debounced) tick on new bids/messages.
  useEffect(() => {
    if (!running || lastEvent === 0) return;
    const id = setTimeout(tick, 1500);
    return () => clearTimeout(id);
  }, [lastEvent, running, tick]);

  const feed = [
    ...bids.map((b) => ({ id: b.id, at: b.created_at, text: `${b.bidder_name} bid ${gbp(b.amount)}`, kind: "bid" as const })),
    ...messages.map((m) => ({ id: m.id, at: m.created_at, text: `${m.name}: ${m.text}`, kind: "msg" as const })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 8);

  const pct = show?.phase === "auction" && show.auction_ends_at ? Math.min(100, (left / 60) * 100) : 0;

  return (
    <div className="w-[1920px] h-[1080px] overflow-hidden bg-black text-white relative flex">
      {/* Avatar column */}
      <div className="w-[40%] h-full relative bg-zinc-950">
        {mock ? (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-b from-zinc-800 to-zinc-950">
            <div className="text-center">
              <div className="mx-auto w-64 h-64 rounded-full bg-zinc-700 flex items-center justify-center text-8xl">🎙️</div>
              <div className="mt-6 text-2xl text-zinc-400">Host (mock)</div>
            </div>
          </div>
        ) : (
          <video id="persona-video" autoPlay playsInline className="w-full h-full object-cover" />
        )}
        {/* caption */}
        <div className="absolute left-0 right-0 bottom-[220px] px-10">
          {caption && (
            <div className="bg-black/70 backdrop-blur rounded-2xl px-6 py-4 text-3xl leading-snug font-medium">{caption}</div>
          )}
        </div>
        {/* QR */}
        <div className="absolute left-10 bottom-10 flex items-center gap-5 bg-white text-black rounded-2xl p-4">
          <QRCodeSVG value={watchUrl} size={150} />
          <div>
            <div className="text-3xl font-black leading-tight">Scan to bid</div>
            <div className="text-lg text-zinc-600">or buy now</div>
          </div>
        </div>
        {/* status pill */}
        <div className="absolute top-6 left-6 flex items-center gap-3">
          <span className={`rounded-full px-3 py-1 text-sm font-bold uppercase ${
            status === "live" ? "bg-red-600" : status === "mock" ? "bg-amber-500 text-black" : status === "error" ? "bg-zinc-700" : "bg-zinc-700"
          }`}>{status === "live" ? "● LIVE" : status}</span>
          {ticking && <span className="text-xs text-zinc-500">thinking…</span>}
        </div>
      </div>

      {/* Item column */}
      <div className="flex-1 h-full flex flex-col p-12 gap-8">
        <div className="flex items-center justify-between">
          <div className="text-3xl font-bold text-zinc-300">{show?.title ?? "ClosetLive"}</div>
          <div className="flex items-center gap-4 scale-150 origin-right">
            <Phase phase={show?.phase ?? "idle"} />
          </div>
        </div>

        {error && <div className="text-red-400 text-2xl">{error}</div>}

        {item ? (
          <div className="flex gap-10 flex-1 min-h-0">
            {item.image_urls[0] && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.image_urls[0]} alt={item.title} className="h-full aspect-[4/5] object-cover rounded-3xl bg-zinc-900" />
            )}
            <div className="flex-1 flex flex-col justify-between">
              <div>
                <div className="text-6xl font-black leading-tight">{item.title}</div>
                <div className="mt-4 text-3xl text-zinc-400">{[item.brand, item.size].filter(Boolean).join(" · ")}</div>
                {item.condition && <div className="mt-2 text-2xl text-zinc-500">Condition: {item.condition}</div>}
                {item.description && <p className="mt-6 text-2xl text-zinc-300 leading-relaxed line-clamp-4">{item.description}</p>}
              </div>
              <div className="grid grid-cols-3 gap-6">
                <Stat label="Buy now" value={gbp(item.buy_now_price)} />
                <Stat label="High bid" value={gbp(show?.high_bid)} sub={show?.high_bidder_name ?? undefined} accent />
                {show?.phase === "auction" ? (
                  <div className="rounded-3xl bg-red-600 p-6">
                    <div className="text-xl uppercase font-bold text-red-100">Closes in</div>
                    <div className="text-7xl font-black tabular-nums">{left}s</div>
                    <div className="mt-3 h-3 rounded-full bg-red-900 overflow-hidden">
                      <div className="h-full bg-white transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                ) : item.status === "sold" ? (
                  <div className="rounded-3xl bg-emerald-500 text-black p-6">
                    <div className="text-xl uppercase font-bold">Sold to</div>
                    <div className="text-5xl font-black">{item.sold_to}</div>
                  </div>
                ) : (
                  <Stat label="Est. value" value={gbp(item.price_estimate)} />
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-5xl text-zinc-600">
            {loaded ? "Show starting soon" : "Loading…"}
          </div>
        )}

        {/* ticker */}
        <div className="h-[200px] rounded-3xl bg-zinc-900 border border-zinc-800 p-6 overflow-hidden">
          <ul className="space-y-2 text-2xl">
            {feed.map((f) => (
              <li key={f.id} className={f.kind === "bid" ? "text-emerald-400 font-bold" : "text-zinc-300"}>{f.text}</li>
            ))}
            {feed.length === 0 && <li className="text-zinc-600">Waiting for the audience…</li>}
          </ul>
        </div>
      </div>

      {/* controls */}
      <div className="absolute top-6 right-6">
        {!running ? (
          <button onClick={() => setRunning(true)} className="rounded-xl bg-white text-black px-5 py-2 font-bold">Start show</button>
        ) : (
          <button onClick={() => setRunning(false)} className="rounded-xl bg-zinc-800 px-5 py-2 font-bold">Stop</button>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-3xl p-6 ${accent ? "bg-white text-black" : "bg-zinc-900 border border-zinc-800"}`}>
      <div className={`text-xl uppercase font-bold ${accent ? "text-zinc-600" : "text-zinc-500"}`}>{label}</div>
      <div className="text-7xl font-black">{value}</div>
      {sub && <div className="text-2xl mt-1 text-zinc-500 truncate">{sub}</div>}
    </div>
  );
}
