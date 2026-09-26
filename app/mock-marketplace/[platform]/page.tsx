/* eslint-disable @next/next/no-img-element */
"use client";

import { use, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import type { MockListing } from "@/lib/mock-marketplaces";
import { EBAY, EbayHeader, FB, FbHeader, Icon, ICONS, SimilarLinks } from "../platform-ui";

// The published demo listing, styled after an ebay.co.uk item page or a
// Facebook Marketplace item page. Buttons are inert; "Similar" links go to
// real listings or a real search on the actual site.

const gbp2 = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

export default function MockMarketplace({ params }: { params: Promise<{ platform: string }> }) {
  const { platform } = use(params);
  const [listing, setListing] = useState<MockListing | null>(null);
  const [status, setStatus] = useState("Loading listing…");
  const [toast, setToast] = useState("");

  useEffect(() => {
    let alive = true;
    const id = new URLSearchParams(location.search).get("listing");
    fetch("/api/mock-listings", { cache: "no-store" }).then((r) => { if (!r.ok) throw Error(); return r.json(); }).then((data) => {
      if (!alive) return;
      const match = data.listings.find((l: MockListing) => l.id === id && l.platform === platform);
      setListing(match ?? null);
      setStatus(match ? "" : "Demo listing not found. It may have expired after a server restart.");
    }).catch(() => { if (alive) setStatus("Could not load this demo listing. Refresh to retry."); });
    return () => { alive = false; };
  }, [platform]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 2200);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!["ebay", "marketplace"].includes(platform)) return <main className="shell" style={{ padding: 24 }}>Unknown demo marketplace. <Link href="/dashboard">Back to dashboard</Link></main>;
  const inert = () => setToast("Demo listing: nothing to buy or message here.");
  const agentLink = listing?.jobId && <Link href={`/mock-marketplace/${platform}/agent?job=${listing.jobId}`} style={{ textDecoration: "underline" }}>Watch how the agent listed it</Link>;
  const toastBox = toast && <div role="status" style={{ position: "fixed", left: 16, right: 16, bottom: "calc(16px + env(safe-area-inset-bottom))", maxWidth: 440, margin: "0 auto", background: "#191919", color: "#fff", borderRadius: 12, padding: "12px 16px", fontSize: 14, zIndex: 5 }}>{toast}</div>;

  if (platform === "ebay") return <main className="shell" style={{ background: "#fff", fontFamily: EBAY.font, color: EBAY.ink }}>
    <EbayHeader />
    <div style={{ overflowY: "auto", flex: 1, padding: "0 16px 32px" }}>
      {!listing ? <p role="status" style={{ padding: "24px 0" }}>{status}</p> : <>
        <p style={{ fontSize: 12, color: EBAY.ink2, margin: "12px 0" }}><Link href="/dashboard" style={{ color: EBAY.ink2, textDecoration: "underline" }}>Your dashboard</Link> › Home, Furniture &amp; DIY › Demo listing</p>
        <div style={{ position: "relative", background: EBAY.grey, borderRadius: 16, height: 300, display: "grid", placeItems: "center", overflow: "hidden" }}>
          {listing.imageUrl && <img src={listing.imageUrl} alt={listing.title} style={{ maxWidth: "88%", maxHeight: 270, objectFit: "contain", mixBlendMode: "multiply" }} />}
          <span style={{ position: "absolute", top: 12, right: 12, display: "flex", alignItems: "center", gap: 4, background: "#fff", borderRadius: 99, padding: "6px 10px", fontSize: 13 }}><Icon d={ICONS.heart} size={16} /> 0</span>
        </div>
        <h1 data-listing-live style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.25, margin: "18px 0 12px" }}>{listing.title}</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0", borderTop: `1px solid ${EBAY.line}`, borderBottom: `1px solid ${EBAY.line}` }}>
          <span style={{ width: 40, height: 40, borderRadius: 99, background: EBAY.grey, border: `1px solid ${EBAY.line}` }} />
          <div style={{ flex: 1, fontSize: 14 }}><div style={{ fontWeight: 700 }}>sellout_demo (0)</div><div style={{ color: EBAY.ink2, fontSize: 13 }}>New seller · <u>Seller&apos;s other items</u></div></div>
          <button onClick={inert} style={{ minHeight: 36, padding: "0 14px", border: `1px solid ${EBAY.ink}`, borderRadius: 24, fontSize: 14 }}>Message</button>
        </div>
        <p style={{ fontSize: 24, fontWeight: 700, margin: "16px 0 2px" }}>{gbp2(listing.price)}</p>
        <p style={{ fontSize: 13, color: EBAY.ink2, margin: 0 }}>or Best Offer</p>
        <Row label="Condition:"><b>{listing.condition || "Used"}</b></Row>
        <Row label="Quantity:"><span style={{ display: "inline-block", border: `1px solid ${EBAY.fieldLine}`, borderRadius: 8, padding: "6px 14px", marginRight: 8 }}>1</span><span style={{ color: EBAY.ink2 }}>Last one</span></Row>
        <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
          <button onClick={inert} style={{ minHeight: 48, borderRadius: 24, background: EBAY.blue, color: "#fff", fontSize: 16, fontWeight: 700, fontFamily: EBAY.font }}>Buy It Now</button>
          <button onClick={inert} style={{ minHeight: 48, borderRadius: 24, border: `1px solid ${EBAY.blue}`, color: EBAY.blue, fontSize: 16, fontFamily: EBAY.font }}>Add to basket</button>
          <button onClick={inert} style={{ minHeight: 48, borderRadius: 24, border: `1px solid ${EBAY.blue}`, color: EBAY.blue, fontSize: 16, fontFamily: EBAY.font, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><Icon d={ICONS.heart} size={16} /> Add to Watchlist</button>
        </div>
        <div style={{ background: EBAY.grey, borderRadius: 12, padding: "12px 14px", fontSize: 13, marginTop: 16 }}><b>Demo listing.</b> Published by The Sellout&apos;s listing agent to this mock page. It is not on ebay.co.uk. {agentLink}</div>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: "22px 0 4px" }}>Postage, returns and payments</h2>
        <Row label="Collection:">Collection in person</Row>
        <Row label="Returns:">No returns accepted</Row>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "26px 0 10px" }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Similar items on eBay</h2>
          <a href={listing.similar?.at(-1)?.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 14, color: EBAY.ink, textDecoration: "underline" }}>See all</a>
        </div>
        <SimilarLinks items={listing.similar ?? []} look="ebay" />
      </>}
    </div>
    {toastBox}
  </main>;

  return <main className="shell" style={{ background: FB.page, fontFamily: FB.font, color: FB.ink }}>
    <FbHeader />
    <div style={{ overflowY: "auto", flex: 1, paddingBottom: 32 }}>
      {!listing ? <p role="status" style={{ padding: 24 }}>{status}</p> : <>
        <div style={{ position: "relative", height: 330, background: "#18191a", overflow: "hidden", display: "grid", placeItems: "center" }}>
          {listing.imageUrl && <>
            <img src={listing.imageUrl} alt="" aria-hidden="true" style={{ position: "absolute", inset: -40, width: "calc(100% + 80px)", height: "calc(100% + 80px)", objectFit: "cover", filter: "blur(30px) brightness(.55)" }} />
            <img src={listing.imageUrl} alt={listing.title} style={{ position: "relative", maxWidth: "100%", maxHeight: 330, objectFit: "contain" }} />
          </>}
        </div>
        <section style={{ background: FB.card, padding: "14px 16px 16px" }}>
          <h1 data-listing-live style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2, margin: 0 }}>{listing.title}</h1>
          <p style={{ fontSize: 17, fontWeight: 600, margin: "6px 0 2px" }}>£{listing.price}</p>
          <p style={{ fontSize: 13, color: FB.ink2, margin: 0 }}>Listed a moment ago in London, United Kingdom</p>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button onClick={inert} style={{ flex: 1, minHeight: 44, borderRadius: 6, background: FB.blue, color: "#fff", fontSize: 15, fontWeight: 600, fontFamily: FB.font, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><Icon d={ICONS.messenger} size={18} /> Message</button>
            <button onClick={inert} aria-label="Save" style={{ width: 44, minHeight: 44, borderRadius: 6, background: FB.button, display: "grid", placeItems: "center" }}><Icon d={ICONS.bookmark} size={18} /></button>
            <button onClick={inert} aria-label="Share" style={{ width: 44, minHeight: 44, borderRadius: 6, background: FB.button, display: "grid", placeItems: "center" }}><Icon d={ICONS.share} size={18} /></button>
          </div>
        </section>
        <section style={{ background: FB.card, padding: 16, marginTop: 8 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, margin: "0 0 10px" }}>Details</h2>
          <div style={{ display: "flex", fontSize: 15 }}><span style={{ width: 110, color: FB.ink2 }}>Condition</span><span>{listing.condition || "Used – good"}</span></div>
          <p style={{ fontSize: 15, margin: "12px 0 0" }}>Collection only. Published by The Sellout&apos;s listing agent.</p>
          <p style={{ fontSize: 13, color: FB.ink2, margin: "10px 0 0", display: "flex", alignItems: "center", gap: 4 }}><Icon d={ICONS.pin} size={14} /> London, United Kingdom · Location is approximate</p>
        </section>
        <section style={{ background: FB.card, padding: 16, marginTop: 8 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, margin: "0 0 10px" }}>Seller information</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}><span style={{ width: 40, height: 40, borderRadius: 99, background: FB.button }} /><div><div style={{ fontSize: 15, fontWeight: 600 }}>You</div><div style={{ fontSize: 13, color: FB.ink2 }}>Joined Facebook in 2026</div></div></div>
        </section>
        <section style={{ background: FB.card, padding: 16, marginTop: 8 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, margin: "0 0 10px", display: "flex", alignItems: "center", gap: 6 }}><Icon d={ICONS.messenger} size={18} color={FB.blue} /> Send seller a message</h2>
          <div style={{ background: FB.page, borderRadius: 20, padding: "10px 14px", fontSize: 15 }}>Hi, is this still available?</div>
          <button onClick={inert} style={{ width: "100%", minHeight: 44, marginTop: 10, borderRadius: 6, background: FB.blue, color: "#fff", fontSize: 15, fontWeight: 600, fontFamily: FB.font }}>Send</button>
        </section>
        <section style={{ padding: 16 }}>
          <p style={{ fontSize: 13, color: FB.ink2, margin: "0 0 16px" }}>Demo listing on a mock Marketplace page. It is not on Facebook. {agentLink}</p>
          <h2 style={{ fontSize: 17, fontWeight: 600, margin: "0 0 10px" }}>Similar on Marketplace</h2>
          <SimilarLinks items={listing.similar ?? []} look="fb" />
        </section>
      </>}
    </div>
    {toastBox}
  </main>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div style={{ display: "flex", gap: 12, fontSize: 14, marginTop: 14, alignItems: "center" }}><span style={{ width: 90, color: EBAY.ink2, flexShrink: 0 }}>{label}</span><span>{children}</span></div>;
}
