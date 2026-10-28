import { useEffect, useRef, useState } from 'react';

export default function AnimatedGraph({ data = [], color = '#ffe066', label = 'Pool Growth' }) {
  const canvasRef = useRef(null);
  const [animatedData, setAnimatedData] = useState(data.map(() => 0));

  useEffect(() => {
    let start = null;
    const duration = 1400;
    const animate = (timestamp) => {
      if (!start) start = timestamp;
      const progress = Math.min((timestamp - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setAnimatedData(data.map((v) => v * eased));
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [data]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || animatedData.length < 2) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.clientWidth * 2;
    const h = canvas.height = canvas.clientHeight * 2;
    ctx.scale(2, 2);

    const max = Math.max(...animatedData, 1);
    const min = Math.min(...animatedData);
    const range = max - min || 1;
    const padding = { top: 10, right: 20, bottom: 30, left: 40 };
    const chartW = canvas.clientWidth - padding.left - padding.right;
    const chartH = canvas.clientHeight - padding.top - padding.bottom;

    // Gradient fill
    const grad = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
    grad.addColorStop(0, color + '40');
    grad.addColorStop(1, color + '05');

    const points = animatedData.map((v, i) => ({
      x: padding.left + (i / (animatedData.length - 1)) * chartW,
      y: padding.top + chartH - ((v - min) / range) * chartH,
    }));

    // Area fill
    ctx.beginPath();
    ctx.moveTo(points[0].x, padding.top + chartH);
    points.forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.lineTo(points[points.length - 1].x, padding.top + chartH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Points
    points.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#0b0e11';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }, [animatedData, color]);

  return (
    <div className="w-full h-48 rounded-2xl overflow-hidden bg-[var(--color-surface-elevated-dark)] border border-[var(--color-hairline-dark)] p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold text-white tracking-tight">{label}</span>
        <span className="text-[10px] text-[var(--color-muted-strong)] tracking-wide">Real-time trend</span>
      </div>
      <canvas ref={canvasRef} className="w-full h-32" />
    </div>
  );
}
