// The auctioneer: run-of-sale state machine plus the voice.
// Called by POST /api/sale/[code]/tick, which the auction screen polls every ~8s.
import { db } from '@/lib/db';
import { structured } from '@/lib/llm';
import { createCheckoutForLot } from '@/lib/shopify';
import { findSale, openingBid, saleLots } from '@/lib/sale';
import type { CloseLotResponse, Lot, Sale, SaleBid, SaleMessage, TickResponse } from '@/lib/types';

const BIDDING_SECONDS = 30;
const PRESENT_TICKS = 1; // one tick to introduce the lot before bidding opens
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

export async function closeLot(code: string): Promise<CloseLotResponse> {
  const store = db();
  const sale = await findSale(code);
  if (!sale) throw new Error('sale not found');
  if (!sale.current_lot_id) return { winner: null, amount: null, checkoutUrl: null };

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
      if (c.secondsLeft !== null && c.secondsLeft <= 10) {
        return high && leader
          ? `Going once at ${money(high)} with ${leader}. Last chance on the ${short}.`
          : `Ten seconds on the ${short} and not a single bid. Someone take it home.`;
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
    'Name every bidder the moment their bid lands. In the last ten seconds, count it down with "going once" and "going twice".',
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
      lot_ends_at: null,
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
      if (s.ticksInPhase >= PRESENT_TICKS) {
        const ends = new Date(now + BIDDING_SECONDS * 1000).toISOString();
        const patch: Partial<Sale> = {
          phase: 'bidding',
          lot_ends_at: ends,
          high_bid: null,
          high_bidder: null,
        };
        const updated = await store.updateSale(sale.id, patch);
        sale = updated ?? { ...sale, ...patch };
        action = 'open_bidding';
        event = `bidding is open, ${BIDDING_SECONDS} seconds on the clock`;
      }
      break;
    }
    case 'bidding': {
      if (sale.lot_ends_at && new Date(sale.lot_ends_at).getTime() <= now) {
        const result = await closeLot(code);
        sale = { ...sale, phase: 'sold', lot_ends_at: null };
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
  if (process.env.MOCK_AUCTIONEER === '1' || !process.env.OPENAI_API_KEY) {
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

// Two ticks landing together used to double-advance the phase and speak two
// lines over each other, which is what made the auctioneer sound garbled.
// One tick per sale at a time; a tick that arrives mid-flight is dropped
// with an empty line so the caller stays quiet rather than talking twice.
const inflight = new Map<string, Promise<TickResponse>>();

export async function tick(code: string): Promise<TickResponse> {
  const key = code.toUpperCase();
  if (inflight.has(key)) return { say: '', action: 'none', answeredMessageIds: [] };
  const run = runTick(key).finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}
