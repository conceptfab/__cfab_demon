import { useEffect, useState } from 'react';
import logoSrc from '@/assets/logo.png';

export function SplashScreen() {
  const [visible, setVisible] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFadeOut(true), 900);
    const hideTimer = setTimeout(() => setVisible(false), 1300);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#16161e] transition-opacity duration-300 ${fadeOut ? 'opacity-0' : 'opacity-100'}`}
    >
      <img src={logoSrc} alt="TIMEFLOW" className="h-16 w-16 object-contain" />
      <h1 className="mt-3 text-xs font-semibold uppercase tracking-[0.32em] text-sky-300/90">
        TIMEFLOW
      </h1>
      <div className="mt-3 h-0.5 w-32 overflow-hidden rounded-full bg-white/10">
        <div className="h-full w-1/2 animate-[splash-bar_1.1s_ease-in-out_infinite] bg-gradient-to-r from-sky-500/0 via-sky-300 to-sky-500/0" />
      </div>
      <style>{`
        @keyframes splash-bar {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(220%); }
        }
      `}</style>
    </div>
  );
}

