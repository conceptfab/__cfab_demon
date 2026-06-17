import {
  formatDurationRaw,
  getDurationParts,
  roundedAlternativeSeconds,
} from '@/lib/utils';

export function ProjectCardDurationDisplay({ seconds }: { seconds: number }) {
  const { hours, minutes, seconds: remainingSeconds } = getDurationParts(seconds);
  const unitClass = 'text-[0.7em] font-[400] opacity-70 ml-0.5 self-baseline';
  const altSeconds = roundedAlternativeSeconds(seconds);
  const alt =
    altSeconds === null ? null : (
      <span className="ml-1.5 self-baseline text-[0.55em] font-[400] opacity-60">
        (≈{formatDurationRaw(altSeconds)})
      </span>
    );

  if (hours > 0) {
    return (
      <span className="flex items-baseline gap-x-1">
        <span>
          {hours}
          <span className={unitClass}>h</span>
        </span>
        <span>
          {minutes}
          <span className={unitClass}>m</span>
        </span>
        {alt}
      </span>
    );
  }
  if (minutes > 0) {
    return (
      <span className="flex items-baseline gap-x-1">
        <span>
          {minutes}
          <span className={unitClass}>m</span>
        </span>
        <span>
          {remainingSeconds}
          <span className={unitClass}>s</span>
        </span>
        {alt}
      </span>
    );
  }
  return (
    <span className="flex items-baseline">
      {remainingSeconds}
      <span className={unitClass}>s</span>
      {alt}
    </span>
  );
}
