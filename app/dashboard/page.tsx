"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { gbp, type Lot } from "@/lib/types";
import type { DashboardResponse, Earnings, SaleSummary } from "@/lib/earnings";
import { X, Chevron, Scan } from "@/components/icons";
import { UnsoldDashboard } from "@/components/unsold-dashboard";

export default function DashboardScreen() {
  const router = useRouter();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/dashboard")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: DashboardResponse) => {
        if (!alive) return;
        setData(d);
        setState("ready");
        setOpen(d.sales[0]?.sale.id ?? null); // the latest sale is the one you care about
      })
      .catch(() => alive && setState("error"));
    return () => { alive = false; };
  }, []);

  const earnings = data?.earnings;
  const sales = data?.sales ?? [];
  const nothingYet = state === "ready" && sales.length === 0;

  return (
    <main className="shell">
      <header className="pad safe-t" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 className="display">Your sales</h1>
          <p className="sub" style={{ marginTop: 6 }}>
            {state === "loading" && "Adding it up…"}
            {state === "error" && "Could not load your sales."}
            {state === "ready" &&
              `${sales.length} ${sales.length === 1 ? "sale" : "sales"} · ${earnings?.lotsSold ?? 0} sold of ${earnings?.lotsOffered ?? 0} offered`}
          </p>
        </div>
        <button className="icon-btn icon-btn--light" aria-label="Close" onClick={() => router.push("/")}>
          <X size={18} />
        </button>
      </header>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "18px 22px 8px" }}>
        {nothingYet ? (
          <EmptyState onScan={() => router.push("/")} />
        ) : (
          <>
            {earnings && <Hero earnings={earnings} />}
            {earnings && <Stats earnings={earnings} />}
            {state === "ready" && <UnsoldDashboard lots={sales.flatMap((sale) => sale.lots)} />}
            {sales.map((s) => (
              <SaleCard
                key={s.sale.id}
                summary={s}
                open={open === s.sale.id}
                onToggle={() => setOpen(open === s.sale.id ? null : s.sale.id)}
              />
            ))}
          </>
        )}
      </div>

      <footer className="pad safe-b" style={{ paddingTop: 10 }}>
        <div className="dock">
          <button className="pill pill--primary" style={{ flex: 1 }} onClick={() => router.push("/")}>
            <Scan size={18} /> Scan another room
          </button>
        </div>
      </footer>
    </main>
  );
}

/* ── Hero ───────────────────────────────────────────────────── */

function Hero({ earnings }: { earnings: Earnings }) {
  const v = earnings.vsEstimate;
  const beat = v ? v.delta > 0 : false;

  return (
    <section className="fade-in" style={{ marginBottom: 22 }}>
      <p className="meta" style={{ margin: 0 }}>Total raised</p>
      <p className="numeral" style={{ margin: "2px 0 0" }}>{gbp(earnings.totalRaised)}</p>
      {earnings.lotsSold === 0 ? (
        <p className="sub" style={{ marginTop: 4 }}>Nothing has sold yet.</p>
      ) : v ? (
        <p className="sub" style={{ marginTop: 4 }}>
          <span style={{ color: beat ? "var(--accent)" : "var(--ink-2)", fontWeight: 500 }}>
            {gbp(Math.abs(v.delta))} {beat ? "above" : "below"} the valuation
          </span>
          {" "}across {v.comparable} {v.comparable === 1 ? "lot" : "lots"}
        </p>
      ) : (
        <p className="sub" style={{ marginTop: 4 }}>
          From {earnings.lotsSold} {earnings.lotsSold === 1 ? "lot" : "lots"}.
        </p>
      )}
    </section>
  );
}

/* ── Supporting figures ─────────────────────────────────────── */

function Stats({ earnings }: { earnings: Earnings }) {
  const cells: Array<[string, string]> = [
    ["Lots sold", String(earnings.lotsSold)],
    ["Sell-through", earnings.lotsOffered > 0 ? `${Math.round(earnings.sellThrough * 100)}%` : "—"],
    ["Average", earnings.lotsSold > 0 ? gbp(Math.round(earnings.averagePrice)) : "—"],
  ];

  return (
    <>
      <section
        style={{
          display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
          border: "1px solid var(--line)", borderRadius: 18, overflow: "hidden", marginBottom: 14,
        }}
      >
        {cells.map(([label, value], i) => (
          <div key={label} style={{ padding: "14px 12px", borderLeft: i === 0 ? "none" : "1px solid var(--line)" }}>
            <p className="meta" style={{ margin: 0, fontSize: 10 }}>{label}</p>
            <p style={{ margin: "4px 0 0", fontSize: 19, fontWeight: 600, letterSpacing: "-.5px", fontVariantNumeric: "tabular-nums" }}>
              {value}
            </p>
          </div>
        ))}
      </section>

      {earnings.best && (
        <section
          style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: 12, borderRadius: 18, background: "#f6f6f4", marginBottom: 22,
          }}
        >
          <Thumb src={earnings.best.image_url} size={46} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="meta" style={{ display: "block", fontSize: 10 }}>Top lot</span>
            <span style={{ display: "block", fontSize: 14, fontWeight: 500, letterSpacing: "-.2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {earnings.best.name}
            </span>
          </span>
          <span style={{ textAlign: "right", flex: "0 0 auto" }}>
            <span style={{ display: "block", fontSize: 16, fontWeight: 600, fontVariantNumeric: "tabular-nums", letterSpacing: "-.4px" }}>
              {gbp(earnings.best.amount)}
            </span>
            {earnings.best.buyer && <span className="meta" style={{ textTransform: "none" }}>{earnings.best.buyer}</span>}
          </span>
        </section>
      )}
    </>
  );
}

