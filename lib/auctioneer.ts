// The auctioneer: run-of-sale state machine plus the voice.
// Called by POST /api/sale/[code]/tick, which the auction screen polls, and nudges on every bid,
// just before the hammer, and the moment the clock runs out.
import { OPEN_SECONDS, PRESENT_SECONDS, CALL_SECONDS, startsAt } from '@/lib/sale-timing';
import { db } from '@/lib/db';
import { structured } from '@/lib/llm';
import { createCheckoutForLot } from '@/lib/shopify';
import { findSale, openingBid, saleLots } from '@/lib/sale';
import type { CloseLotResponse, Lot, Sale, SaleBid, SaleMessage, TickResponse } from '@/lib/types';


const SOLD_TICKS = 1;    // one tick to land the result before the next lot

type TickState = { lastTickAt: string; ticksInPhase: number; phase: Sale['phase'] };
const state = new Map<string, TickState>();

function getState(sale: Sale): TickState {
  let s = state.get(sale.id);
  if (!s || s.phase !== sale.phase) {
    s = { lastTickAt: new Date(0).toISOString(), ticksInPhase: 0, phase: sale.phase };
    state.set(sale.id, s);
  }
  return s;
}

const money = (n: number) => `£${Math.round(n)}`;

/** Short spoken name: "Ceramic table lamp" → "lamp". */
function shortName(name: string): string {
  const word = name.trim().split(/\s+/).pop() ?? name;
  return word.toLowerCase();
}

// ── Settling a lot ──────────────────────────────────────────

/**
 * Settle the lot on the block. Callers must already hold the sale lock:
 * `closeLot` takes it for outside callers, and `runTick` already holds it.
 */
async function settleLot(code: string): Promise<CloseLotResponse> {
  const store = db();
  const sale = await findSale(code);
  if (!sale) throw new Error('sale not found');
  if (!sale.current_lot_id) return { winner: null, amount: null, checkoutUrl: null };

  // A lot that has not been offered yet cannot fall. Closing during the
  // introduction used to mark it unsold without anyone getting to bid.
  if (sale.phase !== 'bidding' && sale.phase !== 'sold') {
    return { winner: null, amount: null, checkoutUrl: null };
  }

  const lot = await store.getLot(sale.current_lot_id);
  if (!lot) throw new Error('lot not found');

  // Idempotent: a lot that already fell keeps its result.
  if (lot.status === 'sold' || lot.status === 'unsold') {
    return {
      winner: lot.sold_to,
      amount: lot.sold_for === null ? null : Number(lot.sold_for),
      checkoutUrl: lot.checkout_url,
    };
  }

  const winner = sale.high_bidder;
  const amount = sale.high_bid === null ? null : Number(sale.high_bid);
  let checkoutUrl: string | null = null;

  if (winner && amount) {
    checkoutUrl = await createCheckoutForLot({
      name: lot.name,
      blurb: lot.blurb,
      imageUrl: lot.image_url,
      amount,
      buyerName: winner,
    });
    await store.updateLot(lot.id, {
      status: 'sold',
      sold_to: winner,
      sold_for: amount,
      checkout_url: checkoutUrl,
    });
  } else {
    await store.updateLot(lot.id, { status: 'unsold' });
  }

  // Always 'sold', even for the last lot: the room hears the hammer and sees the winner,
  // and the next tick ends the sale when nothing is queued.
  await store.updateSale(sale.id, { phase: 'sold', lot_ends_at: null });
  return { winner: winner ?? null, amount, checkoutUrl };
}

// ── The voice ───────────────────────────────────────────────

type Ctx = {
  sale: Sale;
  lot: Lot | null;
  event: string;
  secondsLeft: number | null;
  newBids: SaleBid[];
  questions: SaleMessage[];
  remaining: number;
  lotNumber: number;
  opening: number;
};

