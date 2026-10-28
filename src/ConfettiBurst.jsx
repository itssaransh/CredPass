import { useEffect } from 'react';
import confetti from 'canvas-confetti';

export default function ConfettiBurst({ trigger, duration = 2000 }) {
  useEffect(() => {
    if (!trigger) return;
    const end = Date.now() + duration;
    const colors = ['#ffe066', '#fcd535', '#f0b90b', '#0b0e11', '#0ea17d', '#f6465d'];
    const interval = setInterval(() => {
      if (Date.now() > end) {
        clearInterval(interval);
        return;
      }
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
        colors,
        disableForReducedMotion: true,
      });
    }, 250);
    return () => clearInterval(interval);
  }, [trigger, duration]);
  return null;
}