/* ── One sale, expandable ───────────────────────────────────── */

function SaleCard({ summary, open, onToggle }: { summary: SaleSummary; open: boolean; onToggle: () => void }) {
  const { sale, lots, raised, sold, offered } = summary;

  return (
    <section style={{ border: "1px solid var(--line)", borderRadius: 18, marginBottom: 10, overflow: "hidden" }}>
      <button
        onClick={onToggle}
        aria-expanded={open}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "14px 14px", textAlign: "left" }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 15, fontWeight: 500, letterSpacing: "-.2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {sale.title}
          </span>
          <span className="meta" style={{ textTransform: "none" }}>
            {sale.code} · {when(sale.created_at)} · {sold} of {offered || lots.length} sold
          </span>
        </span>
        <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: "tabular-nums", letterSpacing: "-.3px", flex: "0 0 auto" }}>
          {gbp(raised)}
        </span>
        <span style={{ display: "grid", placeItems: "center", color: "var(--ink-3)", transform: open ? "rotate(90deg)" : "none", transition: "transform .18s ease" }}>
          <Chevron size={16} />
        </span>
      </button>

      {open && (
        <div className="fade-in" style={{ padding: "0 14px 6px" }}>
          {lots.length === 0 ? (
            <p className="sub" style={{ padding: "0 0 12px" }}>No lots in this sale.</p>
          ) : (
            lots.map((lot) => <LotRow key={lot.id} lot={lot} />)
          )}
        </div>
      )}
    </section>
  );
}

function LotRow({ lot }: { lot: Lot }) {
  const sold = lot.status === "sold" && Number(lot.sold_for) > 0;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: "1px solid var(--line)" }}>
      <Thumb src={lot.image_url} size={42} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: 500, letterSpacing: "-.2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {lot.name}
        </span>
        <span className="meta" style={{ textTransform: "none" }}>
          {sold ? `Bought by ${lot.sold_to}` : lot.status === "unsold" ? "Unsold" : lot.status === "live" ? "On the block" : "Waiting"}
        </span>
      </span>
      <span style={{ textAlign: "right", flex: "0 0 auto" }}>
        <span
          style={{
            display: "block", fontSize: 14, fontVariantNumeric: "tabular-nums",
            color: sold ? "var(--ink)" : "var(--ink-3)", fontWeight: sold ? 600 : 400,
          }}
        >
          {sold ? gbp(Number(lot.sold_for)) : "—"}
        </span>
        {Number(lot.low) > 0 && (
          <span className="meta" style={{ textTransform: "none" }}>
            est {gbp(Number(lot.low))}–{gbp(Number(lot.high))}
          </span>
        )}
      </span>
    </div>
  );
}

/* ── Bits ───────────────────────────────────────────────────── */

function Thumb({ src, size }: { src: string; size: number }) {
  return (
    <span
      style={{
        width: size, height: size, borderRadius: 11, background: "#f2f2f0",
        overflow: "hidden", flex: "0 0 auto", display: "grid", placeItems: "center",
      }}
    >
      {src ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
      ) : null}
    </span>
  );
}

function EmptyState({ onScan }: { onScan: () => void }) {
  return (
    <div className="fade-in" style={{ display: "grid", placeItems: "center", textAlign: "center", padding: "56px 12px" }}>
      <p className="title">No sales yet</p>
      <p className="sub" style={{ marginTop: 8, maxWidth: 260 }}>
        Scan a room, pick what you want gone, and whatever the auctioneer sells will show up here.
      </p>
      <button className="pill pill--quiet" style={{ marginTop: 18 }} onClick={onScan}>
        <Scan size={17} /> Scan a room
      </button>
    </div>
  );
}

/** "Today, 14:32" for a sale you just ran, a plain date for older ones. */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const sameDay =
    d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
  return sameDay
    ? `Today, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
