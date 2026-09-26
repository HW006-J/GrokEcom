"use client";
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import styles from './marketplace.module.css';
import { gbp } from '@/lib/types';

type Listing = { id:string; platform:string; title:string; price:number; condition?:string; imageUrl:string; steps:string[] };
export default function MockMarketplace({params}:{params:Promise<{platform:string}>}) {
  const {platform} = use(params);
  const [listing,setListing] = useState<Listing|null>(null);
  const [status,setStatus] = useState('Loading listing…');
  useEffect(()=>{
    let alive=true;
    const id=new URLSearchParams(location.search).get('listing');
    fetch('/api/mock-listings').then(r=>{if(!r.ok)throw Error();return r.json()}).then(data=>{
      if(!alive)return;
      const match=data.listings.find((l:Listing)=>l.id===id&&l.platform===platform);
      setListing(match??null);setStatus(match?'':'Demo listing not found. It may have expired after a server restart.');
    }).catch(()=>{if(alive)setStatus('Could not load this demo listing. Refresh to retry.');});
    return ()=>{alive=false};
  },[platform]);
  const ebay=platform==='ebay';
  if(!['ebay','marketplace'].includes(platform))return <main className="shell" style={{padding:24}}>Unknown demo marketplace.<Link href="/dashboard">Back to dashboard</Link></main>;
  return <main className={styles.workspace} data-market={platform}>
    <header className={styles.header}><Link href="/dashboard" className={ebay?styles.ebay:styles.facebook}>{ebay?'ebay':'f'}</Link><span className={styles.search}>Search {ebay?'eBay':'Facebook'}</span><strong className={styles.headerTitle}>Marketplace</strong><span className={styles.demo}>Demo · local only</span></header>
    <div className={styles.detailMain}><Link href="/dashboard" className={styles.back} aria-label="Back to dashboard"><svg width="12" height="22" viewBox="0 0 12 22" fill="none" aria-hidden="true"><path d="M10 2 2 11l8 9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg><span>Dashboard</span></Link>
    {!listing?<p role="status">{status}</p>:<>
      <div className={styles.previewCard}><div className={styles.previewImage}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {listing.imageUrl&&<img src={listing.imageUrl} alt={listing.title}/>}
      </div><div className={styles.previewDetails}><span className={styles.success}>Published in demo</span><h2>{listing.title}</h2><p className={styles.price}>{gbp(listing.price)}</p><p className={styles.muted}>Listed just now · London</p><hr/><h3>Details</h3><p>Condition <strong>{listing.condition||'Used — good'}</strong></p><p className={styles.muted}>No real listing or payment. This is your local marketplace preview.</p><div className={styles.map}>London<span>⌖</span><small>Approximate location</small></div><h3>Seller information</h3><div className={styles.seller}><span className={styles.avatar}>S</span><div><strong>The Sellout</strong><small>Demo seller</small></div></div></div></div>
      <details className={styles.activity}><summary>Browser-agent activity</summary><ol>{listing.steps.map((step,i)=><li key={i}>{step}</li>)}</ol></details>
    </>}
    </div>
  </main>;
}
