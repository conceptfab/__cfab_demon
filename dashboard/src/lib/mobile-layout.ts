/** Wspólne klasy layoutu mobile — jeden zestaw dla wszystkich ekranów listowych. */
export const mobileLayout = {
  pageStack: 'w-full min-w-0 space-y-3 sm:space-y-4',
  pageContainer: 'mx-auto w-full min-w-0 space-y-3 pb-16 sm:space-y-4 sm:pb-20',
  metricGrid:
    'grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 sm:gap-3 md:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0 [&>*]:max-w-full',
  chartGrid: 'grid gap-2 sm:gap-3 lg:grid-cols-2',
  alertCard: 'border-amber-500/40 bg-amber-500/10',
  alertContent:
    'flex flex-col gap-2 p-2.5 sm:flex-row sm:items-center sm:gap-2.5 sm:p-3',
  alertText: 'min-w-0 text-[11px] leading-snug text-amber-100 sm:text-xs',
  alertBox:
    'rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200 md:px-3 md:py-2 md:text-xs',
  alertAction: 'w-full shrink-0 sm:ml-auto sm:w-auto',
} as const;
