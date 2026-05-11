// @public-api — Tauri command bindings; knip cannot detect dynamic invoke() usage
import { invoke, invokeMutation } from './core';
import type {
  DateRange,
  MultiProjectAnalysis,
  ScoreBreakdown,
  SessionSplittableFlag,
  SessionWithApp,
  SplitPart,
} from '../db-types';

export const getSessions = (filters: {
  dateRange?: DateRange;
  appId?: number;
  projectId?: number;
  unassigned?: boolean;
  minDuration?: number;
  includeFiles?: boolean;
  includeAiSuggestions?: boolean;
  limit?: number;
  offset?: number;
}) => invoke<SessionWithApp[]>('get_sessions', { filters });

export const getSessionCount = (filters: {
  dateRange?: DateRange;
  appId?: number;
  projectId?: number;
  unassigned?: boolean;
  minDuration?: number;
}) => invoke<number>('get_session_count', { filters });

export const rebuildSessions = (gapFillMinutes: number) =>
  invokeMutation<number>('rebuild_sessions', { gapFillMinutes }, {
    notify: (merged) => merged > 0,
  });

export const deleteSession = (sessionId: number) =>
  invokeMutation<void>('delete_session', { sessionId });

export const deleteSessionsBatch = (sessionIds: number[]) =>
  invokeMutation<void>('delete_sessions', { sessionIds });

export const updateSessionRateMultiplier = (
  sessionId: number,
  multiplier: number | null,
) =>
  invokeMutation<void>('update_session_rate_multiplier', {
    sessionId,
    multiplier,
  });

export const updateSessionRateMultipliersBatch = (
  sessionIds: number[],
  multiplier: number | null,
) =>
  invokeMutation<void>('update_session_rate_multipliers', {
    sessionIds,
    multiplier,
  });

export const updateSessionComment = (
  sessionId: number,
  comment: string | null,
) => invokeMutation<void>('update_session_comment', { sessionId, comment });

export const updateSessionCommentsBatch = (
  sessionIds: number[],
  comment: string | null,
) => invokeMutation<void>('update_session_comments', { sessionIds, comment });

export const analyzeSessionProjects = (
  sessionId: number,
  toleranceThreshold: number,
  maxProjects: number,
) =>
  invoke<MultiProjectAnalysis>('analyze_session_projects', {
    sessionId,
    toleranceThreshold,
    maxProjects,
  });

export const analyzeSessionsSplittable = (
  sessionIds: number[],
  toleranceThreshold: number,
  maxProjects: number,
) =>
  invoke<SessionSplittableFlag[]>('analyze_sessions_splittable', {
    sessionIds,
    toleranceThreshold,
    maxProjects,
  });

export const splitSessionMulti = (
  sessionId: number,
  splits: SplitPart[],
  notModifiedSince?: string,
) =>
  invokeMutation<void>('split_session_multi', {
    sessionId,
    splits,
    notModifiedSince: notModifiedSince ?? null,
  });

export const getSessionScoreBreakdown = (sessionId: number) =>
  invoke<ScoreBreakdown>('get_session_score_breakdown', { sessionId });

export const sessionsApi = {
  getSessions,
  getSessionCount,
  rebuildSessions,
  deleteSession,
  deleteSessionsBatch,
  updateSessionRateMultiplier,
  updateSessionRateMultipliersBatch,
  updateSessionComment,
  updateSessionCommentsBatch,
  analyzeSessionProjects,
  analyzeSessionsSplittable,
  splitSessionMulti,
  getSessionScoreBreakdown,
} as const;
