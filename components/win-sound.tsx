"use client";
import { useEffect } from 'react';

let context: AudioContext | null = null;
let users = 0;
const played = new Set<string>();
function unlock() {
  context ??= new AudioContext();
  void context.resume().catch(() => {});
}
/** Unlock only after a user gesture; never delay a celebration until a later click. */
export function EnableWinSound() {
  useEffect(() => {
    users++;
    if (users === 1) { window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock); }
    return () => { if (--users === 0) { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); } };
  }, []);
  return null;
}
export function WinSound({ id }: { id: string }) {
  useEffect(() => {
    const audio = context;
    if (!audio || audio.state !== 'running' || played.has(id)) return;
    played.add(id);
    if (played.size > 200) played.delete(played.values().next().value!);
    const nodes: AudioScheduledSourceNode[] = [];
    // A quiet upward whistle followed by three soft sparkling bursts.
    const start = audio.currentTime;
    const whistle = audio.createOscillator(), gain = audio.createGain();
    whistle.type = 'sine'; whistle.frequency.setValueAtTime(480,start); whistle.frequency.exponentialRampToValueAtTime(1500,start+.25);
    gain.gain.setValueAtTime(.001,start); gain.gain.linearRampToValueAtTime(.035,start+.06); gain.gain.exponentialRampToValueAtTime(.001,start+.3);
    whistle.connect(gain).connect(audio.destination); whistle.start(start); whistle.stop(start+.32); nodes.push(whistle);
    for (let i=0;i<3;i++) {
      const t=start+.28+i*.18, buffer=audio.createBuffer(1,Math.floor(audio.sampleRate*.55),audio.sampleRate);
      const data=buffer.getChannelData(0);
      for(let j=0;j<data.length;j++)data[j]=(Math.random()*2-1)*Math.exp(-j/data.length*6);
      const source=audio.createBufferSource(), filter=audio.createBiquadFilter(), volume=audio.createGain();
      source.buffer=buffer;filter.type='highpass';filter.frequency.value=900;
      volume.gain.value=.07;source.connect(filter).connect(volume).connect(audio.destination);source.start(t);nodes.push(source);
    }
    // Let the short cue finish even if the winner overlay turns into the receipt.
    nodes.forEach(node => { node.onended = () => node.disconnect(); });
  }, [id]);
  return null;
}
