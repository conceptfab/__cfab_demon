// @public-api — Tauri command bindings; knip cannot detect dynamic invoke() usage
import { invoke, invokeMutation } from './core';
import type {
  DashboardData,
  DashboardStats,
  DateRange,
  EstimateProjectRow,
  EstimateSettings,
  EstimateSummary,
  StackedBarData,
  TimelinePoint,
} from '../db-types';

export const getActivityDateSpan = () =>
  invoke<DateRange | null>('get_activity_date_span');

export const getDashboardData = (
  dateRange: DateRange,
  topLimit = 5,
  timelineLimit = 8,
  timelineGranularity: 'hour' | 'day' = 'day',
) =>
  invoke<DashboardData>('get_dashboard_data', {
    dateRange,
    topLimit,
    timelineLimit,
    timelineGranularity,
  });

export const getDashboardStats = (dateRange: DateRange) =>
  invoke<DashboardStats>('get_dashboard_stats', { dateRange });

export const getTimeline = (dateRange: DateRange) =>
  invoke<TimelinePoint[]>('get_timeline', { dateRange });

export const getEstimateSettings = () =>
  invoke<EstimateSettings>('get_estimate_settings');

export const updateGlobalHourlyRate = (rate: number) =>
  invokeMutation<void>('update_global_hourly_rate', { rate });

export const updateProjectHourlyRate = (
  projectId: number,
  rate: number | null,
) => invokeMutation<void>('update_project_hourly_rate', { projectId, rate });

export const getProjectEstimates = (dateRange: DateRange) =>
  invoke<EstimateProjectRow[]>('get_project_estimates', { dateRange });

export const getEstimatesSummary = (dateRange: DateRange) =>
  invoke<EstimateSummary>('get_estimates_summary', { dateRange });

export const getProjectTimeline = (
  dateRange: DateRange,
  limit = 8,
  granularity: 'hour' | 'day' = 'day',
  projectId?: number,
) =>
  invoke<StackedBarData[]>('get_project_timeline', {
    dateRange,
    limit,
    granularity,
    id: projectId,
  });

export const dashboardApi = {
  getActivityDateSpan,
  getDashboardData,
  getDashboardStats,
  getTimeline,
  getEstimateSettings,
  updateGlobalHourlyRate,
  updateProjectHourlyRate,
  getProjectEstimates,
  getEstimatesSummary,
  getProjectTimeline,
} as const;
