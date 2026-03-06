import { useEffect, useState } from 'react';
import logoSrc from '@/assets/logo.png';

/**
 * Animated splash screen overlay using the real TIMEFLOW icon.
 * Fades out automatically after initial load.
 */
export function SplashScreen() {
  const [visible, setVisible] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFadeOut(true), 1400);
    const removeTimer = setTimeout(() => setVisible(false), 2000);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#16161e] transition-opacity duration-500 ${fadeOut ? 'opacity-0' : 'opacity-100'}`}
    >
      {/* Real TIMEFLOW icon */}
      <div className="relative mb-6">
        <div className="h-20 w-20 rounded-full border-2 border-sky-500/30 animate-ping absolute inset-0" />
        <img
          src={logoSrc}
          alt="TimeFlow"
          className="h-20 w-20 object-contain relative"
        />
      </div>

      {/* Title */}
      <h1 className="text-sm font-semibold uppercase tracking-[0.35em] text-sky-400/80 mb-2">
        TIMEFLOW
      </h1>

      {/* Loading bar */}
      <div className="w-40 h-0.5 rounded-full bg-white/5 overflow-hidden mt-2">
        <div className="h-full bg-gradient-to-r from-sky-500/0 via-sky-400 to-sky-500/0 animate-[splash-bar_1.2s_ease-in-out_infinite]" />
      </div>

      <style>{`
        @keyframes splash-bar {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}
