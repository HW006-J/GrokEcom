"use client";
import { useEffect, useRef, useState } from 'react';
import type { Lot } from '@/lib/types';
import { Pause, Play } from './icons';

export function WaitingOrbit({lots}:{lots:Lot[]}) {
  const stage=useRef<HTMLDivElement>(null);
  const phase=useRef(0);
  const drag=useRef<number|null>(null);
  const [paused,setPaused]=useState(false);
  useEffect(()=>{
    let raf=0,last=0;
    const reduce=matchMedia('(prefers-reduced-motion: reduce)');
    const frame=(time:number)=>{
      const el=stage.current;
      if(el){
        if(!paused&&!reduce.matches&&!document.hidden&&drag.current===null)phase.current+=Math.min(32,time-(last||time))*.00018;
        const w=el.clientWidth,h=el.clientHeight;
        Array.from(el.children).forEach((child,i)=>{
          const n=lots.length;
          const y=n===1?0:1-2*(i+.5)/n;
          const radius=Math.sqrt(1-y*y);
          const angle=i*2.399963+phase.current;
          const depth=Math.sin(angle)*radius;
          const size=n===1?Math.min(210,w*.48,h*.7):n<=3?140:90;
          const x=n===1?Math.sin(phase.current)*w*.12:Math.cos(angle)*radius*(w*.5-size*.55);
          const item=child as HTMLElement;
          item.style.width=`${size}px`;item.style.height=`${size}px`;
          item.style.transform=`translate(${w/2+x-size/2}px,${h/2+y*(h*.5-size*.65)-size/2}px) scale(${.85+(depth+1)*.14}) rotate(${Math.sin(angle)*4}deg)`;
          item.style.zIndex=String(Math.round((depth+1)*20));
        });
      }
      last=time;raf=requestAnimationFrame(frame);
    };
    raf=requestAnimationFrame(frame);return()=>cancelAnimationFrame(raf);
  },[lots.length,paused]);
  return <section className="waiting-cloud" aria-label="Items in this auction">
    <div className="waiting-cloud-stage" ref={stage} onPointerDown={e=>{drag.current=e.clientX;e.currentTarget.setPointerCapture(e.pointerId)}} onPointerMove={e=>{if(drag.current!==null){phase.current+=(e.clientX-drag.current)*.012;drag.current=e.clientX}}} onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}}>
      {lots.map(lot=><div className="waiting-cloud-object" key={lot.id} title={lot.name}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {lot.preview_generated ? <img src={lot.image_url} alt={lot.name} draggable={false}/> : <div className="orbit-generating" role="status"><span/><small>{lot.name}</small></div>}
      </div>)}
      {!lots.length&&<p>Items will appear here.</p>}
    </div>
    <div className="waiting-cloud-controls"><span>Drag to spin</span><button aria-label={paused?'Resume objects':'Pause objects'} onClick={()=>setPaused(!paused)}>{paused?<Play size={16}/>:<Pause size={16}/>}</button></div>
  </section>;
}
