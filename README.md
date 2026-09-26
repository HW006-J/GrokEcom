# The Sellout

**Point your phone at a room. It finds what's worth money, prices it from live resale listings, and an AI auctioneer sells it to your friends in minutes.**

Grok Bot Commerce London Hackathon, 26 Sep 2026 · Track: **New Ways to Buy** (reselling), with **Agentic Commerce**.

---

## The problem

Everyone has a flat full of things worth money and no time to sell them. Listing one item on eBay or Marketplace takes about 15 minutes: photos, a title, researching a price, answering "is this still available?", haggling and no-shows. Most of it never gets listed. It ends up in a skip or a charity bag, or it stays in the cupboard.

Moving out, clearing a parent's house or decluttering all end the same way: dozens of items and nobody willing to do dozens of listings.

## What we built

A phone-first PWA that turns a room into a live sale in three steps:

| Step | Screen | What happens |
| --- | --- | --- |
| 1. **Scan** | `/` | Take one photo. Open-vocabulary detection (Grounding DINO) finds sellable objects, and SAM2 cuts each one out at pixel level into a clean product shot. No manual photos, no background removal. |
| 2. **Choose** | `/review` → `/objects` | Your objects float in a cloud. Tap to pick what to sell. Each pick is **priced from real UK resale listings**, and the listings are shown and linked under the price ("Similar: eBay £38 · Vinted £45"), so you can see where the number came from. |
| 3. **Sell** | `/auction` | Choose a start time and share a QR or WhatsApp link. Everyone sees the same countdown. A **live AI auctioneer avatar** introduces each lot, calls bidders by name, answers questions and brings the hammer down when bidding goes quiet. Winners get a checkout link. |

Bidders need no app or account: they scan the QR, type a name and bid from `/join/[code]`.

Anything that doesn't sell goes to the **seller dashboard** (`/dashboard`), where a **browser agent lists it on a marketplace** for you: a headless browser fills in the listing form and publishes it while you watch.

## Why it matters (impact)

- **Sellers:** a whole room listed in one photo instead of dozens of listings. Prices are set from real comparables, not guesses. An auction creates urgency, so items sell tonight, not in three weeks.
- **Buyers:** a fun, social, time-boxed way to get things from people they know. They see where the estimate came from, so they trust the price.
- **Circular economy:** less goes to landfill because the effort of selling drops to almost nothing.

## How AI agents do the work

This isn't a chatbot bolted onto a shop. Agents do the selling:

1. **Vision agent:** finds the objects and segments them out of the photo, running server-side on open models (Grounding DINO + SAM2 via Transformers.js/ONNX). Nothing about object positions is guessed by an LLM ([why](docs/vision.md)).
2. **Pricing agent:** searches the live web for UK second-hand listings (Tavily and model web search), reads them, returns a GBP range and **cites up to four real listings with links**. It never invents a listing or URL. If no listings are found, the UI says so ("AI estimate · no live listings found").
3. **Auctioneer agent:** a state machine (`present → bidding → sold → next`) drives an LLM that writes each spoken line from the live state: the current lot, new bids, time left and viewer questions. An animated auctioneer speaks every line in an **ElevenLabs** voice, with its mouth driven by the live audio. Lots **soft-close**: bidding opens for 12s, every bid resets a 7s quiet window, and the auctioneer says "going once, going twice" before the hammer. Lots end when the room goes quiet, not on a fixed timer.
4. **Listing agent:** for unsold items, a Playwright browser agent opens a marketplace sell form and types the title, condition and price, uploads the cutout and publishes, streaming screenshots so the seller can watch.

## Commerce stack

