/* eslint-disable @next/next/no-img-element */
"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { platformName, type MockPlatform } from "@/lib/mock-marketplaces";
import type { BrowserJob } from "@/lib/browser-lister";
import { SimilarLinks } from "../../platform-ui";

// The listing agent's run on its own screen: live while it works, then a
// replay of the kept screenshots. Separate from the finished listing page.

export default function AgentActivity({ params }: { params: Promise<{ platform: string }> }) {
  const { platform } = use(params);
  const [job, setJob] = useState<BrowserJob | null>(null);
  const [missing, setMissing] = useState("");
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);

  // Poll while running; once done, fetch the kept frames once for the replay.
  useEffect(() => {
    let alive = true;
    const id = new URLSearchParams(location.search).get("job") ?? "";
    (async () => {
      while (alive) {
        const response = await fetch(`/api/mock-listings/browser?id=${encodeURIComponent(id)}`, { cache: "no-store" }).catch(() => null);
        const data = await response?.json().catch(() => null);
        if (!alive) return;
        if (!response?.ok || !data) { setMissing(data?.error || "Could not load this agent run."); return; }
        if (data.done) {
          const full = await fetch(`/api/mock-listings/browser?id=${encodeURIComponent(id)}&frames=1`, { cache: "no-store" }).then((r) => r.json()).catch(() => data);
          if (alive) { setJob(full); setFrame(Math.max(0, (full.frames?.length ?? 1) - 1)); }
          return;
        }
        setJob(data);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    })();
    return () => { alive = false; };
  }, []);

  const frames = job?.frames ?? [];
  useEffect(() => {
    if (!playing || !frames.length) return;
    const timer = setInterval(() => setFrame((index) => {
      if (index + 1 >= frames.length) { setPlaying(false); return index; }
      return index + 1;
    }), 900);
    return () => clearInterval(timer);
  }, [playing, frames.length]);

  const name = platformName(platform === "ebay" ? "ebay" : "marketplace" as MockPlatform);
  const replaying = !!job?.done && frames.length > 0;
  const shown = replaying ? frames[Math.min(frame, frames.length - 1)] : null;
  const screenshot = shown?.screenshot ?? job?.screenshot;
  const url = (shown?.url ?? job?.url ?? "").replace(/^https?:\/\/(localhost[^/]*|[^/]*\.railway\.app|127\.0\.0\.1[^/]*)/, "") || "about:blank";
  const activeStep = replaying ? shown!.step : job?.step ?? 0;
  const status = !job ? "Starting" : job.error ? "Stopped" : job.done ? "Done" : "Live";

  return <main className="shell" style={{ background: "var(--paper)" }}>
    <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "calc(12px + env(safe-area-inset-top)) 16px 12px" }}>
      <Link href="/dashboard" aria-label="Back to dashboard" style={{ width: 44, height: 44, borderRadius: "var(--r-pill)", background: "var(--surface)", display: "grid", placeItems: "center", color: "var(--ink)", fontSize: 20, textDecoration: "none", boxShadow: "var(--shadow-soft)" }}>←</Link>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)", letterSpacing: ".04em" }}>LISTING AGENT · {name.toUpperCase()} DEMO</div>
        <h1 style={{ margin: "2px 0 0", fontSize: 20, fontWeight: 700, letterSpacing: "-.4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{job?.lotName ?? "Agent activity"}</h1>
      </div>
      <span style={{ display: "flex", alignItems: "center", gap: 6, borderRadius: "var(--r-pill)", border: "1px solid var(--line)", background: "var(--surface)", padding: "6px 10px", fontSize: 12, fontWeight: 600 }}>
        {status === "Live" && <i aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 99, background: "var(--ink)" }} />}{replaying ? "Replay" : status}
      </span>
    </header>

    <div style={{ overflowY: "auto", flex: 1, padding: "0 16px calc(24px + env(safe-area-inset-bottom))" }}>
      {missing ? <p role="alert" style={{ padding: "24px 0" }}>{missing} <Link href="/dashboard" style={{ textDecoration: "underline" }}>Back to dashboard</Link></p> : <>
        <div style={{ borderRadius: "var(--r-card)", overflow: "hidden", background: "var(--surface)", boxShadow: "var(--shadow-lift)", maxWidth: 440, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--line)" }}>
            <span aria-hidden="true" style={{ display: "flex", gap: 5 }}>{[0, 1, 2].map((dot) => <i key={dot} style={{ width: 9, height: 9, borderRadius: 99, background: "var(--line-2)" }} />)}</span>
            <span style={{ flex: 1, minWidth: 0, borderRadius: "var(--r-pill)", background: "var(--paper)", padding: "6px 12px", fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{url}</span>
          </div>
          <div style={{ aspectRatio: "420 / 600", display: "grid", placeItems: "center", background: "var(--surface)" }}>
            {screenshot ? <img src={screenshot} alt={`Agent browser: ${job?.steps[activeStep] ?? status}`} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
              : <span className="sub" style={{ fontSize: 13 }}>Launching Chromium…</span>}
          </div>
        </div>

        {replaying && <div style={{ display: "flex", alignItems: "center", gap: 12, maxWidth: 440, margin: "14px auto 0" }}>
          <button onClick={() => { if (frame >= frames.length - 1) setFrame(0); setPlaying((value) => !value); }} aria-label={playing ? "Pause replay" : "Play replay"} style={{ width: 44, height: 44, flexShrink: 0, borderRadius: "var(--r-pill)", background: "var(--accent)", color: "var(--accent-ink)", fontSize: 15 }}>{playing ? "❚❚" : "▶"}</button>
          <input type="range" min={0} max={frames.length - 1} value={Math.min(frame, frames.length - 1)} onChange={(event) => { setPlaying(false); setFrame(Number(event.target.value)); }} aria-label="Replay position" style={{ flex: 1, minHeight: 44, accentColor: "var(--accent)" }} />
          <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)", minWidth: 40, textAlign: "right" }}>{Math.min(frame, frames.length - 1) + 1}/{frames.length}</span>
        </div>}

        {job && <ol aria-live="polite" style={{ listStyle: "none", maxWidth: 440, margin: "16px auto 0", padding: "8px 16px", background: "var(--surface)", borderRadius: "var(--r-tile)", border: "1px solid var(--line)" }}>
          {job.steps.map((step, index) => {
            const skipped = job.skipped.includes(index);
            const done = replaying ? index < activeStep || (index === activeStep && frame === frames.length - 1 && !job.error) : index < job.step;
            const active = index === activeStep && !done;
            const failed = !!job.error && index === job.step;
            const firstFrame = frames.findIndex((kept) => kept.step === index);
            return <li key={step} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 40, fontSize: 14, color: done || active ? "var(--ink)" : "var(--ink-3)", fontWeight: active ? 650 : 400, borderTop: index ? "1px solid var(--line)" : 0 }}>
              <span aria-hidden="true" style={{ width: 20, height: 20, flexShrink: 0, borderRadius: 99, display: "grid", placeItems: "center", fontSize: 11, background: done ? "var(--accent)" : "transparent", color: done ? "var(--accent-ink)" : "inherit", border: done ? 0 : "1.5px solid currentColor" }}>{failed ? "×" : skipped ? "–" : done ? "✓" : active ? "•" : ""}</span>
              {replaying && firstFrame >= 0
                ? <button onClick={() => { setPlaying(false); setFrame(firstFrame); }} style={{ flex: 1, textAlign: "left", minHeight: 40, font: "inherit", color: "inherit" }}>{step}{skipped ? " · skipped" : ""}</button>
                : <span style={{ flex: 1 }}>{step}{skipped ? " · skipped" : ""}</span>}
            </li>;
          })}
        </ol>}

        {job?.error && <p role="alert" style={{ maxWidth: 440, margin: "12px auto 0", fontSize: 13, color: "#a32727" }}>The agent stopped: {job.error}</p>}

        {job?.listing && <Link href={job.listing.mockUrl} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, maxWidth: 440, minHeight: 52, margin: "16px auto 0", borderRadius: "var(--r-pill)", background: "var(--accent)", color: "var(--accent-ink)", fontSize: 15, fontWeight: 650, textDecoration: "none" }}>View listing <span aria-hidden="true">↗</span></Link>}

        {!!job?.found.length && <section style={{ maxWidth: 440, margin: "22px auto 0" }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 4px" }}>Found live on eBay</h2>
          <p className="sub" style={{ fontSize: 12, margin: "0 0 10px" }}>Real listings the agent read while checking prices.</p>
          <SimilarLinks items={job.found} look="ebay" />
        </section>}
      </>}
    </div>
  </main>;
}
