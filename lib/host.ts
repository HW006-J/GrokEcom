// Run-of-show state machine + host brain. Called by /api/host/tick (stage page polls every ~8s).
import { supabaseServer } from '@/lib/supabase';
import { structured } from '@/lib/llm';
import { createDraftOrderInvoice, shopifyConfigured } from '@/lib/shopify';
import type { Bid, HostAction, HostTickResponse, Item, Message, Show, AuctionCloseResponse } from '@/lib/types';

const AUCTION_SECONDS = 60;
const QA_TICKS = 2;

type TickState = { lastTickAt: string; ticksInPhase: number; phase: Show['phase'] };
const state = new Map<string, TickState>();

function getState(show: Show): TickState {
  let s = state.get(show.id);
  if (!s || s.phase !== show.phase) {
    s = { lastTickAt: new Date(0).toISOString(), ticksInPhase: 0, phase: show.phase };
    state.set(show.id, s);
  }
  return s;
}

export async function closeAuction(showId: string): Promise<AuctionCloseResponse> {
  const db = supabaseServer();
  const { data: show } = await db.from('shows').select('*').eq('id', showId).single<Show>();
  if (!show) throw new Error('show not found');
  if (!show.current_item_id) return { winner: null, amount: null, invoiceUrl: null };
  const { data: item } = await db.from('items').select('*').eq('id', show.current_item_id).single<Item>();
  if (!item) throw new Error('item not found');

  const winner = show.high_bidder_name;
  const amount = show.high_bid === null ? null : Number(show.high_bid);
  let invoiceUrl: string | null = null;

  if (winner && amount) {
    if (shopifyConfigured() && item.shopify_variant_id) {
      try {
        invoiceUrl = await createDraftOrderInvoice({
          variantId: item.shopify_variant_id,
          amount,
          buyerName: winner,
          itemTitle: item.title,
        });
      } catch (e) {
        console.warn('draft order failed:', e);
      }
    }
    await db.from('items').update({ status: 'sold', sold_to: winner, invoice_url: invoiceUrl }).eq('id', item.id);
  } else {
    await db.from('items').update({ status: 'unsold' }).eq('id', item.id);
  }
  await db.from('shows').update({ phase: 'closed', auction_ends_at: null }).eq('id', show.id);
  return { winner: winner ?? null, amount, invoiceUrl };
}

type Ctx = {
  show: Show;
  item: Item | null;
  event: string; // what just happened, for the host to react to
  secondsLeft: number | null;
  newBids: Bid[];
  questions: Message[];
  remaining: number;
};

function mockSay(c: Ctx): string {
  const t = c.item?.title ?? 'this piece';
  const q = c.questions[0];
  const bid = c.show.high_bid ? `£${c.show.high_bid} from ${c.show.high_bidder_name}` : 'no bids yet';
  switch (c.show.phase) {
    case 'intro':
      return `Next up: ${t} by ${c.item?.brand ?? 'unknown'}, size ${c.item?.size ?? '?'}, condition ${c.item?.condition ?? 'good'}. ${c.item?.description ?? ''}`;
    case 'qa':
      return q
        ? `${q.name} asks "${q.text}". Based on the listing: ${c.item?.description ?? 'see the card'}. Any more questions before we open bidding?`
        : `Ask me anything about the ${t}: fit, fabric, wear. Scan the QR to get in on the bidding.`;
    case 'auction':
      if (c.newBids.length) return `${c.newBids[c.newBids.length - 1].bidder_name} bids £${c.newBids[c.newBids.length - 1].amount} on the ${t}! ${c.secondsLeft} seconds left, who is going higher?`;
      return `Bidding is open on the ${t}, currently ${bid}. ${c.secondsLeft} seconds on the clock, tap bid on your phone!`;
    case 'closed':
      return c.show.high_bidder_name
        ? `Sold! The ${t} goes to ${c.show.high_bidder_name} for £${c.show.high_bid}. Check your phone for the checkout link.`
        : `No bids on the ${t} this time, it stays in the wardrobe.`;
    case 'ended':
      return `That's the show! Thanks for shopping my wardrobe, follow for the next drop.`;
    default:
      return `Welcome to the live drop, we are about to start.`;
  }
}

async function llmSay(c: Ctx): Promise<{ say: string; answeredMessageIds: string[] }> {
  const system = `You are Cara, the host of a live second-hand fashion show. Upbeat, warm, concise: at most 2 short sentences, spoken aloud. Answer audience questions using ONLY the item JSON; if the answer is not there say you'll check with the seller. Call bidders by name. During an auction keep the energy up; in the last 15 seconds hard-sell and count down. Prices are in pounds. Never invent facts.`;
  const content = `Phase: ${c.show.phase}\nEvent: ${c.event}\nItem: ${JSON.stringify(c.item)}\nSeconds left: ${c.secondsLeft ?? 'n/a'}\nHigh bid: ${c.show.high_bid ?? 'none'} by ${c.show.high_bidder_name ?? 'nobody'}\nNew bids since last check: ${JSON.stringify(c.newBids.map((b) => ({ name: b.bidder_name, amount: b.amount })))}\nUnanswered questions: ${JSON.stringify(c.questions.map((m) => ({ id: m.id, name: m.name, text: m.text })))}\nItems remaining after this one: ${c.remaining}`;
  return structured<{ say: string; answeredMessageIds: string[] }>({
    system,
    content,
    name: 'host_line',
    maxTokens: 300,
    schema: {
      properties: {
        say: { type: 'string', description: 'What the host says next, max 2 sentences' },
        answeredMessageIds: { type: 'array', items: { type: 'string' }, description: 'ids of questions you answered' },
      },
      required: ['say', 'answeredMessageIds'],
    },
  });
}

