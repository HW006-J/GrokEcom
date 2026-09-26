"use client";

import { useEffect, useRef, type RefObject } from "react";

/** The canvas is the fallback; supported browsers display its live video stream. */
export function TalkingAuctioneer({ analyser, speaking }: { analyser: RefObject<AnalyserNode | null>; speaking: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const active = useRef(speaking);
  useEffect(() => { active.current = speaking; }, [speaking]);
  useEffect(() => {
    const surface = canvas.current;
    if (!surface) return;
    const ctx = surface.getContext("2d");
    if (!ctx) return;
    const portrait = new Image();
    let frame = 0, disposed = false, stream: MediaStream | undefined;
    const samples = new Uint8Array(512);
    let opening = 0, last = 0;
    portrait.src = "/images/auctioneer.png";
    portrait.onload = () => {
      if (disposed) return;
      surface.width = 900; surface.height = 900;
      const draw = (time: number) => {
        if (time - last >= 32) {
          last = time;
          let energy = 0;
          const node = analyser.current;
          if (active.current && node) {
            node.getByteTimeDomainData(samples);
            for (const value of samples) energy += ((value - 128) / 128) ** 2;
            energy = Math.sqrt(energy / samples.length);
          }
          const target = active.current ? Math.min(1, Math.max(0, (energy - .012) * 9)) : 0;
          opening += (target - opening) * .55;
          ctx.clearRect(0, 0, 900, 900);
          ctx.drawImage(portrait, 0, 0, 900, 900);
          // Coordinates follow this portrait's upward-curving smile. The corners
          // remain anchored while the lower lip opens with the voice envelope.
          if (opening > .025) {
            ctx.save();
            ctx.scale(900 / 1254, 900 / 1254);
            const gap = opening * 36;
            ctx.beginPath();
            ctx.moveTo(594, 586);
            ctx.bezierCurveTo(637, 607, 722, 581, 754, 549);
            ctx.bezierCurveTo(728, 584 + gap, 640, 609 + gap, 594, 586);
            ctx.closePath();
            ctx.fillStyle = "#48251e"; ctx.fill();
            ctx.save(); ctx.clip();
            ctx.beginPath(); ctx.moveTo(599, 587);
            ctx.bezierCurveTo(644, 602, 724, 579, 752, 553);
            ctx.lineTo(749, 560 + gap * .15);
            ctx.bezierCurveTo(709, 591 + gap * .12, 640, 612, 599, 592);
            ctx.fillStyle = "#ede0cc"; ctx.fill();
            ctx.restore();
            ctx.beginPath(); ctx.moveTo(597, 589);
            ctx.bezierCurveTo(643, 610 + gap, 727, 585 + gap, 753, 553);
            ctx.strokeStyle = "#ae7152"; ctx.lineWidth = 3; ctx.stroke();
            ctx.restore();
          }
        }
        frame = requestAnimationFrame(draw);
      };
      frame = requestAnimationFrame(draw);
      if (surface.captureStream && video.current) {
        stream = surface.captureStream(30);
        video.current.srcObject = stream;
        void video.current.play().then(() => {
          if (!disposed && video.current) video.current.style.opacity = "1";
        }).catch(() => {});
      }
    };
    return () => {
      disposed = true; cancelAnimationFrame(frame);
      stream?.getTracks().forEach(track => track.stop());
      if (video.current) video.current.srcObject = null;
    };
  }, [analyser]);
  return <div className="talking-portrait" role="img" aria-label="Animated auctioneer">
    <canvas ref={canvas} className="character-portrait"/>
    <video ref={video} className="character-portrait talking-video" muted autoPlay playsInline aria-hidden="true"/>
  </div>;
}
