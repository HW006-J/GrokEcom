import { WinSound } from './win-sound';
import { SaleConfetti } from './sale-confetti';
import { gbp, type Lot } from '@/lib/types';

export function SaleReceipt({ lot, mine = false }: { lot: Lot; mine?: boolean }) {
  return <article className="sale-receipt" aria-label={`Sale confirmation for ${lot.name}`}>
    <WinSound id={lot.id}/><SaleConfetti id={lot.id}/>
    <div className="receipt-top">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {lot.image_url && <img src={lot.image_url} alt={lot.name} />}
      <h3>{lot.sold_to} has won the item</h3>
      <p>{lot.name}</p>
    </div>
    <dl className="receipt-details">
      <div><dt>Lot reference</dt><dd>{lot.id.slice(0, 8).toUpperCase()}</dd></div>
      <div><dt>Winning bid</dt><dd>{gbp(Number(lot.sold_for ?? 0))}</dd></div>
      <div className="receipt-buyer"><dt>Winner</dt><dd>{lot.sold_to}</dd></div>
    </dl>
    <div className="receipt-bottom">
      <span>Auction confirmed · payment pending</span>
      {mine && lot.checkout_url && <a className="pill pill--primary" href={lot.checkout_url} target="_blank" rel="noreferrer">Complete payment</a>}
    </div>
  </article>;
}
