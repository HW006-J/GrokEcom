"use client";
import { useEffect, useRef, useState } from 'react';
import { gbp, type ScannedObject } from '@/lib/mock';
import { Check, Pause, Play } from '@/components/icons';
export function ObjectCloud({ objects, onSelect, onInspect, onGenerate, generating }: {
  objects: ScannedObject[]; onSelect: (item: ScannedObject) => void; onInspect: (id: string) => void;
  onGenerate: () => void; generating: boolean;
}) {
  const [paused, setPaused] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const phase = useRef(0);
  useEffect(() => {
    let raf = 0, last = 0;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const frame = (time: number) => {
      const node = stage.current;
      if (node) {
        if (!paused && !reduced.matches && !node.matches(':hover, :focus-within') && !document.hidden) phase.current += Math.min(32, time - (last || time)) * .00012;
        const w = node.clientWidth, h = node.clientHeight;
        [...node.children].forEach((child, i) => {
          const angle = phase.current + i / Math.max(objects.length, 1) * Math.PI * 2 - Math.PI / 2;
          const el = child as HTMLElement;
          const radius = objects.length === 1 ? 0 : Math.min(w * .32, h * .32);
          el.style.transform = `translate(${w/2 + Math.cos(angle)*radius - 52}px, ${h/2 + Math.sin(angle)*radius - 70}px)`;
        });
      }
      last = time; raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame); return () => cancelAnimationFrame(raf);
  }, [objects.length, paused]);
  return <section className="orbit-view">
    <div className="orbit-toolbar"><button onClick={onGenerate} disabled={generating || !objects.length}>{generating ? 'Creating images…' : 'Generate images'}</button><button className="icon-btn icon-btn--light" aria-label={paused ? 'Resume motion' : 'Pause motion'} onClick={() => setPaused(!paused)}>{paused ? <Play/> : <Pause/>}</button></div>
    <div className="orbit-stage" ref={stage} aria-label="Objects in orbit">{objects.map(item => <div className="orbit-item" key={item.id}>
      <button className="orbit-pick" aria-label={`${item.picked ? 'Deselect' : 'Select'} ${item.name}`} aria-pressed={item.picked} onClick={() => onSelect(item)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.generatedImage || item.image} alt="" draggable={false}/>
        <span className="orbit-check">{item.picked ? <Check size={15}/> : '+'}</span>
      </button>
      <button className="orbit-name" onClick={() => onInspect(item.id)}>{item.name}</button>
      <span className="orbit-price">{item.low ? gbp(item.low) : ''}</span>
    </div>)}</div>
    {objects.some(o => o.generatedImage) && <p className="orbit-note">AI previews · originals in Photo</p>}
  </section>;
}
