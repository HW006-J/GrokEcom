"use client";
import { useEffect, useState } from "react";
import { gbp, useCountdown, useShow } from "@/components/useShow";
import { buyNowUrl, type BidResponse } from "@/lib/types";

export default function WatchClient({ showId }: { showId: string }) {
  const { show, item, bids, messages, error, loaded } = useShow(showId);
  const [name, setName] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [text, setText] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const left = useCountdown(show?.phase === "auction" ? show.auction_ends_at : null);

  useEffect(() => {
    const id = setTimeout(() => {
      try { setName(localStorage.getItem("cl_name") ?? ""); } catch { setName(""); }
    }, 0);
    return () => clearTimeout(id);
  }, []);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  async function bid(step: number) {
    if (!name || !item) return;
    const base = show?.high_bid != null ? Number(show.high_bid) : Math.floor(Number(item.price_estimate ?? 20) * 0.5);
    const amount = base + step;
    setBusy(true);
    try {
      const res = await fetch("/api/bid", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showId, name, amount }),
      });
      const data = (await res.json()) as BidResponse & { error?: string };
      if (!res.ok || !data.ok) flash(data.error ?? `Outbid: high bid is ${gbp(data.highBid)}`);
      else flash(`You bid ${gbp(amount)}`);
    } catch (e) {
      flash((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!name || !text.trim()) return;
    const t = text.trim();
    setText("");
    await fetch("/api/message", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ showId, name, text: t }),
    }).catch((e) => flash((e as Error).message));
  }

  if (error) return <Shell><p className="text-red-400 text-sm">{error}</p></Shell>;
  if (!loaded || name === null) return <Shell><p className="text-zinc-400">Loading…</p></Shell>;

  if (!name) {
    return (
      <Shell>
        <h1 className="text-2xl font-bold">Join the show</h1>
        <p className="text-zinc-400 text-sm">Pick a display name. The host will call your bids by it.</p>
        <input
          autoFocus value={draftName} onChange={(e) => setDraftName(e.target.value)}
          placeholder="Your name" className="mt-2 w-full rounded-xl bg-zinc-900 border border-zinc-700 px-4 py-3"
          onKeyDown={(e) => { if (e.key === "Enter" && draftName.trim()) { localStorage.setItem("cl_name", draftName.trim()); setName(draftName.trim()); } }}
        />
        <button
          disabled={!draftName.trim()}
          onClick={() => { localStorage.setItem("cl_name", draftName.trim()); setName(draftName.trim()); }}
          className="rounded-xl bg-white text-black px-5 py-3 font-semibold disabled:opacity-40"
        >Let&apos;s go</button>
      </Shell>
    );
  }

  const won = item?.status === "sold" && item.sold_to === name;
  const buy = buyNowUrl(item?.shopify_variant_id ?? null);
  const feed = [
    ...bids.map((b) => ({ id: b.id, at: b.created_at, text: `${b.bidder_name} bid ${gbp(b.amount)}`, kind: "bid" as const })),
    ...messages.map((m) => ({ id: m.id, at: m.created_at, text: `${m.name}: ${m.text}`, kind: "msg" as const })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 20);

  return (
    <Shell>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-zinc-500">{show?.title}</div>
          <div className="text-sm text-zinc-400">Hi {name}</div>
        </div>
        <Phase phase={show?.phase ?? "idle"} />
      </div>

      {won && (
        <div className="rounded-2xl bg-emerald-500 text-black p-5 text-center">
          <div className="text-sm font-semibold uppercase tracking-wide">You won!</div>
          <div className="text-3xl font-black mt-1">{gbp(show?.high_bid ?? item?.buy_now_price)}</div>
          {item?.invoice_url ? (
            <a href={item.invoice_url} className="mt-3 inline-block rounded-xl bg-black text-white px-5 py-3 font-semibold">Pay now</a>
          ) : <div className="text-sm mt-2">Preparing your checkout…</div>}
        </div>
      )}

      {item ? (
        <div className="rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800">
          {item.image_urls[0] && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.image_urls[0]} alt={item.title} className="w-full aspect-square object-cover" />
          )}
          <div className="p-4 space-y-1">
            <div className="text-lg font-bold leading-tight">{item.title}</div>
            <div className="text-sm text-zinc-400">{[item.brand, item.size, item.condition].filter(Boolean).join(" · ")}</div>
            {item.description && <p className="text-sm text-zinc-300 pt-1">{item.description}</p>}
            <div className="flex items-end justify-between pt-2">
              <div>
                <div className="text-xs text-zinc-500">High bid</div>
                <div className="text-2xl font-black">{gbp(show?.high_bid)}</div>
                {show?.high_bidder_name && <div className="text-xs text-zinc-400">{show.high_bidder_name}</div>}
              </div>
              {show?.phase === "auction" && (
                <div className="text-right">
                  <div className="text-xs text-zinc-500">Closes in</div>
                  <div className={`text-2xl font-black tabular-nums ${left <= 10 ? "text-red-400" : ""}`}>{left}s</div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-6 text-center text-zinc-400">Show starting soon…</div>
      )}

      {item && !won && (
        <div className="grid grid-cols-2 gap-2">
          <button disabled={busy || show?.phase !== "auction"} onClick={() => bid(1)}
            className="rounded-xl bg-white text-black py-3 font-bold disabled:opacity-40">Bid +£1</button>
          <button disabled={busy || show?.phase !== "auction"} onClick={() => bid(5)}
            className="rounded-xl bg-white text-black py-3 font-bold disabled:opacity-40">Bid +£5</button>
          {buy && item.status !== "sold" && (
            <a href={buy} target="_blank" rel="noreferrer"
              className="col-span-2 rounded-xl bg-emerald-500 text-black py-3 text-center font-bold">
              Buy now {gbp(item.buy_now_price)}
            </a>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Ask the host anything…" className="flex-1 rounded-xl bg-zinc-900 border border-zinc-700 px-4 py-3 text-sm" />
        <button onClick={send} className="rounded-xl bg-zinc-700 px-4 font-semibold">Send</button>
      </div>

      <ul className="space-y-1 text-sm">
        {feed.map((f) => (
          <li key={f.id} className={f.kind === "bid" ? "text-emerald-400" : "text-zinc-300"}>{f.text}</li>
        ))}
      </ul>

      {toast && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-zinc-100 text-black px-4 py-2 text-sm font-semibold shadow">{toast}</div>}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-md p-4 flex flex-col gap-4">{children}</main>;
}

export function Phase({ phase }: { phase: string }) {
  const map: Record<string, string> = {
    idle: "bg-zinc-700", intro: "bg-blue-600", qa: "bg-violet-600", auction: "bg-red-600", closed: "bg-emerald-600", ended: "bg-zinc-700",
  };
  const label: Record<string, string> = { idle: "Starting", intro: "Showing", qa: "Q&A", auction: "LIVE AUCTION", closed: "Sold", ended: "Ended" };
  return <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${map[phase] ?? "bg-zinc-700"}`}>{label[phase] ?? phase}</span>;
}
