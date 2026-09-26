// Runs the LLM browser agent (lib/browser-agent.ts) end to end against a running app:
// makes a real unsold lot through the app's APIs, lets the agent list it on a demo
// marketplace, then checks /api/mock-listings for the listing.
//
//   npm run agent:list -- --platform ebay|marketplace [--no-comps] [--headful]
//                         [--lot <id>] [--max-steps 25] [--out <dir>] [--model gpt-5-mini]
//   BASE_URL defaults to http://localhost:3000.
//
// Needs Node >= 22.6 (TypeScript type stripping). Exits non-zero unless the listing is confirmed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type AgentModule = typeof import('../lib/browser-agent');
// A variable specifier keeps tsc from demanding allowImportingTsExtensions; Node strips the types at run time.
const agentPath = new URL('../lib/browser-agent.ts', import.meta.url).href;
const { runBrowserAgent, listItemGoal, listingPriceRange } = (await import(agentPath)) as AgentModule;

// ---- env: .env.local without a dependency
const envFile = new URL('../.env.local', import.meta.url);
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
if (!process.env.OPENAI_API_KEY) { console.error('OPENAI_API_KEY is not set (checked env and .env.local).'); process.exit(2); }

// ---- args
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const option = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const platform = (option('platform') ?? 'ebay') as 'ebay' | 'marketplace';
if (platform !== 'ebay' && platform !== 'marketplace') { console.error('--platform must be ebay or marketplace'); process.exit(2); }
const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const TEST_SALE_TITLE = 'Browser agent test';