function cannedSay(c: Ctx): string {
  const lot = c.lot;
  const name = lot?.name ?? 'this lot';
  const short = lot ? shortName(lot.name) : 'lot';
  const high = c.sale.high_bid === null ? null : Number(c.sale.high_bid);
  const leader = c.sale.high_bidder;
  const q = c.questions[0];

  switch (c.sale.phase) {
    case 'presenting': {
      const cond = lot?.condition ? ` Condition: ${lot.condition.toLowerCase()}.` : '';
      return `Lot ${c.lotNumber}, ${name}. ${lot?.blurb ?? ''}${cond} We start at ${money(c.opening)}.`.replace(/\s+/g, ' ').trim();
    }
    case 'bidding': {
      if (q) {
        return `${q.name} asks about the ${short}. ${lot?.blurb ?? 'I will check that with the seller.'}`;
      }
      const latest = c.newBids[c.newBids.length - 1];
      if (latest) {
        return `${money(Number(latest.amount))} from ${latest.bidder}! Do I hear ${money(Number(latest.amount) + 5)}?`;
      }
      if (c.secondsLeft !== null && c.secondsLeft <= CALL_SECONDS + 1) {
        return high && leader
          ? `Going once, going twice at ${money(high)} with ${leader}...`
          : `Last call on the ${short} at ${money(c.opening)}. Anyone?`;
      }
      return high && leader
        ? `${money(high)} with ${leader}. Who is going higher on the ${short}?`
        : `${money(c.opening)} to start on the ${short}. Who will give me ${money(c.opening + 5)}?`;
    }
    case 'sold': {
      const soldFor = lot?.sold_for === null || lot?.sold_for === undefined ? high : Number(lot.sold_for);
      const to = lot?.sold_to ?? leader;
      return to && soldFor
        ? `Sold! The ${name} to ${to} for ${money(soldFor)}. Check your phone for the checkout.`
        : `No takers on the ${name}. That one goes back on the shelf.`;
    }
    case 'ended':
      return `That is the last lot. Thank you all, the room is officially lighter.`;
    case 'idle':
    default:
      return `Take your seats, we are about to begin.`;
  }
}

async function llmSay(c: Ctx): Promise<{ say: string; answeredMessageIds: string[] }> {
  const system = [
    'You are the auctioneer at The Sellout, a live auction of things people found in their own homes.',
    'You are a real auction caller: quick, warm, and specific about the object in front of you.',
    'Name every bidder the moment their bid lands. The lot ends when the room goes quiet: every bid resets a short clock.',
    `When seconds left is ${CALL_SECONDS + 1} or fewer and there are no new bids, say "Going once, going twice" with the amount and leader, nothing else.`,
    'When the hammer falls, say "Sold to <name> for <amount>".',
    'At most two short sentences. Everything you write is spoken aloud, so never write stage directions or emoji.',
    'Answer viewer questions using only the lot blurb and condition you are given. If the answer is not there, say you will check with the seller.',
    'Prices are in pounds sterling. Never invent a fact about the object.',
  ].join(' ');

  const content = [
    `Phase: ${c.sale.phase}`,
    `What just happened: ${c.event}`,
    `Lot ${c.lotNumber}: ${JSON.stringify(c.lot && {
      name: c.lot.name,
      category: c.lot.category,
      condition: c.lot.condition,
      blurb: c.lot.blurb,
      estimate: `${c.lot.low}-${c.lot.high}`,
    })}`,
    `Opening bid: ${c.opening}`,
    `Seconds left: ${c.secondsLeft ?? 'n/a'}`,
    `High bid: ${c.sale.high_bid ?? 'none'} by ${c.sale.high_bidder ?? 'nobody'}`,
    `Bids since you last spoke: ${JSON.stringify(c.newBids.map((b) => ({ bidder: b.bidder, amount: Number(b.amount) })))}`,
    `Unanswered questions: ${JSON.stringify(c.questions.map((m) => ({ id: m.id, name: m.name, text: m.text })))}`,
    `Lots still to come after this one: ${c.remaining}`,
  ].join('\n');

  return structured<{ say: string; answeredMessageIds: string[] }>({
    system,
    content,
    name: 'auctioneer_line',
    maxTokens: 300,
    timeoutMs: 6000, // runs inside the sale lock; the canned line is the fallback
    schema: {
      properties: {
        say: { type: 'string', description: 'What the auctioneer says next, at most two sentences' },
        answeredMessageIds: { type: 'array', items: { type: 'string' }, description: 'ids of the questions you just answered' },
      },
      required: ['say', 'answeredMessageIds'],
    },
  });
}

