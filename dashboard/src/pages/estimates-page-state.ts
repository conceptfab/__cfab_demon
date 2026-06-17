import type {
  EstimateProjectRow,
  EstimateSettings,
  EstimateSummary,
} from '@/lib/db-types';
import { getErrorMessage } from '@/lib/utils';
import { formatRateInput } from '@/lib/form-validation';

export const MAX_ESTIMATE_RATE = 100000;

export type EstimatesDataBundle = {
  settings: EstimateSettings | null;
  summary: EstimateSummary | null;
  rows: EstimateProjectRow[];
  drafts: Record<number, string>;
  globalRateInput: string;
  pageErrors: {
    global: string | null;
    table: string | null;
  };
};

export const initialEstimatesData: EstimatesDataBundle = {
  settings: null,
  summary: null,
  rows: [],
  drafts: {},
  globalRateInput: '100',
  pageErrors: { global: null, table: null },
};

export type EstimatesPageState = {
  loading: boolean;
  data: EstimatesDataBundle;
};

function buildDraftsFromRows(rows: EstimateProjectRow[]): Record<number, string> {
  const nextDrafts: Record<number, string> = {};
  for (const row of rows) {
    nextDrafts[row.project_id] =
      row.project_hourly_rate === null
        ? ''
        : formatRateInput(row.project_hourly_rate);
  }
  return nextDrafts;
}

export function applyEstimatesReloadResults(
  results: [
    PromiseSettledResult<EstimateSettings>,
    PromiseSettledResult<EstimateProjectRow[]>,
    PromiseSettledResult<EstimateSummary>,
  ],
  t: (key: string, fallback?: string) => string,
): EstimatesDataBundle {
  const [settingsRes, rowsRes, summaryRes] = results;
  const next: EstimatesDataBundle = {
    ...initialEstimatesData,
    pageErrors: { global: null, table: null },
  };

  if (settingsRes.status === 'fulfilled') {
    next.settings = settingsRes.value;
    next.globalRateInput = formatRateInput(settingsRes.value.global_hourly_rate);
  } else {
    next.pageErrors.global = getErrorMessage(
      settingsRes.reason,
      t('estimates_page.errors.load_global_rate'),
    );
  }

  if (rowsRes.status === 'fulfilled') {
    next.rows = rowsRes.value;
    next.drafts = buildDraftsFromRows(rowsRes.value);
  } else {
    next.pageErrors.table = getErrorMessage(
      rowsRes.reason,
      t('estimates_page.errors.load_project_estimates'),
    );
  }

  if (summaryRes.status === 'fulfilled') {
    next.summary = summaryRes.value;
  } else {
    next.pageErrors.table = getErrorMessage(
      summaryRes.reason,
      t('estimates_page.errors.load_summary'),
    );
  }

  return next;
}

export function patchEstimatesErrors(
  prev: EstimatesPageState,
  patch: Partial<EstimatesDataBundle['pageErrors']>,
): EstimatesPageState {
  return {
    ...prev,
    data: {
      ...prev.data,
      pageErrors: { ...prev.data.pageErrors, ...patch },
    },
  };
}

export function patchEstimatesData(
  prev: EstimatesPageState,
  patch: Partial<EstimatesDataBundle>,
): EstimatesPageState {
  return {
    ...prev,
    data: { ...prev.data, ...patch },
  };
}
