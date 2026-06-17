import { useTranslation } from 'react-i18next';

export type DuplicateInfo = {
  groupSize: number;
  normalizedKey: string;
  groupNames: string[];
};

export function DuplicateMarkerBadge({
  duplicateInfo,
}: {
  duplicateInfo: DuplicateInfo;
}) {
  const { t } = useTranslation();
  const title =
    duplicateInfo.groupNames.length > 1
      ? t('projects.labels.possible_duplicate_named', {
          groupSize: duplicateInfo.groupSize,
          groupNames: duplicateInfo.groupNames.join(' | '),
        })
      : t('projects.labels.possible_duplicate_normalized', {
          groupSize: duplicateInfo.groupSize,
        });

  return (
    <span
      className="inline-flex size-4 items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/10 text-[10px] font-bold leading-none text-amber-600 shrink-0"
      title={title}
      aria-label={title}
    >
      {t('projects.labels.duplicate_marker')}
    </span>
  );
}