// ── The tick ────────────────────────────────────────────────

async function runTick(code: string): Promise<TickResponse> {
  const store = db();
  const sale0 = await findSale(code);
  if (!sale0) throw new Error('sale not found');
  let sale = sale0;
  const s = getState(sale);
  const now = Date.now();

  // Waiting for the scheduled start: the screens show the countdown, the auctioneer stays quiet.
  const at = startsAt(sale.id);
  if (sale.phase === 'idle' && (!at || now < Date.parse(at))) return SILENT;

  const lots = await saleLots(sale.id);
  const nextQueued = () => lots.find((l) => l.status === 'queued') ?? null;

  let action: TickResponse['action'] = 'none';
  let event = 'nothing new';

  const present = async (lot: Lot) => {
    await store.updateLot(lot.id, { status: 'live' });
    const patch: Partial<Sale> = {
      phase: 'presenting',
      current_lot_id: lot.id,
      high_bid: null,
      high_bidder: null,
      lot_ends_at: new Date(now + PRESENT_SECONDS * 1000).toISOString(),
    };
    const updated = await store.updateSale(sale.id, patch);
    sale = updated ?? { ...sale, ...patch };
    // Keep the local copy in step so the line below describes the right lot.
    const live = lots.find((l) => l.id === lot.id);
    if (live) live.status = 'live';
    action = 'next_lot';
    event = `bringing up ${lot.name}`;
  };

  const end = async () => {
    const patch: Partial<Sale> = { phase: 'ended', current_lot_id: null, lot_ends_at: null };
    const updated = await store.updateSale(sale.id, patch);
    sale = updated ?? { ...sale, ...patch };
    action = 'end_sale';
    event = 'the sale is over, sign off';
  };

  switch (sale.phase) {
    case 'idle': {
      const first = nextQueued();
      if (first) await present(first);
      else await end();
      break;
    }
    case 'presenting': {
      if (!sale.lot_ends_at || now >= Date.parse(sale.lot_ends_at)) {
        const ends = new Date(now + OPEN_SECONDS * 1000).toISOString();
        const patch: Partial<Sale> = {
          phase: 'bidding',
          lot_ends_at: ends,
          high_bid: null,
          high_bidder: null,
        };
        const updated = await store.updateSale(sale.id, patch);
        sale = updated ?? { ...sale, ...patch };
        action = 'open_bidding';
        event = `bidding is open, ${OPEN_SECONDS} seconds on the clock and every bid keeps it alive`;
      }
      break;
    }
    case 'bidding': {
      if (sale.lot_ends_at && new Date(sale.lot_ends_at).getTime() <= now) {
        const result = await settleLot(code);
        sale = (await findSale(code)) ?? { ...sale, phase: 'sold', lot_ends_at: null };
        action = 'close_lot';
        event = result.winner
          ? `the hammer fell, sold to ${result.winner} for £${result.amount}`
          : 'the hammer fell with no bids';
      }
      break;
    }
    case 'sold': {
      if (s.ticksInPhase >= SOLD_TICKS) {
        const next = nextQueued();
        if (next) await present(next);
        else await end();
      }
      break;
    }
    case 'ended':
    default:
      break;
  }

  // Re-read the lot rather than trusting the list we loaded before the transition,
  // so a lot that just fell reports who won it and for how much.
  const lot = sale.current_lot_id ? await store.getLot(sale.current_lot_id) : null;
  const [questions, newBids] = await Promise.all([
    store.unansweredMessages(sale.id, 3),
    lot ? store.bidsForLotSince(lot.id, s.lastTickAt) : Promise.resolve([] as SaleBid[]),
  ]);

  const ctx: Ctx = {
    sale,
    lot,
    event,
    secondsLeft: sale.lot_ends_at
      ? Math.max(0, Math.round((new Date(sale.lot_ends_at).getTime() - now) / 1000))
      : null,
    newBids,
    questions,
    remaining: lots.filter((l) => l.status === 'queued').length,
    lotNumber: lot ? lots.findIndex((l) => l.id === lot.id) + 1 : 0,
    opening: openingBid(lot),
  };

  let say: string;
  let answeredMessageIds: string[];
  // "Going once, going twice" has seconds to land; a model round trip would put it on top of the hammer.
  const lastCall = sale.phase === 'bidding' && !newBids.length && !questions.length
    && ctx.secondsLeft !== null && ctx.secondsLeft <= CALL_SECONDS + 1;
  if (lastCall || process.env.MOCK_AUCTIONEER === '1' || !process.env.OPENAI_API_KEY) {
    say = cannedSay(ctx);
    answeredMessageIds = ctx.questions.map((m) => m.id);
  } else {
    try {
      ({ say, answeredMessageIds } = await llmSay(ctx));
      if (!say?.trim()) throw new Error('empty line');
    } catch (e) {
      console.warn('auctioneer line failed, using canned:', e);
      say = cannedSay(ctx);
      answeredMessageIds = ctx.questions.map((m) => m.id);
    }
  }

  if (answeredMessageIds.length) {
    await store.markAnswered(answeredMessageIds);
  }

  const next = getState(sale);
  next.ticksInPhase += 1;
  next.lastTickAt = new Date(now).toISOString();

  return { say, action, answeredMessageIds };
}

