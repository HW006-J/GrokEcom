"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase";
import type { Item, ListingResponse } from "@/lib/types";
import { gbp } from "@/components/useShow";

const showId = process.env.NEXT_PUBLIC_SHOW_ID ?? "00000000-0000-0000-0000-000000000001";
const storeDomain = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;

export default function SellPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [latest, setLatest] = useState<Item | null>(null);

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  async function loadItems() {
    try {
      const sb = supabaseBrowser();
      const { data } = await sb.from("items").select("*").eq("show_id", showId).order("sort_order");
      setItems((data ?? []) as Item[]);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => { loadItems(); }, []);

  function pick(list: FileList | null) {
    if (!list) return;
    setFiles(Array.from(list).slice(0, 5));
    setLatest(null);
  }

  async function listIt() {
    if (files.length === 0) return;
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("photos", f));
      fd.append("showId", showId);
      const res = await fetch("/api/listing", { method: "POST", body: fd });
      const data = (await res.json()) as ListingResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Listing failed (${res.status})`);
      setLatest(data.item);
      setFiles([]);
      loadItems();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-lg p-4 flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold">Sell your wardrobe</h1>
        <p className="text-zinc-400 text-sm">Drop 1–5 photos of one item. The agent identifies it, prices it against the market, and lists it in Shopify.</p>
      </div>

      <label
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files); }}
        className="block rounded-2xl border-2 border-dashed border-zinc-700 bg-zinc-900 p-6 text-center cursor-pointer"
      >
        <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => pick(e.target.files)} />
        {previews.length === 0 ? (
          <div className="text-zinc-400">Tap to choose photos or drop them here</div>
        ) : (
          <div className="grid grid-cols-5 gap-2">
            {previews.map((p, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={p} alt="" className="aspect-square object-cover rounded-lg" />
            ))}
          </div>
        )}
      </label>

      <button disabled={busy || files.length === 0} onClick={listIt}
        className="rounded-xl bg-white text-black px-5 py-3 font-bold disabled:opacity-40">
        {busy ? "Listing… (vision → pricing → Shopify)" : "List it"}
      </button>
      {error && <p className="text-red-400 text-sm">{error}</p>}

      {latest && <ItemCard item={latest} highlight />}

      <div>
        <h2 className="font-semibold text-zinc-300 mb-2">In this show ({items.length})</h2>
        <div className="flex flex-col gap-2">
          {items.map((it) => <ItemCard key={it.id} item={it} />)}
        </div>
      </div>

      <Link href={`/stage/${showId}`} className="text-center text-sm text-zinc-500 underline">Open stage →</Link>
    </main>
  );
}

function ItemCard({ item, highlight }: { item: Item; highlight?: boolean }) {
  const numericId = item.shopify_product_id?.split("/").pop();
  return (
    <div className={`flex gap-3 rounded-2xl p-3 border ${highlight ? "border-emerald-500 bg-emerald-950/30" : "border-zinc-800 bg-zinc-900"}`}>
      {item.image_urls[0] && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.image_urls[0]} alt="" className="w-20 h-20 rounded-lg object-cover" />
      )}
      <div className="flex-1 min-w-0">
        <div className="font-bold truncate">{item.title}</div>
        <div className="text-xs text-zinc-400">{[item.brand, item.size, item.condition].filter(Boolean).join(" · ")}</div>
        <div className="text-sm mt-1">Est. {gbp(item.price_estimate)} · Buy now <b>{gbp(item.buy_now_price)}</b></div>
        {storeDomain && numericId && (
          <a href={`https://${storeDomain}/admin/products/${numericId}`} target="_blank" rel="noreferrer" className="text-xs text-emerald-400 underline">
            View in Shopify
          </a>
        )}
      </div>
    </div>
  );
}
