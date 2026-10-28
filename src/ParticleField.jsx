import { useEffect, useRef } from 'react';

export default function ParticleField() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w = (canvas.width = window.innerWidth);
    let h = (canvas.height = window.innerHeight);

    const mouse = { x: -1000, y: -1000 };

    const particles = Array.from({ length: 55 }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.7,
      vy: (Math.random() - 0.5) * 0.7,
      r: Math.random() * 2.5 + 1,
      alpha: Math.random() * 0.5 + 0.25,
      baseAlpha: Math.random() * 0.5 + 0.25,
    }));

    const onMove = (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };
    window.addEventListener('mousemove', onMove);

    let animId;
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      // Connections
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 140) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(245, 210, 87, ${0.1 * (1 - dist / 140)})`;
            ctx.lineWidth = 0.6;
            ctx.stroke();
          }
        }
      }
      // Particles with mouse interaction
      for (const p of particles) {
        const dx = mouse.x - p.x;
        const dy = mouse.y - p.y;
        const distMouse = Math.sqrt(dx * dx + dy * dy);
        if (distMouse < 200) {
          const force = (200 - distMouse) / 200;
          p.vx += (dx / distMouse) * force * 0.04;
          p.vy += (dy / distMouse) * force * 0.04;
          p.alpha = p.baseAlpha + force * 0.35;
        } else {
          p.alpha = p.baseAlpha;
        }
        // Gentle drift
        p.vx += (Math.random() - 0.5) * 0.02;
        p.vy += (Math.random() - 0.5) * 0.02;
        // Damping
        p.vx *= 0.98;
        p.vy *= 0.98;
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(245, 210, 87, ${p.alpha})`;
        ctx.fill();
      }
      animId = requestAnimationFrame(draw);
    };
    draw();

    const onResize = () => {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-0 pointer-events-none opacity-50"
      aria-hidden="true"
    />
  );
}