// ── One thing at a time, per sale ───────────────────────────
//
// Two ticks landing together used to double-advance the phase and speak two
// lines over each other. Closing went around that lock entirely, so a tick and
// a hammer could run at once and the auctioneer would invite bids on a lot that
// had just sold. Both paths now queue on the same chain.

const queue = new Map<string, Promise<unknown>>();
/** Incremented synchronously on entry, so a racing caller sees it immediately. */
const waiting = new Map<string, number>();

function withSaleLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  waiting.set(key, (waiting.get(key) ?? 0) + 1);
  const prev = queue.get(key) ?? Promise.resolve();
  const release = () => {
    const n = (waiting.get(key) ?? 1) - 1;
    if (n <= 0) waiting.delete(key);
    else waiting.set(key, n);
  };
  const run = prev.then(fn, fn).finally(release);
  // Keep the chain alive even if this link rejects.
  queue.set(key, run.then(NOOP, NOOP));
  return run;
}

const NOOP = () => {};

const SILENT: TickResponse = { say: '', action: 'none', answeredMessageIds: [] };

export async function tick(code: string): Promise<TickResponse> {
  const key = code.toUpperCase();
  // Something is already working on this sale, very possibly the hammer.
  // Stay quiet rather than queue up and then speak a line about a lot that
  // has since sold.
  if (waiting.get(key)) return SILENT;

  return withSaleLock(key, async () => {
    const out = await runTick(key);
    // While we were composing that line, something else joined the queue —
    // almost always the hammer. Whatever we just wrote is about to be
    // contradicted, so keep the phase change and drop the words.
    if ((waiting.get(key) ?? 0) > 1) return { ...out, say: '' };
    return out;
  });
}

/** The hammer. Waits its turn rather than dropping: settlement is authoritative. */
export async function closeLot(code: string): Promise<CloseLotResponse> {
  return withSaleLock(code.toUpperCase(), () => settleLot(code));
}

/** End the entire sale: honor the live winning bid, leave unoffered items unsold. */
export async function endSale(code: string): Promise<void> {
  await withSaleLock(code.toUpperCase(), async () => {
    const sale = await findSale(code);
    if (!sale) throw new Error('sale not found');
    if (sale.phase === 'ended') return;
    if (sale.phase === 'bidding') await settleLot(code);
    const store = db();
    for (const lot of await saleLots(sale.id)) {
      if (lot.status === 'queued' || lot.status === 'live') await store.updateLot(lot.id, {status:'unsold'});
    }
    await store.updateSale(sale.id, {phase:'ended',lot_ends_at:null});
  });
}
