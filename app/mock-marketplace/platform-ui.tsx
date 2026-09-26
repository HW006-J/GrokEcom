// Look-alike chrome for the demo marketplaces, copied by eye from ebay.co.uk and
// facebook.com/marketplace. These pages imitate the platforms, so the platforms'
// own colours apply here instead of the app tokens. No logo files: the wordmarks
// are styled text. Every page carries a "Demo" marker.
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import type { SimilarItem } from "@/lib/mock-marketplaces";

export const EBAY = {
  font: '"Market Sans", "Helvetica Neue", Helvetica, Arial, sans-serif',
  ink: "#191919", ink2: "#707070", line: "#e5e5e5", field: "#f7f7f7", fieldLine: "#8f8f8f",
  blue: "#0968f6", link: "#0654ba", green: "#05823f", grey: "#f7f7f7",
};

export const FB = {
  font: 'system-ui, -apple-system, "SF Pro Text", "Segoe UI", Helvetica, Arial, sans-serif',
  ink: "#050505", ink2: "#65676b", line: "#ced0d4", page: "#f0f2f5", blue: "#0866ff", button: "#e4e6eb", card: "#ffffff",
};

const demoPill = (dark = false): CSSProperties => ({
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 10, fontWeight: 600, letterSpacing: ".04em",
  border: `1px solid ${dark ? "#fff6" : "#0003"}`, color: dark ? "#fff" : "#555", borderRadius: 999, padding: "3px 7px", whiteSpace: "nowrap",
});

export function DemoPill() {
  return <span title="Demo page. Not the real site." style={demoPill()}>DEMO</span>;
}

export function EbayWordmark({ size = 34 }: { size?: number }) {
  return <span aria-label="eBay (demo)" style={{ fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif', fontSize: size, fontWeight: 500, letterSpacing: -size * 0.09, lineHeight: 1 }}>
    <span style={{ color: "#e53238" }}>e</span><span style={{ color: "#0064d2" }}>b</span><span style={{ color: "#f5af02" }}>a</span><span style={{ color: "#86b817" }}>y</span>
  </span>;
}

export function FbWordmark({ size = 28 }: { size?: number }) {
  return <span aria-label="Facebook (demo)" style={{ fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif', fontSize: size, fontWeight: 700, letterSpacing: -size * 0.04, color: FB.blue, lineHeight: 1 }}>facebook</span>;
}

const icon = (d: string, size = 22, color = "currentColor") =>
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
export const ICONS = {
  search: "M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm10 2-4.35-4.35",
  cart: "M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L20 8H6.2M9 20.5h.01M17 20.5h.01",
  camera: "M4 8h3l2-2.5h6L17 8h3v11H4Zm8 9a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
  heart: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z",
  share: "M12 3v12M7 8l5-5 5 5M5 14v6h14v-6",
  bookmark: "M6 3h12v18l-6-4-6 4Z",
  close: "M6 6l12 12M18 6 6 18",
  back: "M15 5l-7 7 7 7",
  photo: "M4 5h16v14H4Zm0 10 4.5-4.5 4 4 2.5-2.5L20 17M15.5 9.5h.01",
  messenger: "M12 3C7 3 3 6.7 3 11.3c0 2.6 1.3 4.9 3.3 6.4V21l3-1.7c.9.3 1.8.4 2.7.4 5 0 9-3.7 9-8.4S17 3 12 3Zm-4 11 3-3.3 2 2 3-3.3",
  pin: "M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11Zm0-9a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  menu: "M4 7h16M4 12h16M4 17h16",
};
export const Icon = ({ d, size, color }: { d: string; size?: number; color?: string }) => icon(d, size, color);

export function EbayHeader() {
  return <header style={{ fontFamily: EBAY.font, color: EBAY.ink, background: "#fff" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 12, padding: "8px 16px", borderBottom: `1px solid ${EBAY.line}` }}>
      <span style={{ flex: 1 }}>Hello. <Link href="/dashboard" style={{ color: EBAY.link, textDecoration: "underline" }}>Your dashboard</Link></span>
      <span>Sell ▾</span><span>My eBay ▾</span><Icon d={ICONS.cart} size={20} />
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px 12px" }}>
      <EbayWordmark />
      <div role="search" style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, height: 44, border: `2px solid ${EBAY.ink}`, borderRadius: 44, padding: "0 12px" }}>
        <Icon d={ICONS.search} size={18} />
        <span style={{ flex: 1, fontSize: 15, color: EBAY.ink2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Search for anything</span>
        <Icon d={ICONS.camera} size={18} />
      </div>
      <DemoPill />
    </div>
  </header>;
}

export function FbHeader({ title }: { title?: ReactNode }) {
  return <header style={{ fontFamily: FB.font, background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.1)", position: "relative", zIndex: 1 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px" }}>
      <FbWordmark />
      <span style={{ flex: 1 }} />
      <DemoPill />
      <span style={{ width: 36, height: 36, borderRadius: 99, background: FB.button, display: "grid", placeItems: "center", color: FB.ink }}><Icon d={ICONS.search} size={18} /></span>
      <span style={{ width: 36, height: 36, borderRadius: 99, background: FB.button, display: "grid", placeItems: "center", color: FB.ink }}><Icon d={ICONS.messenger} size={18} /></span>
    </div>
    {title && <div style={{ padding: "2px 16px 10px", fontSize: 24, fontWeight: 700, color: FB.ink }}>{title}</div>}
  </header>;
}

const gbp2 = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

/** Links to real listings or a real search on the actual site. Opens in a new tab. */
export function SimilarLinks({ items, look }: { items: SimilarItem[]; look: "ebay" | "fb" }) {
  const ebay = look === "ebay";
  return <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8 }}>
    {items.map((item) => <li key={item.url}>
      <a href={item.url} target="_blank" rel="noopener noreferrer" style={{
        display: "flex", alignItems: "center", gap: 10, minHeight: 44, padding: "10px 12px", textDecoration: "none",
        color: ebay ? EBAY.ink : FB.ink, background: ebay ? "#fff" : FB.card, border: ebay ? `1px solid ${EBAY.line}` : `1px solid ${FB.line}`, borderRadius: ebay ? 12 : 8,
      }}>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 14, fontWeight: item.search ? 600 : 400, color: item.search ? (ebay ? EBAY.link : FB.blue) : undefined, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</span>
          {item.price ? <span style={{ display: "block", fontSize: 15, fontWeight: 700, marginTop: 2 }}>{ebay ? gbp2(item.price) : `£${item.price}`}</span> : null}
          <span style={{ display: "block", fontSize: 12, color: ebay ? EBAY.ink2 : FB.ink2, marginTop: 2 }}>{item.search ? "Live search on the real site" : `Real listing on ${ebay ? "ebay.co.uk" : "Facebook Marketplace"}`}</span>
        </span>
        <span aria-hidden="true">↗</span>
      </a>
    </li>)}
  </ul>;
}