| Layer | Used for |
| --- | --- |
| **Shopify** (Admin GraphQL) | The winning bid becomes a product and a checkout link for the winner (`lib/shopify.ts`). Optional: without a store it degrades gracefully. |
| **Tavily** | Live search of UK resale sites (eBay, Gumtree, Facebook Marketplace, Vinted) for price comparables (`lib/tavily.ts`, `lib/pricing.ts`). |
| **Supabase** | Sales, lots, bids and messages, with a race-safe compare-and-set on the high bid. There's an in-memory fallback so the demo runs with no database (`lib/db.ts`). |
| **ElevenLabs** | The auctioneer's voice (Flash v2.5, streamed through `/api/voice`, so the key stays on the server). |
| **OpenAI** | Auctioneer lines and pricing reads with structured JSON output (`lib/llm.ts`). |
| **Wassist** (WhatsApp) | Optional follow-up to winning bidders with their checkout link. |
| **Railway** | Hosting. Vision models are downloaded and warmed at build time. |

## Business model

- **Take rate:** 5–10% of the hammer price on every sold lot, collected through the checkout.
- **Listing fee:** a small fee for relisting unsold items to marketplaces through the listing agent.
- **B2B:** house-clearance firms, estate agents and removals companies (a "sell before you move" add-on) run white-label sales for their clients.

## Try it

1. Open the app on a phone and enter your name.
2. Photograph a shelf or desk with a few distinct objects (a lamp, headphones, a vase, a bag).
3. Tap objects to select them; prices and their source listings appear.
4. Tap **Sell**, pick **Start in 1 minute** and share the QR.
5. Bid from a second phone on the join link. Watch the clock reset on each bid and the hammer fall when bidding stops.
6. Open **Your sales** (top left on the scan screen) to see earnings, then list unsold items with the browser agent.

## Run it locally

```bash
npm install
cp .env.example .env.local        # fill in what you have; every integration is optional
npm run vision:warmup             # downloads and caches the detection and segmentation models once
npm run dev
```

| Variable | Needed for |
| --- | --- |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Pricing and auctioneer lines. Without it, the auctioneer uses scripted lines. |
| `TAVILY_API_KEY` | Search-backed price comparables |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | The auctioneer's voice. Without it, the sale runs with captions only. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Persistence (otherwise in-memory, single instance) |
| `NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_TOKEN` | Checkout links for winners |
| `NEXT_PUBLIC_APP_URL` | The public URL the QR code encodes |
| `WASSIST_*` | WhatsApp follow-ups |

Database: run `supabase/schema.sql`, then `supabase/seed.sql`.

## Architecture

```
phone ──photo──▶ /api/scan ──▶ Grounding DINO ─▶ SAM2 masks ─▶ cutouts
                                                    │
            pick ──▶ /api/price ──▶ Tavily / web search ─▶ low · high · cited comps
                                                    │
 host /auction ──▶ /api/sale ──▶ /timing (start countdown)
      │  ticks (scheduled at start, last call, hammer)
      ▼
 lib/auctioneer.ts  present → bidding (soft close) → sold → next
      │  line                                   ▲
      ▼                                         │ /bid (CAS high bid, resets quiet clock)
 auctioneer speaks (ElevenLabs)                    bidders on /join/[code] (QR)
      │
 hammer ──▶ Shopify checkout ──▶ WhatsApp link   unsold ──▶ browser listing agent
```

Key files: `lib/auctioneer.ts` (sale state machine and voice), `lib/sale-timing.ts` (soft-close timings), `lib/pricing.ts` (cited pricing), `lib/grounded.mjs` (detection and segmentation), `lib/db.ts` (storage), `lib/types.ts` (the shared API contract).

## Honest limits

- A scan is one photo, not live video. Detection is deliberately conservative, so small or occluded items can be missed. **+ Add item** lets you draw a box around anything it missed.
- Vision runs on CPU. The first scan on a cold server is slow, and warm scans take seconds.
- Marketplace listing targets our own demo marketplace pages, not real eBay or Facebook accounts.
- Without Supabase, sales live in memory on a single instance and reset on restart.
- The browser listing agent needs Chromium on the server (`npx playwright install chromium`). Without it, the listing is published instantly and the UI says so.