type Lot = { id: string; name: string; status: string; picked: boolean; condition?: string; blurb?: string; category?: string; image_url?: string; low?: number; high?: number; reserve?: number };
type Dashboard = { sales: { sale: { id: string; code: string; title: string }; lots: Lot[]; unlisted: Lot[] }[] };
type Listing = { id: string; lotId: string; platform: string; title: string; price: number; condition?: string; imageUrl: string; mockUrl: string };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(BASE + path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers }, signal: AbortSignal.timeout(60_000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${response.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return body as T;
}
const canList = (lot: Lot) => lot.status === 'unsold' || (lot.status === 'found' && !lot.picked);
const listings = async () => (await api<{ listings: Listing[] }>('/api/mock-listings')).listings;

// Items to clone into a test sale when the dashboard has nothing better to copy from.
const FALLBACK_ITEMS = [
  { name: 'Sony WH-1000XM4 wireless headphones', category: 'Tech', condition: 'Used, very good, light wear on the headband', blurb: 'Noise-cancelling over-ear headphones with case.', low: 90, high: 140 },
  { name: 'Anglepoise Type 75 desk lamp', category: 'Lighting', condition: 'Good, small scuff on the base', blurb: 'Classic spring-balanced desk lamp in black.', low: 60, high: 110 },
  { name: 'Le Creuset cast iron casserole 24cm', category: 'Other', condition: 'Used, good, some staining inside', blurb: 'Volcanic orange round casserole with lid.', low: 70, high: 120 },
];

/** A lot in one of our test sales that has no listing on this platform yet, making a fresh test sale if needed. */
async function pickLot(): Promise<Lot> {
  const listed = new Set((await listings()).filter((l) => l.platform === platform).map((l) => l.lotId));
  const wanted = option('lot');
  const dash = await api<Dashboard>('/api/dashboard');
  const all = dash.sales.flatMap((s) => [...s.lots, ...s.unlisted].map((lot) => ({ lot, test: s.sale.title === TEST_SALE_TITLE })));
  if (wanted) {
    const hit = all.find((x) => x.lot.id === wanted)?.lot;
    if (!hit) throw new Error(`lot ${wanted} is not on the dashboard`);
    if (!canList(hit)) throw new Error(`lot ${wanted} is ${hit.status}; only unsold or unauctioned lots can be listed`);
    if (listed.has(hit.id)) throw new Error(`lot ${wanted} already has a ${platform} listing (listings reset when the server restarts)`);
    return hit;
  }
  const reusable = all.find((x) => x.test && canList(x.lot) && !listed.has(x.lot.id) && x.lot.image_url);
  if (reusable) return reusable.lot;

  // Copy real scanned items (with their photos) where they have a price, else use the fallbacks.
  const seen = new Set<string>();
  const real = all.map((x) => x.lot)
    .filter((l) => !/check$/i.test(l.name) && Number(l.low) > 0 && Number(l.high) >= Number(l.low) && l.image_url && !seen.has(l.name) && seen.add(l.name))
    .slice(0, 3)
    .map((l) => ({ name: l.name, category: l.category, condition: l.condition, blurb: l.blurb, image_url: l.image_url, low: l.low, high: l.high, reserve: l.reserve }));
  const seeds = [...real, ...FALLBACK_ITEMS.map((f) => ({ ...f, image_url: `${BASE}/icon-512.png`, reserve: Math.round(f.low * 0.55) }))].slice(0, 3);
  console.log(`Creating a "${TEST_SALE_TITLE}" sale with ${seeds.map((s) => s.name).join(', ')}`);
  const created = await api<{ sale: { code: string } }>('/api/sale', { method: 'POST', body: JSON.stringify({ title: TEST_SALE_TITLE, lots: seeds.slice(0, 1), unpicked: seeds.slice(1) }) });
  await api(`/api/sale/${created.sale.code}/end`, { method: 'POST' });
  const after = await api<Dashboard>('/api/dashboard');
  const sale = after.sales.find((s) => s.sale.code === created.sale.code);
  const lot = sale && [...sale.lots, ...sale.unlisted].find((l) => canList(l) && !listed.has(l.id));
  if (!lot) throw new Error(`sale ${created.sale.code} did not show up on the dashboard with a listable lot`);
  return lot;
}

// ---- run
const lot = await pickLot();
const range = listingPriceRange(lot);
const outDir = option('out') ?? join(tmpdir(), 'sellout-browser-agent', `${new Date().toISOString().replace(/[:.]/g, '-')}-${platform}`);
mkdirSync(outDir, { recursive: true });
console.log(`Lot ${lot.id} "${lot.name}" (${lot.status}), £${range.min}–£${range.max}, platform ${platform}`);
console.log(`Output: ${outDir}\n`);

const task = listItemGoal(lot, platform, BASE, { checkComps: !flag('no-comps') });
const t0 = Date.now();
const run = await runBrowserAgent({
  ...task,
  maxSteps: Number(option('max-steps') ?? 25),
  model: option('model') ?? process.env.OPENAI_MODEL ?? 'gpt-5-mini',
  headless: !flag('headful'),
  onStep: (s) => {
    const file = `step-${String(s.step).padStart(2, '0')}.jpg`;
    if (s.screenshot) writeFileSync(join(outDir, file), Buffer.from(s.screenshot, 'base64'));
    const action = s.action ? `${s.action.name} ${JSON.stringify(Object.fromEntries(Object.entries(s.action.args).filter(([k]) => k !== 'reason' && k !== 'memory'))).slice(0, 140)}` : '(none)';
    console.log(`#${String(s.step).padStart(2)} ${(s.ms / 1000).toFixed(1).padStart(5)}s  ${action}`);
    if (s.reason) console.log(`      why: ${s.reason}`);
    console.log(`      ${s.error ? 'ERROR ' + s.error : s.outcome}`);
  },
});
if (run.finalScreenshot) writeFileSync(join(outDir, 'final.jpg'), Buffer.from(run.finalScreenshot, 'base64'));

// ---- verify through the app, not through what the model claims
const listing = (await listings()).find((l) => l.lotId === lot.id && l.platform === platform);
const claimed = (run.result && typeof run.result === 'object' ? run.result : {}) as Record<string, unknown>;
const checks: [string, boolean][] = [
  ['agent reported success', run.success],
  ['listing exists for lot + platform', !!listing],
  ['title matches the lot', listing?.title === lot.name.trim().slice(0, 80)],
  [`price is a whole number in £${range.min}–£${range.max}`, !!listing && Number.isInteger(listing.price) && listing.price >= range.min && listing.price <= range.max],
  ['photo was uploaded through the form', !!listing && listing.imageUrl.startsWith('data:image/') && listing.imageUrl !== lot.image_url],
  ['agent returned the listing id', !!listing && (claimed.listing_id === listing.id || String(claimed.listing_url ?? '').includes(listing.id))],
  ['agent returned the listed price', !!listing && Number(claimed.price) === listing.price],
];
const ok = checks.every(([, pass]) => pass);
const seconds = Math.round((Date.now() - t0) / 1000);

writeFileSync(join(outDir, 'transcript.json'), JSON.stringify({
  platform, base: BASE, lot: { ...lot, image_url: lot.image_url?.slice(0, 120) }, goal: task.goal,
  success: run.success, summary: run.summary, result: run.result, blocked: run.blocked, finalUrl: run.finalUrl, ms: run.ms,
  steps: run.steps.map((s) => ({ ...s, screenshot: `step-${String(s.step).padStart(2, '0')}.jpg` })),
  listing: listing ? { ...listing, imageUrl: listing.imageUrl.slice(0, 60) + '…' } : null,
  checks: Object.fromEntries(checks), verified: ok,
}, null, 2));

console.log(`\nAgent: ${run.success ? 'success' : 'failed'} in ${run.steps.length} steps, ${seconds}s. ${run.summary}`);
if (run.blocked.length) console.log(`Safety layer blocked ${run.blocked.length} request(s), e.g. ${run.blocked.slice(0, 3).join('; ')}`);
for (const [label, pass] of checks) console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}`);
if (listing) console.log(`Listing: ${BASE}${listing.mockUrl}  "${listing.title}" £${listing.price} (${listing.condition})`);
console.log(`Transcript: ${join(outDir, 'transcript.json')}`);
process.exit(ok ? 0 : 1);
