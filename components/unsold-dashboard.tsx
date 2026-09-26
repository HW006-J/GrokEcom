/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { gbp, type Lot } from "@/lib/types";
import { askingPrice, canList, similarFor, type MockListing, type SimilarItem } from "@/lib/mock-marketplaces";

type Platform = "ebay" | "marketplace";
type Listing = MockListing;
const platforms: Platform[] = ["ebay", "marketplace"];
const label = (platform: Platform) => platform === "ebay" ? "eBay" : "Marketplace";
const keyFor = (lotId: string, platform: Platform) => `${lotId}:${platform}`;
const agentUrl = (platform: Platform, jobId: string) => `/mock-marketplace/${platform}/agent?job=${jobId}`;
type BrowserJob = { id: string; steps: string[]; step: number; screenshot: string | null; done: boolean; listing?: Listing; error?: string };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const pill = (primary: boolean): CSSProperties => ({
  flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44, borderRadius: "var(--r-pill)",
  padding: "0 14px", fontSize: 13, fontWeight: 600, textDecoration: "none",
  background: primary ? "var(--accent)" : "var(--surface)", color: primary ? "var(--accent-ink)" : "var(--ink)", border: primary ? 0 : "1px solid var(--line-2)",
});

export function UnsoldDashboard({ lots }: { lots: Lot[] }) {
  const [listings, setListings] = useState<Record<string, Listing>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [jobs, setJobs] = useState<Record<string, BrowserJob>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const inFlight = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const unsold = lots.filter(canList);
  const passedIn = unsold.filter((lot) => lot.status === "unsold").length;
  const notAuctioned = unsold.length - passedIn;

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
      // A headless browser fills the demo sell form; fall back to an instant publish.
      const started = await fetch("/api/mock-listings/browser", { method: "POST", headers, body });
      const start = await started.json().catch(() => ({}));
      if (started.ok && start.jobId) {
        setJobs((previous) => ({ ...previous, [key]: { id: start.jobId, steps: [], step: 0, screenshot: null, done: false } }));
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
      if (!start.unavailable) throw new Error(start.error || "Could not start the browser agent.");
      setNotes((previous) => ({ ...previous, [key]: "Browser agent isn't installed on this server, so this was published instantly." }));
      const response = await fetch("/api/mock-listings", { method: "POST", headers, body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not submit this item.");
      setListings((previous) => ({ ...previous, [key]: result.listing }));
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
      <p className="sub" style={{ margin: "7px 0 16px", fontSize: 13 }}>{[passedIn && `${passedIn} unsold at auction`, notAuctioned && `${notAuctioned} not auctioned`].filter(Boolean).join(" · ")} · Watch a browser agent list them on demo marketplaces. Nothing is posted to real ones.</p>
      {loadError && <p role="alert" style={{ fontSize: 13 }}>Saved demo listings could not load. <button style={{ textDecoration: "underline" }} onClick={() => { setLoading(true); setRevision((value) => value + 1); }}>Retry</button></p>}
      {unsold.map((lot) => (
        <article key={lot.id} style={{ border: "1px solid var(--line)", borderRadius: 22, padding: 16, marginBottom: 12, background: "#fff" }}>
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            {lot.image_url && <img src={lot.image_url} alt={lot.name} style={{ width: 72, height: 80, objectFit: "contain", flexShrink: 0 }} />}
            <div style={{ minWidth: 0 }}><span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-3)", letterSpacing: ".04em" }}>{lot.status === "unsold" ? "UNSOLD AT AUCTION" : "NOT AUCTIONED"}</span><h3 style={{ margin: "2px 0 0", fontSize: 17, fontWeight: 600, overflowWrap: "anywhere" }}>{lot.name}</h3><p className="sub" style={{ margin: "5px 0 0", fontSize: 13 }}>{Number(lot.reserve) || Number(lot.low) ? `${gbp(askingPrice(lot))} asking price` : "Pricing… lists at £5 until then"}</p></div>
          </div>
          <div style={{ display: "flex", gap: 12, borderTop: "1px solid var(--line)", paddingTop: 14, marginTop: 10 }}>
            {platforms.map((platform) => {
              const key = keyFor(lot.id, platform);
              const listing = listings[key];
              const job = jobs[key];
              const busy = !!pending[key];
              const caption = busy ? (job?.steps.length ? `Listing… ${Math.min(job.step + 1, job.steps.length)}/${job.steps.length}` : "Listing…") : listing ? "View listing ↗" : errors[key] ? "Retry" : "List item";
              const tile = <><span style={{ display: "grid", placeItems: "center", width: 64, height: 48, border: "1px solid var(--line)", borderRadius: 15, background: "#fff" }}><MarketplaceLogo platform={platform} /></span><span style={{ fontSize: 11, color: "var(--ink-2)", marginTop: 6 }}>{caption}</span></>;
              const style = { display: "flex", flexDirection: "column" as const, alignItems: "center", textDecoration: "none", color: "var(--ink)", background: "transparent", padding: "0 4px", minWidth: 76, opacity: loading || busy ? .55 : 1 };
              return listing ? <Link key={platform} href={listing.mockUrl} aria-label={`View demo ${label(platform)} listing for ${lot.name}`} style={style}>{tile}</Link> : <button key={platform} disabled={loading || busy} onClick={() => submit(lot.id, platform)} aria-label={`${errors[key] ? "Retry listing" : "List"} ${lot.name} on demo ${label(platform)}`} style={style}>{tile}</button>;
            })}
          </div>
          {platforms.map((platform) => {
            const key = keyFor(lot.id, platform);
            const listing = listings[key];
            const job = jobs[key];
            const running = !!job && !job.done;
            const replay = listing?.jobId ?? (job?.done ? job.id : null);
            return <div key={platform}>
              {running && <AgentRunning job={job} platform={platform} />}
              {!running && replay && <Link href={agentUrl(platform, replay)} style={{ display: "inline-block", fontSize: 12, color: "var(--ink-2)", textDecoration: "underline", padding: "10px 0 0" }}>{job?.error ? `See where the ${label(platform)} agent stopped` : `Watch the ${label(platform)} agent replay`}</Link>}
              {notes[key] && <p style={{ fontSize: 12, color: "var(--ink-2)", margin: "8px 0 0" }}>{notes[key]}</p>}
              {errors[key] && <p role="alert" style={{ fontSize: 12, color: "#a32727", margin: "8px 0 0" }}>{errors[key]}</p>}
            </div>;
          })}
          <Similar lot={lot} listings={listings} />
        </article>
      ))}
    </section>
  );
}

function AgentRunning({ job, platform }: { job: BrowserJob; platform: Platform }) {
  return <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
    <div style={{ width: 44, aspectRatio: "420 / 600", flexShrink: 0, borderRadius: 10, overflow: "hidden", border: "1px solid var(--line)", background: "var(--paper)" }}>
      {job.screenshot && <img src={job.screenshot} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />}
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <p role="status" style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Agent is listing on demo {label(platform)}</p>
      <p className="sub" style={{ margin: "2px 0 0", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{job.steps.length ? `${Math.min(job.step + 1, job.steps.length)}/${job.steps.length} · ${job.steps[job.step] ?? "Finishing"}` : "Launching Chromium…"}</p>
    </div>
    <Link href={agentUrl(platform, job.id)} style={{ ...pill(false), flex: "none" }}>Watch <span aria-hidden="true">→</span></Link>
  </div>;
}

/** One quiet line of real items: the closest listing each marketplace has, or a real search. */
function Similar({ lot, listings }: { lot: Lot; listings: Record<string, Listing> }) {
  const picks = platforms.map((platform) => {
    const saved = listings[keyFor(lot.id, platform)]?.similar;
    const items: SimilarItem[] = saved?.length ? saved : similarFor(lot, platform);
    return { platform, item: items.find((i) => !i.search) ?? items[items.length - 1] };
  }).filter((p) => p.item);
  if (!picks.length) return null;
  return <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--ink-2)", display: "flex", flexWrap: "wrap", gap: "0 6px" }}>
    <span>Similar:</span>
    {picks.map(({ platform, item }, i) => <span key={platform}>{i ? "· " : ""}<a href={item!.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--ink)" }}>{label(platform)}{item!.price ? ` ${gbp(item!.price)}` : ""} ↗</a></span>)}
  </p>;
}

function MarketplaceLogo({ platform }: { platform: Platform }) {
  if (platform === "ebay") return <span aria-hidden="true" style={{ fontFamily: "Arial, sans-serif", fontWeight: 500, fontSize: 27, letterSpacing: "-2px", lineHeight: 1, paddingRight: 2 }}><span style={{ color: "#e53238" }}>e</span><span style={{ color: "#0064d2" }}>b</span><span style={{ color: "#f5af02" }}>a</span><span style={{ color: "#86b817" }}>y</span></span>;
  return <svg aria-hidden="true" width="29" height="29" viewBox="0 0 32 32" fill="none"><path d="M6 6h20l3 8H3l3-8Z" fill="#1877f2"/><path d="M4 14v3a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0v-3" fill="#1877f2"/><path d="M6 21v7h20v-7M12 28v-7h8v7" stroke="#1877f2" strokeWidth="2.5" strokeLinejoin="round"/><path d="M11 7 9 14m7-7v7m5-7 2 7" stroke="white" strokeWidth="1.5"/></svg>;
}