export async function tick(showId: string): Promise<HostTickResponse> {
  const db = supabaseServer();
  const { data: show0 } = await db.from('shows').select('*').eq('id', showId).single<Show>();
  if (!show0) throw new Error('show not found');
  let show = show0;
  const s = getState(show);
  const now = Date.now();

  const { data: items } = await db.from('items').select('*').eq('show_id', showId).order('sort_order');
  const all = (items ?? []) as Item[];
  const nextListed = () => all.find((i) => i.status === 'listed') ?? null;

  let action: HostAction = 'none';
  let event = 'nothing new';

  const startItem = async (item: Item) => {
    await db.from('items').update({ status: 'live' }).eq('id', item.id);
    const { data } = await db
      .from('shows')
      .update({ phase: 'intro', current_item_id: item.id, high_bid: null, high_bidder_name: null, auction_ends_at: null })
      .eq('id', showId)
      .select('*')
      .single<Show>();
    show = data ?? show;
    action = 'next_item';
    event = `starting to present ${item.title}`;
  };

  switch (show.phase) {
    case 'idle': {
      const first = nextListed();
      if (first) await startItem(first);
      else {
        await db.from('shows').update({ phase: 'ended' }).eq('id', showId);
        show = { ...show, phase: 'ended' };
      }
      break;
    }
    case 'intro': {
      if (s.ticksInPhase >= 1) {
        await db.from('shows').update({ phase: 'qa' }).eq('id', showId);
        show = { ...show, phase: 'qa' };
        event = 'opened Q&A, invite questions';
      }
      break;
    }
    case 'qa': {
      if (s.ticksInPhase >= QA_TICKS) {
        const ends = new Date(now + AUCTION_SECONDS * 1000).toISOString();
        await db.from('shows').update({ phase: 'auction', auction_ends_at: ends, high_bid: null, high_bidder_name: null }).eq('id', showId);
        show = { ...show, phase: 'auction', auction_ends_at: ends, high_bid: null, high_bidder_name: null };
        action = 'start_auction';
        event = `auction just opened, ${AUCTION_SECONDS} seconds`;
      }
      break;
    }
    case 'auction': {
      if (show.auction_ends_at && new Date(show.auction_ends_at).getTime() <= now) {
        const result = await closeAuction(showId);
        show = { ...show, phase: 'closed', auction_ends_at: null };
        action = 'close_auction';
        event = result.winner ? `auction closed, sold to ${result.winner} for £${result.amount}` : 'auction closed with no bids';
      }
      break;
    }
    case 'closed': {
      const next = nextListed();
      if (next) await startItem(next);
      else {
        await db.from('shows').update({ phase: 'ended', current_item_id: null }).eq('id', showId);
        show = { ...show, phase: 'ended' };
        event = 'show is over, sign off';
      }
      break;
    }
    case 'ended':
    default:
      break;
  }

  const item = show.current_item_id ? all.find((i) => i.id === show.current_item_id) ?? null : null;
  const [{ data: questions }, { data: newBids }] = await Promise.all([
    db.from('messages').select('*').eq('show_id', showId).eq('answered', false).order('created_at').limit(3),
    item
      ? db.from('bids').select('*').eq('item_id', item.id).gt('created_at', s.lastTickAt).order('created_at')
      : Promise.resolve({ data: [] as Bid[] }),
  ]);

  const ctx: Ctx = {
    show,
    item,
    event,
    secondsLeft: show.auction_ends_at ? Math.max(0, Math.round((new Date(show.auction_ends_at).getTime() - now) / 1000)) : null,
    newBids: (newBids ?? []) as Bid[],
    questions: (questions ?? []) as Message[],
    remaining: all.filter((i) => i.status === 'listed').length,
  };

  let say: string;
  let answeredMessageIds: string[];
  if (process.env.MOCK_HOST === '1' || !process.env.OPENAI_API_KEY) {
    say = mockSay(ctx);
    answeredMessageIds = ctx.questions.map((m) => m.id);
  } else {
    try {
      ({ say, answeredMessageIds } = await llmSay(ctx));
    } catch (e) {
      console.warn('llm tick failed, using mock line:', e);
      say = mockSay(ctx);
      answeredMessageIds = ctx.questions.map((m) => m.id);
    }
  }
  if (answeredMessageIds.length) {
    await db.from('messages').update({ answered: true }).in('id', answeredMessageIds);
  }

  // advance in-memory tick state
  const next = getState(show);
  next.ticksInPhase += 1;
  next.lastTickAt = new Date(now).toISOString();

  return { say, action, answeredMessageIds };
}
