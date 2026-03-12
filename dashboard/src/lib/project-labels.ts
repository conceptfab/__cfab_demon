import i18n from '@/i18n';

export const UNASSIGNED_PROJECT_SENTINEL = '__unassigned__';
export const OTHER_PROJECT_SENTINEL = '__other__';

function normalizeProjectLabel(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function localizeProjectLabel(
  label: string | null | undefined,
  options?: {
    projectId?: number | null;
    seriesKey?: string | null;
  },
): string {
  const rawLabel = (label ?? '').trim();
  const normalizedLabel = normalizeProjectLabel(rawLabel);
  const normalizedSeriesKey = normalizeProjectLabel(options?.seriesKey);

  if (
    normalizedSeriesKey === OTHER_PROJECT_SENTINEL ||
    normalizedLabel === OTHER_PROJECT_SENTINEL
  ) {
    return i18n.t('ui.common.other');
  }

  if (
    normalizedSeriesKey === UNASSIGNED_PROJECT_SENTINEL ||
    normalizedLabel === UNASSIGNED_PROJECT_SENTINEL ||
    (options?.projectId == null &&
      (normalizedLabel === '' || normalizedLabel === 'unassigned'))
  ) {
    return i18n.t('ui.common.unassigned');
  }

  return rawLabel;
}
