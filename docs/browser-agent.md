# Browser agent (LLM-driven)

`lib/browser-agent.ts` is an autonomous browser agent in the style of the Browser Use library. It loops: **observe the page → the model picks one action → execute it → feed the outcome back**. It is **not wired into the app**. No route or screen calls it; only `scripts/browser-agent.mts` does.

## How it differs from the scripted lister

| | `lib/browser-lister.ts` (live in the app) | `lib/browser-agent.ts` (this) |
|---|---|---|
| Who decides each step | Hard-coded Playwright calls (`getByLabel('Title')`, `#publish`) | The LLM, from what it sees |
| Knows the page layout | Yes, breaks if the form changes | No: works from a numbered element list and a screenshot |
| eBay research | Fixed DOM scrape of result cards | Reads the page text and notes prices itself |
| Cost and speed | Free, about 10 s | About 6–11 model calls, 17–47 s |
| Imports | `@/lib/*` (Next only) | Only `playwright` and `openai`, so a plain Node script can import it |

## The loop

Each step:

1. **Observe.** A script injected into the page tags every visible interactive element (links, buttons, inputs, selects, textareas, file inputs even when hidden, ARIA roles such as `role=button`, contenteditable) with `data-agent-id="N"`. It returns a compact list with the index, tag and role or type, accessible name (aria-label, label, placeholder, text), current value, select options, whether the element is required or disabled, whether it is above, below or in view, and whether something covers it. Elements in view come first, capped at 120. The script also returns the text in the viewport plus about one screen below, in reading order, and the scroll position of the page or its main scrolling panel.
2. **Annotate.** Coloured boxes with index badges are drawn over in-view, uncovered elements, as Browser Use does. The agent takes a JPEG screenshot, then removes the badges.
3. **Decide.** One Chat Completions call is sent with the system rules, the task, the notes, the last 10 actions with their outcomes or errors, the page state and the screenshot. Settings: `tool_choice: required`, no parallel calls, `reasoning_effort: low`, and an 8k token cap. Only the current screenshot is sent, never old ones.
4. **Act and record.** Each step records `{step, url, title, reason, action, outcome, error?, screenshot, ms}` and calls `onStep`.

## Actions (OpenAI tools)

Every tool takes a short `reason` and an optional `memory`. Anything put in `memory` is kept in the running notes; this is how eBay prices survive until the pricing step.

| Tool | Args | Notes |
|---|---|---|
| `click` | `index` | Falls back to a DOM click if something intercepts the pointer. Waits up to 2 s for a navigation to start, then for the page to settle. |
| `type` | `index, text, clear?` | Replaces the value by default. Returns the value that stuck. |
| `select` | `index, option` | Matches by visible text or value, and ignores the difference between dashes (`Used - good` finds `Used – good`). |
| `upload` | `index, source` | `source` is a named file from the task, an http(s) URL or a data URL. The index can point at the file input or at a label or button that wraps one. |
| `press` | `key` | Playwright key names |
| `scroll` | `direction` | Uses the mouse wheel over the middle of the viewport, so app shells that scroll inside a `div` work too. |
| `goto` | `url` | Checked against the allowed hosts before the request is made. |
| `wait` | `seconds` | 0.5 to 10 s |
| `done` | `success, summary, result?` | A `result` that is JSON text is parsed. |
| `fail` | `reason_failed` | |

