// @public-api — Tauri command bindings; knip cannot detect dynamic invoke() usage
import { invoke, invokeMutation } from './core';
import type { DateRange } from '@/lib/db-types';

/**
 * Koszt dodatkowy projektu. `uid` jest kluczem synchronizacji (nie `id` — ten jest
 * lokalny per maszyna), a projekt linkuje się NAZWĄ z tego samego powodu.
 */
export interface ProjectCost {
  uid: string;
  project_name: string;
  /** YYYY-MM-DD */
  cost_date: string;
  amount: number;
  comment: string | null;
  created_at: string | null;
  updated_at: string;
}

export const costsList = (projectName: string, dateRange: DateRange) =>
  invoke<ProjectCost[]>('costs_list', { projectName, dateRange });

export const costsCreate = (
  projectName: string,
  costDate: string,
  amount: number,
  comment: string | null,
) =>
  invokeMutation<ProjectCost>('costs_create', {
    projectName,
    costDate,
    amount,
    comment,
  });

export const costsUpdate = (
  uid: string,
  costDate: string,
  amount: number,
  comment: string | null,
) =>
  invokeMutation<ProjectCost>('costs_update', {
    uid,
    costDate,
    amount,
    comment,
  });

export const costsDelete = (uid: string) =>
  invokeMutation<void>('costs_delete', { uid });
