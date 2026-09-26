/* eslint-disable @next/next/no-img-element */
"use client";

import { use, useState, type FormEvent } from "react";
import Link from "next/link";
import styles from "../marketplace.module.css";
import { CONDITIONS } from "@/lib/mock-marketplaces";

// Demo sell form. The browser agent (lib/browser-lister.ts) fills it in; a
// person can too. Submitting creates a mock listing, never a real one.

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
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [condition, setCondition] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
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
    const lotId = new URLSearchParams(location.search).get("lot");
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
          via: navigator.webdriver ? "browser" : undefined,
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

  return <main className={styles.workspace} data-market={platform}>
    <header className={styles.header}><Link href="/dashboard" className={ebay ? styles.ebay : styles.facebook}>{ebay ? "ebay" : "f"}</Link><span className={styles.search}>Search {ebay ? "eBay" : "Facebook"}</span><strong className={styles.headerTitle}>Marketplace</strong><span className={styles.demo}>Demo · local only</span></header>
    <div className={styles.editor}>
    <form onSubmit={submit} className={styles.form}>
      <Link href="/dashboard" className={styles.back} aria-label="Back to dashboard"><svg width="12" height="22" viewBox="0 0 12 22" fill="none" aria-hidden="true"><path d="M10 2 2 11l8 9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg><span>Dashboard</span></Link>
      <h1>{ebay ? "Create your listing" : "Item for sale"}</h1>
      <div className={styles.seller}><span className={styles.avatar}>S</span><div><strong>Your listing</strong><small>Marketplace · Public preview</small></div></div>
      <PhotoPicker preview={preview} onPick={pick} />
      <label className={styles.field} htmlFor="title"><span>Title</span><input id="title" name="title" required maxLength={120} value={title} onChange={e => setTitle(e.target.value)} placeholder="What are you selling?" /></label>
      <label className={styles.field} htmlFor="price"><span>Price (£)</span><input id="price" name="price" required type="number" inputMode="numeric" min={1} max={100000} step={1} value={price} onChange={e => setPrice(e.target.value)} placeholder="0" /></label>
      <label className={styles.field} htmlFor="condition"><span>Condition</span><select aria-label="Condition" id="condition" name="condition" required value={condition} onChange={e => setCondition(e.target.value)}><option value="" disabled>Select condition</option>{CONDITIONS.map(c => <option key={c}>{c}</option>)}</select></label>
      <p className={styles.notice}>Only published to this demo marketplace.</p>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <button className={styles.publish} type="submit" disabled={busy}>{busy ? "Publishing…" : ebay ? "Publish listing" : "Publish"}</button>
    </form>
    <section className={styles.previewArea} aria-label="Listing preview"><h2>Preview</h2><div className={styles.previewCard}><div className={styles.previewImage}>{preview ? <img src={preview} alt="Item preview" /> : <div className={styles.empty}><span>▧</span>Your listing preview<small>Add a photo to bring it to life.</small></div>}</div><div className={styles.previewDetails}><h2>{title || "Your item title"}</h2><p className={styles.price}>{price ? `£${price}` : "£0"}</p><p className={styles.muted}>Listed just now · London</p><hr /><h3>Details</h3><p>Condition <strong>{condition || "Not specified"}</strong></p><p className={styles.muted}>Your item is ready for a new home.</p><div className={styles.map}>London<span>⌖</span><small>Approximate location</small></div><h3>Seller information</h3><div className={styles.seller}><span className={styles.avatar}>S</span><strong>You</strong></div></div></div></section>
    </div>
  </main>;
}

function PhotoPicker({ preview, onPick }: { preview: string; onPick: (file: File | null) => void }) {
  return <div className={styles.photoSection}><p>Photos <span>· {preview ? "1" : "0"}/10</span></p><label className={styles.photoPicker}>{preview ? <img src={preview} alt="Attached item photo" /> : <span className={styles.photoIcon}>＋</span>}<strong>Add photo</strong><small>Upload from your device</small><input aria-label="Add photo" type="file" accept="image/*" onChange={event => onPick(event.target.files?.[0] ?? null)} /></label></div>;
}
