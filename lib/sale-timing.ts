// How long things take. Shared by the server (auctioneer, bid route) and both screens.

/** Bidding opens with this long on the clock. */
export const OPEN_SECONDS = 12;
/** Every bid puts the clock back to at least this, so a lot ends when the room goes quiet. */
export const QUIET_SECONDS = 7;
/** "Going once, going twice" lands this many seconds before the hammer. */
export const CALL_SECONDS = 4;
/** The lot is introduced for this long before bidding opens. */
export const PRESENT_SECONDS = 5;

/** Length of the current bidding window, for progress bars: the opening stretch, then quiet windows. */
export const windowSeconds = (highBid: number | null | undefined) =>
  highBid === null || highBid === undefined ? OPEN_SECONDS : QUIET_SECONDS;

// When the host scheduled the sale to begin. Mirrors the single-process sale storage lifetime.
const starts = new Map<string, string>();
export const startsAt = (saleId: string) => starts.get(saleId) ?? null;
export function setStartsAt(saleId: string, iso: string) { starts.set(saleId, iso); }
