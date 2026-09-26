"use client";

import { useEffect, useRef } from 'react';

const celebrated = new Set<string>();

export function SaleConfetti({ id }: { id: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const node = canvas.current;
    if (!node || celebrated.has(id) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = node.getContext('2d');
    if (!ctx) return;
    const width = node.clientWidth, height = node.clientHeight;
    const ratio = Math.min(devicePixelRatio, 2);
    node.width = width * ratio; node.height = height * ratio;
    ctx.scale(ratio, ratio);
    const colors = ['#7465ef', '#4267df', '#b5c5f5', '#d1c5ff'];
    const particles = Array.from({ length: 65 }, (_, i) => ({
      x: width / 2, y: height * .55,
      vx: (Math.random() - .5) * 320, vy: -160 - Math.random() * 300,
      angle: Math.random() * Math.PI, spin: (Math.random() - .5) * 9,
      size: 4 + Math.random() * 5, color: colors[i % colors.length],
    }));
    let raf = 0, start = 0, last = 0;
    const draw = (time: number) => {
      if (!start) {
        if (celebrated.has(id)) return;
        celebrated.add(id);
        if (celebrated.size > 200) celebrated.delete(celebrated.values().next().value!);
        start = time;
      }
      const elapsed = (time - start) / 1000;
      const dt = Math.min(.032, (time - (last || time)) / 1000);
      last = time;
      ctx.clearRect(0, 0, width, height);
      if (elapsed > 3.2) return;
      ctx.globalAlpha = Math.min(1, (3.2 - elapsed) / .8);
      for (const p of particles) {
        p.vy += 210 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.angle += p.spin * dt;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle); ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * .65); ctx.restore();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ctx.clearRect(0, 0, width, height); };
  }, [id]);
  return <canvas ref={canvas} className="sale-confetti" aria-hidden="true" />;
}
