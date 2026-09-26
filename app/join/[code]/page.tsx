"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import { gbp, type Lot, type Sale, type SaleBid, type SaleMessage, type SaleStateResponse } from "@/lib/types";
import { Users, Clock, Check, Chevron } from "@/components/icons";

const ROUND = 30;
const NAME_KEY = "sellout.name";
const POLL_MS = 3000;

type Feed = { id: string; kind: "bid" | "message"; who: string; what: string };

export default function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const room = code.toUpperCase();

  const [name, setName] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [state, setState] = useState<SaleStateResponse | null>(null);
  const [missing, setMissing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [watchers, setWatchers] = useState(1);
  const [toast, setToast] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    try { setName(localStorage.getItem(NAME_KEY)); } catch {}
  }, []);

  /* ── State: fetch, then Realtime, with polling as a safety net ── */
  const refresh = useCallback(async () => {
    const res = await fetch(`/api/sale/${room}`).catch(() => null);
    if (!res) return;
    if (res.status === 404) { setMissing(true); return; }
    if (!res.ok) return;
    setState((await res.json()) as SaleStateResponse);
  }, [room]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const saleId = state?.sale.id;
  useEffect(() => {
    if (!saleId || !name) return;
    let channel: ReturnType<ReturnType<typeof supabaseBrowser>["channel"]> | null = null;
    try {
      const db = supabaseBrowser();
      channel = db
        .channel(`sale:${room}`, { config: { presence: { key: `${name}-${Math.random().toString(36).slice(2, 6)}` } } })
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "sales", filter: `id=eq.${saleId}` },
          (p) => setState((s) => (s ? { ...s, sale: p.new as Sale } : s)))
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "sale_bids", filter: `sale_id=eq.${saleId}` },
          (p) => setState((s) => (s ? { ...s, bids: [...s.bids, p.new as SaleBid].slice(-20) } : s)))
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "sale_messages", filter: `sale_id=eq.${saleId}` },
          (p) => setState((s) => (s ? { ...s, messages: [...s.messages, p.new as SaleMessage].slice(-20) } : s)))
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "lots", filter: `sale_id=eq.${saleId}` },
          (p) => setState((s) => (s && s.lot?.id === (p.new as Lot).id ? { ...s, lot: p.new as Lot } : s)))
        .on("presence", { event: "sync" }, () => {
          setWatchers(Math.max(1, Object.keys(channel?.presenceState() ?? {}).length));
        })
        .subscribe((status) => { if (status === "SUBSCRIBED") channel?.track({ name }); });
    } catch {
      // Polling above keeps the page honest if Realtime is unavailable.
    }
    return () => { if (channel) supabaseBrowser().removeChannel(channel); };
  }, [saleId, name, room]);

  /* ── Derived ─────────────────────────────────────────────── */
  const sale = state?.sale ?? null;
  const lot = state?.lot ?? null;

  const opening = useMemo(() => {
    if (!lot) return 0;
    return Math.round(Number(lot.reserve ?? 0) || Number(lot.low ?? 0) * 0.55);
  }, [lot]);

  const high = sale?.high_bid === null || sale?.high_bid === undefined ? null : Number(sale.high_bid);
  const shown = high ?? opening;
  const left = sale?.lot_ends_at ? Math.max(0, Math.round((new Date(sale.lot_ends_at).getTime() - now) / 1000)) : 0;
  const biddingOpen = sale?.phase === "bidding" && left > 0;
  const iLead = Boolean(name && sale?.high_bidder === name);
  const iWon = Boolean(lot?.status === "sold" && name && lot.sold_to === name);

  const feed: Feed[] = useMemo(() => {
    if (!state) return [];
    const items: (Feed & { at: string })[] = [
      ...state.bids.map((b) => ({ id: b.id, kind: "bid" as const, who: b.bidder, what: gbp(Number(b.amount)), at: b.created_at })),
      ...state.messages.map((m) => ({ id: m.id, kind: "message" as const, who: m.name, what: m.text, at: m.created_at })),
    ];
    return items.sort((a, b) => a.at.localeCompare(b.at)).slice(-6);
  }, [state]);

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2200); };

  const bid = async (step: number) => {
    if (!name || pending) return;
    setPending(true);
    const amount = shown + step;
    const res = await fetch(`/api/sale/${room}/bid`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bidder: name, amount }),
    }).catch(() => null);
    setPending(false);
    if (!res?.ok) {
      const err = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
      flash(err?.error ?? "Could not place that bid");
      refresh();
      return;
    }
    refresh();
  };

  const send = async () => {
    const t = text.trim();
    if (!t || !name) return;
    setText("");
    await fetch(`/api/sale/${room}/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, text: t }),
    }).catch(() => null);
  };

  /* ── Name gate ───────────────────────────────────────────── */
  if (!name) {
    return (
      <main className="shell" style={{ justifyContent: "center" }}>
        <div className="pad" style={{ textAlign: "center" }}>
          <p className="meta">Room {room}</p>
          <h1 className="display" style={{ marginTop: 10 }}>What shall the<br />auctioneer call you?</h1>
          <input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && draftName.trim()) { const n = draftName.trim().slice(0, 20); localStorage.setItem(NAME_KEY, n); setName(n); } }}
            placeholder="Your name"
            autoFocus
            maxLength={20}
            style={{
              width: "100%", marginTop: 26, padding: "16px 18px",
              border: "1px solid var(--line-2)", borderRadius: 999,
              fontSize: 16, fontFamily: "var(--sans)", textAlign: "center", outline: "none",
            }}
          />
          <button
            className="pill pill--primary"
            style={{ width: "100%", marginTop: 12 }}
            disabled={!draftName.trim()}
            onClick={() => { const n = draftName.trim().slice(0, 20); localStorage.setItem(NAME_KEY, n); setName(n); }}
          >
            Join the sale <Chevron size={17} />
          </button>
        </div>
      </main>
    );
  }

  if (missing) {
    return (
      <main className="shell" style={{ display: "grid", placeItems: "center" }}>
        <div className="pad" style={{ textAlign: "center" }}>
          <h1 className="title">Room {room} has closed</h1>
          <p className="sub" style={{ marginTop: 8 }}>Ask for a fresh link and try again.</p>
        </div>
      </main>
    );
  }

  /* ── The room ────────────────────────────────────────────── */
  const pct = ((ROUND - left) / ROUND) * 100;
  const mmss = `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
  const status =
    !sale ? "Joining…"
    : sale.phase === "idle" ? "The sale is about to start"
    : sale.phase === "presenting" ? "Up next"
    : sale.phase === "bidding" ? "On the block"
    : sale.phase === "sold" ? "Hammer down"
    : "That's the sale";

  return (
    <main className="shell">
      <header className="pad safe-t" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="meta">Room {room} · {status}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--ink-2)", fontSize: 13 }}>
          <Users size={16} /> {watchers}
        </span>
      </header>

      {/* Lot */}
      <div style={{ flex: 1, minHeight: 0, display: "grid", placeItems: "center", padding: "6px 22px 0" }}>
        {lot?.image_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={lot.image_url}
            alt={lot.name}
            style={{ maxWidth: "78%", maxHeight: "100%", objectFit: "contain", mixBlendMode: "multiply" }}
          />
        ) : (
          <div
            aria-hidden
            style={{ width: "70%", aspectRatio: "1", borderRadius: 24, background: "#f4f4f2" }}
          />
        )}
      </div>

      <section className="pad safe-b" style={{ paddingTop: 4 }}>
        <h1 className="title">{lot?.name ?? "Waiting for the first lot"}</h1>
        {lot?.condition && <p className="sub" style={{ marginTop: 3 }}>{lot.condition}</p>}

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: 12 }}>
          <div>
            <p className="meta" style={{ margin: 0 }}>{lot?.status === "sold" ? "Sold for" : high === null ? "Opening bid" : "Current bid"}</p>
            <p className="numeral" style={{ margin: "2px 0 0" }}>{gbp(shown)}</p>
            {sale?.high_bidder && (
              <p className="sub" style={{ marginTop: 2, color: iLead ? "var(--accent)" : undefined }}>
                {lot?.status === "sold" ? `${sale.high_bidder} wins` : iLead ? "You're leading" : `${sale.high_bidder} leads`}
              </p>
            )}
          </div>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--ink-2)", fontSize: 13, fontVariantNumeric: "tabular-nums", paddingBottom: 6 }}>
            <Clock size={16} /> {mmss}
          </span>
        </div>

        <div className="bar-track" style={{ marginTop: 12 }}>
          <div className="bar-fill" style={{ width: `${lot?.status === "sold" ? 100 : pct}%` }} />
        </div>

        {/* Result or bidding */}
        {lot?.status === "sold" ? (
          iWon ? (
            <div style={{ marginTop: 14, padding: 16, borderRadius: 20, background: "#f2f7ff", border: "1px solid rgba(10,108,255,.22)" }}>
              <p style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: 7, color: "var(--accent)", fontWeight: 600 }}>
                <Check size={16} /> You won it for {gbp(Number(lot.sold_for ?? shown))}
              </p>
              {lot.checkout_url ? (
                <a className="pill pill--primary" style={{ width: "100%", marginTop: 12, textDecoration: "none" }} href={lot.checkout_url} target="_blank" rel="noreferrer">
                  Pay now
                </a>
              ) : (
                <p className="sub" style={{ marginTop: 6 }}>The seller will send you a payment link.</p>
              )}
            </div>
          ) : (
            <p className="sub" style={{ marginTop: 14, textAlign: "center" }}>
              {lot.sold_to ? `Sold to ${lot.sold_to}. Next lot coming up.` : "No bids on that one. Next lot coming up."}
            </p>
          )
        ) : (
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button className="pill pill--quiet" style={{ flex: 1 }} disabled={!biddingOpen || pending} onClick={() => bid(1)}>
              {gbp(shown + 1)}
            </button>
            <button className="pill pill--primary" style={{ flex: 1.4 }} disabled={!biddingOpen || pending} onClick={() => bid(5)}>
              Bid {gbp(shown + 5)}
            </button>
          </div>
        )}

        {/* Feed */}
        <div style={{ marginTop: 12, minHeight: 46, maxHeight: 76, overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 2 }}>
          {feed.map((f) => (
            <p key={f.id} className="fade-in" style={{ margin: 0, fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.45, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              <span style={{ color: "var(--ink)", fontWeight: 500 }}>{f.who}</span>{" "}
              {f.kind === "bid" ? `bid ${f.what}` : f.what}
            </p>
          ))}
        </div>

        {/* Ask */}
        <div className="dock" style={{ marginTop: 8 }}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") send(); }}
            placeholder="Ask the auctioneer…"
            maxLength={140}
            style={{ flex: 1, border: 0, outline: "none", background: "transparent", padding: "0 14px", fontSize: 15, fontFamily: "var(--sans)", minHeight: 44 }}
          />
          <button className="pill pill--dark" style={{ minHeight: 44, paddingInline: 18 }} onClick={send} disabled={!text.trim()}>
            Ask
          </button>
        </div>
      </section>

      {toast && (
        <div
          className="fade-in"
          style={{
            position: "absolute", left: 22, right: 22, bottom: "calc(env(safe-area-inset-bottom) + 96px)",
            padding: "12px 16px", borderRadius: 16, textAlign: "center",
            background: "var(--ink)", color: "#fff", fontSize: 14, zIndex: 30,
          }}
        >
          {toast}
        </div>
      )}
    </main>
  );
}
