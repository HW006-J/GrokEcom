/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useRef, useState } from "react";
import { gbp, type Lot } from "@/lib/types";

type Platform = "ebay" | "marketplace";
type Listing = { id: string; lotId: string; platform: Platform; title: string; price: number; imageUrl: string; status: "published"; steps: string[]; mockUrl: string; demo: true };
const platforms: Platform[] = ["ebay", "marketplace"];
const label = (platform: Platform) => platform === "ebay" ? "eBay" : "Marketplace";
const keyFor = (lotId: string, platform: Platform) => `${lotId}:${platform}`;
type BrowserJob = { id: string; steps: string[]; step: number; screenshot: string | null; url: string; done: boolean; listing?: Listing; error?: string };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function UnsoldDashboard({ lots }: { lots: Lot[] }) {
  const [listings, setListings] = useState<Record<string, Listing>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [jobs, setJobs] = useState<Record<string, BrowserJob>>({});
  const inFlight = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const unsold = lots.filter((lot) => lot.status === "unsold");

  useEffect(() => {
    let alive = true;
    fetch("/api/mock-listings", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load listings");
        return response.json() as Promise<{ listings: Listing[] }>;
      })
      .then(({ listings: saved }) => {
        if (!alive) return;
        setListings(Object.fromEntries(saved.map((listing) => [keyFor(listing.lotId, listing.platform), listing])));
        setLoadError(false);
      })
      .catch(() => { if (alive) setLoadError(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [revision]);

  async function submit(lotId: string, platform: Platform) {
    const key = keyFor(lotId, platform);
    if (inFlight.current.has(key) || listings[key]) return;
    inFlight.current.add(key);
    setPending((previous) => ({ ...previous, [key]: true }));
    setErrors((previous) => ({ ...previous, [key]: "" }));
    try {
      const body = JSON.stringify({ lotId, platform });
      const headers = { "Content-Type": "application/json" };
      // A listing is successful only after the browser submits the demo form.
      const started = await fetch("/api/mock-listings/browser", { method: "POST", headers, body });
      const start = await started.json().catch(() => ({}));
      if (started.ok && start.jobId) {
        while (mounted.current) {
          await sleep(500);
          const polled = await fetch(`/api/mock-listings/browser?id=${start.jobId}`, { cache: "no-store" });
          const job = await polled.json();
          if (!polled.ok) throw new Error(job.error || "Lost track of the browser agent.");
          if (mounted.current) setJobs((previous) => ({ ...previous, [key]: job }));
          if (!job.done) continue;
          if (job.error || !job.listing) throw new Error(`The browser agent stopped: ${job.error || "no listing was created."}`);
          setListings((previous) => ({ ...previous, [key]: job.listing }));
          break;
        }
        return;
      }
      throw new Error(start.unavailable ? "Browser agent unavailable. Try again shortly." : start.error || "Could not start the browser agent.");
    } catch (error) {
      setErrors((previous) => ({ ...previous, [key]: error instanceof Error ? error.message : "Could not submit this item." }));
    } finally {
      inFlight.current.delete(key);
      setPending((previous) => ({ ...previous, [key]: false }));
    }
  }

  if (!unsold.length) return null;
  return (
    <section aria-labelledby="unsold-heading" style={{ margin: "24px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h2 id="unsold-heading" style={{ margin: 0, fontSize: 24, fontWeight: 750, letterSpacing: "-.7px" }}>A second chance</h2>
        <span style={{ border: "1px solid var(--line)", borderRadius: 99, padding: "5px 10px", fontSize: 11, fontWeight: 600 }}>DEMO</span>
      </div>
      <p className="sub" style={{ margin: "7px 0 16px", fontSize: 13 }}>{unsold.length} unsold · Demo marketplaces only.</p>
      {loadError && <p role="alert" style={{ fontSize: 13 }}>Saved demo listings could not load. <button style={{ textDecoration: "underline" }} onClick={() => { setLoading(true); setRevision((value) => value + 1); }}>Retry</button></p>}
      {unsold.map((lot) => (
        <article key={lot.id} style={{ border: "1px solid var(--line)", borderRadius: 22, padding: 16, marginBottom: 12, background: "#fff" }}>
          <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 16 }}>
            {lot.image_url && <img src={lot.image_url} alt={lot.name} style={{ width: 72, height: 80, objectFit: "contain", flexShrink: 0 }} />}
            <div style={{ minWidth: 0 }}><h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, overflowWrap: "anywhere" }}>{lot.name}</h3><p className="sub" style={{ margin: "5px 0 0", fontSize: 13 }}>{gbp(Number(lot.reserve) || Number(lot.low) || 1)} asking price</p></div>
          </div>
          <div style={{ display: "flex", gap: 12, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
            {platforms.map((platform) => {
              const key = keyFor(lot.id, platform);
              const listing = listings[key];
              const busy = !!pending[key];
              const tile = <><span style={{ display: "grid", placeItems: "center", width: 64, height: 48, border: "1px solid var(--line)", borderRadius: 15, background: "#fff" }}><MarketplaceLogo platform={platform} /></span><span style={{ fontSize: 11, color: "var(--ink-2)", marginTop: 6 }}>{busy ? "Listing…" : listing ? "View listing ↗" : errors[key] ? "Retry" : "List item"}</span></>;
              const style = { display: "flex", flexDirection: "column" as const, alignItems: "center", textDecoration: "none", color: "var(--ink)", background: "transparent", padding: "0 4px", minWidth: 76, opacity: loading || busy ? .55 : 1 };
              return listing ? <a key={platform} href={listing.mockUrl} aria-label={`View demo ${label(platform)} listing for ${lot.name}`} style={style}>{tile}</a> : <button key={platform} disabled={loading || busy} onClick={() => submit(lot.id, platform)} aria-label={`${errors[key] ? "Retry listing" : "List"} ${lot.name} on demo ${label(platform)}`} style={style}>{tile}</button>;
            })}
          </div>
          {platforms.map((platform) => {
            const key = keyFor(lot.id, platform);
            const listing = listings[key];
            return <div key={platform}>
              {jobs[key] && <details open={!jobs[key].done} style={{ marginTop: 12, fontSize: 12 }}><summary style={{ cursor: "pointer", color: "var(--ink-2)", padding: "6px 0" }}>{label(platform)} · Browser activity</summary><BrowserWindow job={jobs[key]} /></details>}
              {listing && !jobs[key] && <details style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 8 }}><summary style={{ cursor: "pointer", padding: "5px 0" }}>{label(platform)} · Saved activity</summary><ol style={{ paddingLeft: 20, lineHeight: 1.8 }}>{listing.steps.map((step, index) => <li key={index}>{step}</li>)}</ol></details>}
              {pending[key] && !jobs[key] && <p role="status" style={{ fontSize: 12, color: "var(--ink-2)", margin: "8px 0 0" }}>Opening {label(platform)}…</p>}
              {errors[key] && <p role="alert" style={{ fontSize: 12, color: "#a32727", margin: "8px 0 0" }}>{errors[key]}</p>}
            </div>;
          })}
        </article>
      ))}
    </section>
  );
}

function BrowserWindow({ job }: { job: BrowserJob }) {
  const path = job.url ? job.url.replace(/^https?:\/\/[^/]+/, "") : "about:blank";
  const status = job.error ? "Stopped" : job.done ? "Done" : job.steps[job.step] ?? "Working";
  return <div style={{ border: "1px solid var(--line)", borderRadius: "var(--r-tile)", overflow: "hidden", background: "var(--paper)", margin: "4px 0 10px" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "var(--surface)", borderBottom: "1px solid var(--line)" }}>
      <span aria-hidden="true" style={{ display: "flex", gap: 5 }}>{[0, 1, 2].map((dot) => <i key={dot} style={{ width: 8, height: 8, borderRadius: 99, background: "var(--line-2)" }} />)}</span>
      <span style={{ flex: 1, minWidth: 0, borderRadius: "var(--r-pill)", background: "var(--paper)", padding: "5px 10px", fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{path}</span>
      <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-3)" }}>CHROMIUM</span>
    </div>
    <div style={{ position: "relative", aspectRatio: "1100 / 800", background: "var(--surface)", display: "grid", placeItems: "center" }}>
      {job.screenshot ? <img src={job.screenshot} alt={`Browser agent: ${status}`} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} /> : <span className="sub" style={{ fontSize: 12 }}>Launching Chromium…</span>}
    </div>
    <ol aria-live="polite" style={{ listStyle: "none", margin: 0, padding: "10px 14px", fontSize: 12, lineHeight: 1.9, borderTop: "1px solid var(--line)", background: "var(--surface)" }}>
      {job.steps.map((step, index) => {
        const state = index < job.step ? "done" : index === job.step && !job.done ? "active" : job.error && index === job.step ? "failed" : "todo";
        return <li key={step} style={{ display: "flex", gap: 8, color: state === "todo" ? "var(--ink-3)" : "var(--ink)", fontWeight: state === "active" ? 650 : 400 }}>
          <span aria-hidden="true" style={{ width: 14, textAlign: "center" }}>{state === "done" ? "✓" : state === "active" ? "›" : state === "failed" ? "×" : "·"}</span>{step}
        </li>;
      })}
    </ol>
  </div>;
}

function MarketplaceLogo({ platform }: { platform: Platform }) {
  if (platform === "ebay") return <span aria-hidden="true" style={{ fontFamily: "Arial, sans-serif", fontWeight: 500, fontSize: 27, letterSpacing: "-2px", lineHeight: 1, paddingRight: 2 }}><span style={{ color: "#e53238" }}>e</span><span style={{ color: "#0064d2" }}>b</span><span style={{ color: "#f5af02" }}>a</span><span style={{ color: "#86b817" }}>y</span></span>;
  return <svg aria-hidden="true" width="29" height="29" viewBox="0 0 32 32" fill="none"><path d="M6 6h20l3 8H3l3-8Z" fill="#1877f2"/><path d="M4 14v3a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0v-3" fill="#1877f2"/><path d="M6 21v7h20v-7M12 28v-7h8v7" stroke="#1877f2" strokeWidth="2.5" strokeLinejoin="round"/><path d="M11 7 9 14m7-7v7m5-7 2 7" stroke="white" strokeWidth="1.5"/></svg>;
}
