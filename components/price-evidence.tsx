import { gbp, type Comp } from "@/lib/types";

const site = (c: Comp) => {
  const s = (c.source || (() => { try { return new URL(c.url).hostname; } catch { return ""; } })())
    .replace(/^www\./, "").replace(/\.(co\.uk|com|co)$/, "");
  return s ? s[0].toUpperCase() + s.slice(1) : "Listing";
};

/** Where a price came from: the real listings behind the estimate, each one a link. */
export function PriceEvidence({ comps, compact = false }: { comps?: Comp[]; compact?: boolean }) {
  const list = (comps ?? []).filter(c => c.url && c.price > 0).slice(0, compact ? 3 : 4);
  if (!list.length) return <p className="meta" style={{ margin: "4px 0 0", color: "var(--ink-3)" }}>AI estimate · no live listings found</p>;

  if (compact) {
    return (
      <p className="meta" style={{ margin: "4px 0 0", color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        Similar: {list.map((c, i) => <span key={c.url}>{i ? " · " : ""}<a href={c.url} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>{site(c)} {gbp(c.price)}</a></span>)}
      </p>
    );
  }

  return (
    <div style={{ marginTop: 10 }}>
      <p className="meta" style={{ margin: "0 0 6px", color: "var(--ink-2)" }}>Priced from {list.length} live {list.length === 1 ? "listing" : "listings"}</p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 2 }}>
        {list.map(c => (
          <li key={c.url}>
            <a href={c.url} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, color: "var(--ink)", textDecoration: "none", fontSize: 14 }}>
              <span className="meta" style={{ flex: "0 0 auto", color: "var(--ink-2)" }}>{site(c)}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</span>
              <strong style={{ fontVariantNumeric: "tabular-nums" }}>{gbp(c.price)}</strong>
              <span aria-hidden="true">↗</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
