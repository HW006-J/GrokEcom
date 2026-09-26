@AGENTS.md

# The Sellout — hackathon build rules

A PWA. You point your phone at a room, it finds the objects worth money, cuts them out into a floating cloud with price estimates, and an AI auctioneer sells the ones you pick while people bid from a QR code or WhatsApp link.

Three screens, in order: **Scan** at `/`, **Your objects** at `/objects`, **Auction** at `/auction`.

- **YAGNI.** No auth, no admin, no tests, no design system beyond `app/globals.css`. Plain `fetch`, no ORM, no state library. If it is not on the demo path, do not build it.
- **UI is built and is the reference.** The three screens exist and work on mock data from `lib/mock.ts`. Do not restyle them. Replace the mock data with real data behind the same shapes.
- **Contract first.** `lib/types.ts` is the shared contract and says which track owns each route. Announce any change to it.
- **Design language.** Off-white `#f1f1ef` page, white surface, ink `#151515`, accent blue `#0a6cff`. Pills at 999px, cards at 24px. Monospace for small meta labels only. Cutouts use `mix-blend-mode: multiply` over white with a soft blurred shadow. Touch targets 44px. Respect safe-area insets and reduced motion. Tokens live in `app/globals.css`; use them, do not invent new colours.
- **Tracks.** Track A owns `app/api/scan`, `app/api/lots/**`, `lib/vision.ts`, `lib/pricing.ts`, plus the scan screen's real capture path. Track B owns `app/api/sale/**`, `lib/auctioneer.ts`, the auction screen's live wiring, and the `/join/[code]` bidder page. Both may read everything; edit only your own files.
- **Supabase.** `supabase/schema.sql` and `supabase/seed.sql` define `sales`, `lots`, `sale_bids`, `sale_messages` and the public `scans` bucket. Server writes use `supabaseServer()` in API routes. The browser uses `supabaseBrowser()` for reads and Realtime.
- **LLM.** OpenAI via `lib/llm.ts`, model from `OPENAI_MODEL`, default `gpt-5-mini`. That model spends tokens on reasoning first, so keep `reasoning_effort` minimal and token caps generous or it returns empty.
- **Avatar.** Anam drives the auctioneer, custom-LLM mode, `talk()` only, microphone never enabled. Free tier caps sessions at three minutes, so reconnect on close.
- **Deploy.** Railway, Nixpacks, `npm run start`. `NEXT_PUBLIC_APP_URL` is the public URL and is what the QR code encodes.
- **Next 16.** Read `node_modules/next/dist/docs/` before writing routes or pages. `params` and `searchParams` are Promises.
- Money is GBP and always a number, never a string. Prior ClosetLive routes worth lifting logic from are at commit `46fef3a`.


## Anam rules

ALWAYS:
- Mint session tokens on the server; only the short-lived token reaches the browser. Tokens last about an hour.
- Prepare on page load: bundle the SDK and prefetch the token. The user gesture should only call `streamToVideoElement()`.
- Add `<link rel="preconnect" href="https://api.anam.ai">` to warm the connection.
- Keep spoken replies short and conversational.
- Set `llmId: 'CUSTOMER_CLIENT_V1'` whenever `personaConfig` is inline, or the token is rejected as legacy. Our own code produces every line.
- Stream long replies with `createTalkMessageStream()` and end with `endMessage()`; on `TALK_STREAM_INTERRUPTED`, discard buffers and start a fresh stream.
- Keep the system prompt in our code. In custom-LLM mode it is never sent to Anam.
- Inside an iframe, set `allow="camera; microphone; autoplay"` or the stream stalls silently.

NEVER:
- Expose `ANAM_API_KEY` to the client, or import it into anything under `app/` that runs in the browser.
- Play our own TTS alongside Anam. Anam speaks the text we send.
- Invent an Anam API, method or config field. Check https://anam.ai/docs/llms.txt or ask.
