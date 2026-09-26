@AGENTS.md

# ClosetLive — hackathon build rules

AI avatar live-shopping host for selling second-hand wardrobe items. Plan: ~/.claude/plans/so-help-us-refine-federated-stream.md

- **YAGNI.** No auth, no admin, no tests, no design system, no state library. One show (`NEXT_PUBLIC_SHOW_ID`). Plain `fetch`. If it is not on the 3-minute demo path, do not build it.
- **APIs first.** Contract and shared types live in `lib/types.ts`. Do not change response shapes without updating that file. Routes use `ok()`/`fail()` from `lib/api.ts`.
- **Ownership.** Agent A (API): `app/api/**`, `lib/shopify.ts`, `lib/llm.ts`, `lib/tavily.ts`, `lib/anam.ts`, `lib/host.ts`. Agent B (UI): `app/watch/**`, `app/stage/**`, `app/sell/**`, `app/page.tsx`, `components/**`. Both may read everything; only edit your own files and `lib/types.ts` (announce changes).
- **Supabase.** Server writes via `supabaseServer()` (service role) in API routes only. Browser uses `supabaseBrowser()` for reads + Realtime subscriptions. Schema: `supabase/schema.sql`, seed: `supabase/seed.sql`.
- **Env.** See `.env.example`. `MOCK_HOST=1` makes `/api/host/tick` return canned lines (no Claude call). Stage page `?mock=1` uses browser `speechSynthesis` instead of Anam.
- **Deploy.** Railway, Nixpacks, `npm run start` (Next reads `PORT`). `NEXT_PUBLIC_APP_URL` must be the public Railway URL (it is what the QR encodes).
- **Next 16.** Read `node_modules/next/dist/docs/` before writing routes/pages; `params` and `searchParams` are Promises.
- **LLM.** OpenAI via `lib/llm.ts` (`OPENAI_MODEL`, default gpt-5-mini) for vision listing and host brain. No Anthropic SDK.
- Money is GBP, numbers not strings. Shopify Admin GraphQL via plain fetch, API version `2026-07`.
