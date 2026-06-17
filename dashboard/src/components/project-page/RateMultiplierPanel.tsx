import { formatMultiplierLabel } from '@/lib/utils';

export function RateMultiplierPanel({
  description,
  currentMultiplierLabel,
  currentMultiplier,
  boostLabel,
  customLabel,
  onBoost,
  onCustom,
}: {
  description: string;
  currentMultiplierLabel: string;
  currentMultiplier: number | null | undefined;
  boostLabel: string;
  customLabel: string;
  onBoost: () => void;
  onCustom: () => void;
}) {
  return (
    <div className="px-3 py-2 space-y-2">
      <p className="text-[10px] text-muted-foreground/50 leading-tight">
        {description}
      </p>
      <p className="text-[10px] text-muted-foreground/80 font-medium">
        {currentMultiplierLabel}{' '}
        <span className="text-emerald-400 font-mono">
          {formatMultiplierLabel(currentMultiplier ?? undefined)}
        </span>
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          className="flex-1 flex items-center justify-center rounded border border-emerald-500/20 bg-emerald-500/10 py-2 text-xs font-bold text-emerald-400 transition-all hover:bg-emerald-500/25 active:scale-95 cursor-pointer shadow-[0_0_15px_-5px_rgba(16,185,129,0.3)]"
          onClick={onBoost}
        >
          {boostLabel}
        </button>
        <button
          type="button"
          className="flex-1 flex items-center justify-center rounded border border-white/10 bg-white/5 py-2 text-xs font-medium text-white transition-all hover:bg-white/15 active:scale-95 cursor-pointer"
          onClick={onCustom}
        >
          {customLabel}
        </button>
      </div>
    </div>
  );
}
