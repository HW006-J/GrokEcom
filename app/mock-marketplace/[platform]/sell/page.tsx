/* eslint-disable @next/next/no-img-element */
"use client";

import { use, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { CONDITIONS } from "@/lib/mock-marketplaces";
import { DemoPill, EBAY, EbayHeader, FB, Icon, ICONS } from "../../platform-ui";

// Demo sell form, styled after eBay's "Complete your listing" and Facebook's
// "Item for sale" forms. The browser agent (lib/browser-lister.ts) fills it
// in; a person can too. Submitting creates a mock listing, never a real one.
// The agent finds fields by label and the submit button by #publish.

/** Shrinks big cutouts so the in-memory listing stays small; keeps transparency. */
function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, 800 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(image.src);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => reject(new Error("That photo could not be read."));
    image.src = URL.createObjectURL(file);
  });
}

export default function MockSellForm({ params }: { params: Promise<{ platform: string }> }) {
  const { platform } = use(params);
  const ebay = platform === "ebay";
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [titleLength, setTitleLength] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!["ebay", "marketplace"].includes(platform)) return <main className="shell" style={{ padding: 24 }}>Unknown demo marketplace. <Link href="/dashboard">Back to dashboard</Link></main>;

  function pick(file: File | null) {
    if (preview) URL.revokeObjectURL(preview);
    setPhoto(file);
    setPreview(file ? URL.createObjectURL(file) : "");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const search = new URLSearchParams(location.search);
    const lotId = search.get("lot");
    if (!lotId) { setError("Open this form from your dashboard so it knows which item to list."); return; }
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/mock-listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lotId, platform,
          title: String(data.get("title") || ""),
          condition: String(data.get("condition") || ""),
          price: Number(data.get("price")) || undefined,
          imageDataUrl: photo ? await toDataUrl(photo) : undefined,
          jobId: search.get("job") || undefined,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not publish.");
      location.assign(result.listing.mockUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not publish.");
      setBusy(false);
    }
  }

  const photoInput = <input type="file" accept="image/*" onChange={(event) => pick(event.target.files?.[0] ?? null)} style={{ position: "absolute", width: 1, height: 1, opacity: 0 }} />;
  const errorLine = error && <p role="alert" style={{ fontSize: 14, color: "#e0103a", margin: "16px 0 0" }}>{error}</p>;

  if (ebay) return <main className="shell" style={{ background: "#fff", fontFamily: EBAY.font, color: EBAY.ink }}>
    <EbayHeader />
    <form onSubmit={submit} style={{ overflowY: "auto", flex: 1, padding: "0 16px 32px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: "18px 0 4px" }}>Complete your listing</h1>
      <p style={{ fontSize: 14, color: EBAY.ink2, margin: 0 }}>It&apos;s free to sell on eBay. Demo form: nothing is posted.</p>

      <EbaySection title="Photos & video">
        <p style={{ fontSize: 13, color: EBAY.ink2, margin: "0 0 10px" }}>You can add up to 24 photos.</p>
        <label style={{ position: "relative", display: "grid", placeItems: "center", minHeight: 150, border: `2px dashed ${EBAY.fieldLine}`, borderRadius: 16, background: EBAY.grey, cursor: "pointer", overflow: "hidden" }}>
          {preview ? <img src={preview} alt="Attached item photo" style={{ height: 150, maxWidth: "100%", objectFit: "contain", mixBlendMode: "multiply" }} />
            : <span style={{ display: "grid", justifyItems: "center", gap: 6 }}><Icon d={ICONS.camera} size={30} /><span style={{ fontSize: 15, fontWeight: 700, color: EBAY.blue }}>Add photos</span><span style={{ fontSize: 12, color: EBAY.ink2 }}>or drag and drop</span></span>}
          {photoInput}
        </label>
      </EbaySection>

      <EbaySection title="Title">
        <label htmlFor="title" style={ebayLabel}>Item title</label>
        <input id="title" name="title" required maxLength={80} onInput={(event) => setTitleLength(event.currentTarget.value.length)} style={ebayField} />
        <span style={{ display: "block", textAlign: "right", fontSize: 12, color: EBAY.ink2, marginTop: 4 }}>{titleLength}/80</span>
      </EbaySection>

      <EbaySection title="Condition">
        <label htmlFor="condition" style={ebayLabel}>Item condition</label>
        <select id="condition" name="condition" required defaultValue="" style={{ ...ebayField, appearance: "auto" }}>
          <option value="" disabled>Select</option>
          {CONDITIONS.map((condition) => <option key={condition}>{condition}</option>)}
        </select>
      </EbaySection>

      <EbaySection title="Pricing">
        <span style={ebayLabel}>Format</span>
        <div style={{ display: "flex", border: `1px solid ${EBAY.fieldLine}`, borderRadius: 24, overflow: "hidden", marginBottom: 14 }}>
          <span style={{ flex: 1, textAlign: "center", padding: "10px 0", fontSize: 14 }}>Auction</span>
          <span style={{ flex: 1, textAlign: "center", padding: "10px 0", fontSize: 14, fontWeight: 700, background: EBAY.ink, color: "#fff", borderRadius: 24 }}>Buy it now</span>
        </div>
        <label htmlFor="price" style={ebayLabel}>Item price</label>
        <div style={{ ...ebayField, display: "flex", alignItems: "center", gap: 6, padding: "0 12px" }}>
          <span style={{ color: EBAY.ink2 }}>£</span>
          <input id="price" name="price" required type="number" inputMode="numeric" min={1} max={100000} step={1} style={{ flex: 1, minWidth: 0, border: 0, background: "transparent", font: "inherit", fontSize: 16, height: "100%", outline: "none" }} />
        </div>
      </EbaySection>

      <EbaySection title="Delivery">
        <p style={{ fontSize: 14, margin: 0 }}>Collection in person</p>
        <p style={{ fontSize: 12, color: EBAY.ink2, margin: "4px 0 0" }}>Buyers collect from your postcode area.</p>
      </EbaySection>

      {errorLine}
      <button id="publish" type="submit" disabled={busy} style={{ width: "100%", minHeight: 48, marginTop: 24, borderRadius: 24, background: EBAY.blue, color: "#fff", fontSize: 16, fontWeight: 700, fontFamily: EBAY.font, opacity: busy ? .6 : 1 }}>{busy ? "Listing…" : "List it"}</button>
      <button type="button" style={{ width: "100%", minHeight: 48, marginTop: 10, borderRadius: 24, border: `1px solid ${EBAY.blue}`, color: EBAY.blue, background: "#fff", fontSize: 16, fontFamily: EBAY.font }}>Save for later</button>
      <p style={{ fontSize: 12, color: EBAY.ink2, textAlign: "center", margin: "14px 0 0" }}>Demo of eBay&apos;s listing form for The Sellout. Not affiliated with eBay.</p>
    </form>
  </main>;

  return <main className="shell" style={{ background: "#fff", fontFamily: FB.font, color: FB.ink }}>
    <header style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 8px 8px 4px", borderBottom: `1px solid ${FB.button}` }}>
      <Link href="/dashboard" aria-label="Close" style={{ width: 44, height: 44, display: "grid", placeItems: "center", color: FB.ink }}><Icon d={ICONS.close} size={22} /></Link>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, color: FB.ink2 }}>Marketplace</div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Item for sale</h1>
      </div>
      <DemoPill />
    </header>
    <form onSubmit={submit} style={{ overflowY: "auto", flex: 1, padding: "12px 16px 28px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 40, height: 40, borderRadius: 99, background: FB.button }} />
        <div><div style={{ fontSize: 15, fontWeight: 600 }}>You</div><div style={{ fontSize: 13, color: FB.ink2 }}>Listing to Marketplace · Public</div></div>
      </div>
      <p style={{ fontSize: 15, color: FB.ink2, margin: "16px 0 8px" }}>Photos · {photo ? 1 : 0} / 10 · You can add up to 10 photos.</p>
      <label style={{ position: "relative", display: "grid", placeItems: "center", minHeight: 170, borderRadius: 8, border: `1px solid ${FB.line}`, background: "#fff", cursor: "pointer", overflow: "hidden" }}>
        {preview ? <img src={preview} alt="Attached item photo" style={{ height: 170, maxWidth: "100%", objectFit: "contain", mixBlendMode: "multiply" }} />
          : <span style={{ display: "grid", justifyItems: "center", gap: 4 }}>
            <span style={{ width: 40, height: 40, borderRadius: 99, background: FB.button, display: "grid", placeItems: "center" }}><Icon d={ICONS.photo} size={20} /></span>
            <span style={{ fontSize: 17, fontWeight: 600 }}>Add photos</span><span style={{ fontSize: 13, color: FB.ink2 }}>or drag and drop</span>
          </span>}
        {photoInput}
      </label>

      <h2 style={{ fontSize: 17, fontWeight: 600, margin: "20px 0 0" }}>Required</h2>
      <p style={{ fontSize: 15, color: FB.ink2, margin: "2px 0 12px" }}>Be as descriptive as possible.</p>
      <FbField id="title" label="Title"><input id="title" name="title" required maxLength={100} style={fbInput} /></FbField>
      <FbField id="price" label="Price"><input id="price" name="price" required type="number" inputMode="numeric" min={1} max={100000} step={1} style={fbInput} /></FbField>
      <FbField id="condition" label="Condition">
        <select id="condition" name="condition" required defaultValue="" style={{ ...fbInput, appearance: "auto", marginLeft: -4 }}>
          <option value="" disabled></option>
          {CONDITIONS.map((condition) => <option key={condition}>{condition}</option>)}
        </select>
      </FbField>
      <FbField id="description" label="Description (optional)"><textarea id="description" name="description" rows={3} style={{ ...fbInput, resize: "none" }} /></FbField>

      {errorLine}
      <button id="publish" type="submit" disabled={busy} style={{ width: "100%", minHeight: 44, marginTop: 16, borderRadius: 6, background: FB.blue, color: "#fff", fontSize: 15, fontWeight: 600, fontFamily: FB.font, opacity: busy ? .6 : 1 }}>{busy ? "Publishing…" : "Publish"}</button>
      <p style={{ fontSize: 12, color: FB.ink2, textAlign: "center", margin: "14px 0 0" }}>Demo of Marketplace&apos;s listing form for The Sellout. Not affiliated with Meta.</p>
    </form>
  </main>;
}

const ebayLabel: CSSProperties = { display: "block", fontSize: 14, fontWeight: 700, margin: "0 0 6px" };
const ebayField: CSSProperties = { width: "100%", height: 48, border: `1px solid ${EBAY.fieldLine}`, borderRadius: 8, padding: "0 12px", fontSize: 16, background: EBAY.field, color: EBAY.ink, fontFamily: EBAY.font };
const fbInput: CSSProperties = { display: "block", width: "100%", border: 0, background: "transparent", fontSize: 16, color: FB.ink, fontFamily: FB.font, outline: "none", padding: 0 };

function EbaySection({ title, children }: { title: string; children: ReactNode }) {
  return <section style={{ borderTop: `1px solid ${EBAY.line}`, marginTop: 20, paddingTop: 18 }}>
    <h2 style={{ fontSize: 16, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".02em", margin: "0 0 12px" }}>{title}</h2>
    {children}
  </section>;
}

function FbField({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return <div style={{ border: `1px solid ${FB.line}`, borderRadius: 6, padding: "8px 12px 10px", marginBottom: 12, minHeight: 56 }}>
    <label htmlFor={id} style={{ display: "block", fontSize: 12, color: FB.ink2, marginBottom: 2 }}>{label}</label>
    {children}
  </div>;
}