**Robustness.** An unknown or stale index, a non-`<select>`, a missing option or a click on a file input all come back as an error the model sees on its next turn. Arguments that are not JSON, or a reply with no tool call, count as a model failure; after 3 in a row the run stops. A step on a stale element fails within 8 s at most (the context's default timeout). A start URL that fails to load is shown to the model rather than thrown.

## Safety (enforced in code, not only in the prompt)

- **Navigation.** A top-level navigation must go to `allowedHosts` or `readOnlyHosts`, checked in `context.route`. The `goto` tool checks the same list first. A host entry also covers its subdomains.
- **No writes outside `allowedHosts`.** Every `POST`, `PUT`, `PATCH` or `DELETE` to any other host (including `readOnlyHosts` and third-party trackers) is aborted. The agent can read ebay.co.uk but cannot submit a form, a consent choice or a sign-in to it. In testing the model once clicked eBay's cookie banner anyway; the `POST /gdpr/ac/getToken` it triggered was blocked. Blocked requests are returned in `result.blocked`.
- Service workers and downloads are blocked, and native dialogs are dismissed and reported to the model.
- **Limits.** A hard step cap (`maxSteps`, default 25) and a wall-clock `timeoutMs` (default 6 min). Each model call is capped at the time left.
- When the agent is on a read-only host, the observation tells the model so, and tells it to read rather than click.

## Task preset: `listItemGoal(lot, platform, origin, { checkComps })`

`listItemGoal` returns `{ goal, startUrl, allowedHosts, readOnlyHosts, files }`, ready to spread into `runBrowserAgent`. The goal tells the agent to:

1. Optionally, and read-only, open the real eBay UK "Buy it now" search for the item and note up to 5 prices. eBay often answers a cold headless browser with a 403 "Error Page", so the agent retries up to twice more and otherwise skips this step.
2. Open `/mock-marketplace/{platform}/sell?lot=<id>`.
3. Fill in the exact title, the best-matching condition, and a whole-pound price inside the lot's estimate (the midpoint unless the comps say otherwise). Attach the photo, which is passed as the named file `item-photo` so the model never has to handle the data URL.
4. Publish, confirm the `?listing=<id>` page, and return JSON: `{listing_id, listing_url, title, price, condition, comps}`.

## Running it

A dev or production server must be running.

```bash
npm run agent:list -- --platform ebay          # or marketplace
npm run agent:list -- --platform marketplace --no-comps --headful
BASE_URL=https://your-app.up.railway.app npm run agent:list -- --platform ebay
```

Flags: `--platform ebay|marketplace`, `--no-comps` (skip eBay research), `--headful`, `--lot <id>`, `--max-steps N`, `--model <id>`, `--out <dir>`.

The script:

- Loads `.env.local` itself, because it runs outside Next and needs `OPENAI_API_KEY` and `OPENAI_MODEL`.
- Needs Node 22.6 or later for TypeScript type stripping. It was tested on Node 23.11.
- Picks a lot from `GET /api/dashboard`: a listable lot in a sale titled **"Browser agent test"** that has no listing on this platform yet. If there is none, it makes one. It sends `POST /api/sale` with one lot and two `unpicked` lots, copying real dashboard items and their photos when there are any, then `POST /api/sale/<code>/end`. That leaves one `unsold` lot and two `found` lots, so each sale covers 3 lots × 2 platforms.
- Prints each step live. It writes `step-NN.jpg` (what the model saw, with badges), `final.jpg` and `transcript.json` to `$TMPDIR/sellout-browser-agent/<timestamp>-<platform>/`.
- Checks the result through `GET /api/mock-listings`, not through what the model claims. It checks that a listing exists for this lot and platform, that the title is exact, that the price is a whole number inside the estimate, and that the photo came through the form as a data URL. It also checks that the id and price the agent returned match. It exits 1 if any check fails.

Mock listings are held in memory, so they reset when the server restarts.

## Wiring it in later (not done)

- **Route.** A `POST /api/mock-listings/browser?mode=agent` handler, or a sibling such as `/api/mock-listings/agent`, would load the lot with `db().getLot` and check it with `canList`. It would then call `runBrowserAgent({...listItemGoal(lot, platform, origin), onStep})` in the background and keep the job in memory as `browser-lister.ts` does. `onStep` would push `{screenshot, url, reason}` into the job, so the existing replay screen at `/mock-marketplace/[platform]/agent` can poll it. In production, pass `origin = http://127.0.0.1:$PORT` as the lister does.
- **Job data.** To have the listing record the agent's steps and comps, add `&job=<id>` to the sell URL in the goal. The sell form already forwards `job`.
- **Fallback.** Keep the scripted lister as the fallback when the agent fails or takes too long; it is faster and costs nothing.
- **Deployment.** `CHROMIUM_PATH` is already honoured for Railway.

## Known limits

- It costs one model call per step, and each call takes about 2–5 s with gpt-5-mini at low reasoning effort. A run takes 6 steps (about 20 s) without research and 9–11 steps (about 40–47 s) with it.
- eBay research depends on eBay tolerating a headless browser. It usually returns 403 first and 200 on a retry, and the agent skips research when eBay keeps refusing. The comps are free text such as `"5.99-9.99"`, and nothing checks them.
- The model sometimes disobeys "don't click" on a read-only site. The code-level block on writes is the real guarantee.
- There is no multi-tab reasoning: a popup simply becomes the active page. Iframes are not observed, including cross-origin iframes, and neither is shadow DOM.
- Only the latest screenshot is sent. Earlier pages survive only as the action history and the model's `memory` notes.
