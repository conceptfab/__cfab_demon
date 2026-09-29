import { describe, expect, it } from 'vitest';
import type { ProjectWithStats } from '@/lib/db-types';
import type { PmProject } from '@/lib/pm-types';
import {
  buildTfMatch,
  buildTfProjectMatchIndex,
  findTfProject,
  normalizePmStatus,
} from './pm-page-match';

describe('pm-page-match', () => {
  describe('normalizePmStatus', () => {
    it('normalizes empty or undefined to active', () => {
      expect(normalizePmStatus(undefined)).toBe('active');
      expect(normalizePmStatus('')).toBe('active');
      expect(normalizePmStatus('   ')).toBe('active');
    });

    it('normalizes active and Aktywny to active', () => {
      expect(normalizePmStatus('Aktywny')).toBe('active');
      expect(normalizePmStatus('active')).toBe('active');
      expect(normalizePmStatus('ACTIVE')).toBe('active');
    });

    it('normalizes inactive, frozen, and Nieaktywny to inactive', () => {
      expect(normalizePmStatus('Nieaktywny')).toBe('inactive');
      expect(normalizePmStatus('inactive')).toBe('inactive');
      expect(normalizePmStatus('frozen')).toBe('inactive');
      expect(normalizePmStatus('zamrożony')).toBe('inactive');
    });

    it('normalizes archived, excluded, and Archiwalny to archived', () => {
      expect(normalizePmStatus('Archiwalny')).toBe('archived');
      expect(normalizePmStatus('archived')).toBe('archived');
      expect(normalizePmStatus('excluded')).toBe('archived');
      expect(normalizePmStatus('zarchiwizowany')).toBe('archived');
    });
  });

  describe('buildTfMatch', () => {
    it('preserves project status when no TIMEFLOW match is found', () => {
      const match = buildTfMatch(null, new Map(), new Set(), 'Aktywny');
      expect(match.status).toBe('active');
      expect(match.tfProjectId).toBeNull();
      expect(match.totalSeconds).toBe(0);
    });

    it('preserves archived status when no TIMEFLOW match is found and pmStatus is archived', () => {
      const match = buildTfMatch(null, new Map(), new Set(), 'archived');
      expect(match.status).toBe('archived');
      expect(match.tfProjectId).toBeNull();
    });

    it('uses TIMEFLOW match status when match is found', () => {
      const tfProject: ProjectWithStats = {
        id: 42,
        name: '01_26_Client_Website',
        color: '#ff0000',
        total_seconds: 3600,
        app_count: 1,
        last_activity: '2026-09-29',
        created_at: '2026-09-01',
        updated_at: '2026-09-29',
        is_imported: 0,
        daily_seconds: [3600],
        hourly_rate: 100,
      };

      const match = buildTfMatch(tfProject, new Map(), new Set([42]), 'inactive');
      expect(match.status).toBe('active');
      expect(match.tfProjectId).toBe(42);
      expect(match.isHot).toBe(true);
      expect(match.totalSeconds).toBe(3600);
    });

    it('reflects frozen TIMEFLOW project status', () => {
      const tfProject: ProjectWithStats = {
        id: 42,
        name: '01_26_Client_Website',
        color: '#ff0000',
        total_seconds: 1200,
        app_count: 1,
        last_activity: '2026-09-28',
        created_at: '2026-09-01',
        updated_at: '2026-09-28',
        is_imported: 0,
        daily_seconds: [1200],
        frozen_at: '2026-09-29T10:00:00Z',
      };

      const match = buildTfMatch(tfProject, new Map(), new Set());
      expect(match.status).toBe('frozen');
      expect(match.tfProjectId).toBe(42);
    });
  });

  describe('findTfProject', () => {
    it('matches by folder path or full name', () => {
      const tfProjects: ProjectWithStats[] = [
        {
          id: 10,
          name: '01_26_Acme_Shop',
          color: '#123456',
          total_seconds: 500,
          app_count: 1,
          last_activity: '2026-09-29',
          created_at: '2026-09-01',
          updated_at: '2026-09-29',
          is_imported: 0,
          daily_seconds: [500],
          assigned_folder_path: '/projects/01_26_Acme_Shop',
        },
      ];

      const index = buildTfProjectMatchIndex(tfProjects);

      const pmProject: PmProject = {
        prj_folder: '/projects',
        prj_number: '01',
        prj_year: '26',
        prj_code: '0126',
        prj_client: 'Acme',
        prj_name: 'Shop',
        prj_desc: '',
        prj_full_name: '01_26_Acme_Shop',
        prj_budget: '',
        prj_term: '',
        prj_status: 'Aktywny',
      };

      const match = findTfProject(pmProject, index);
      expect(match).not.toBeNull();
      expect(match?.id).toBe(10);
    });
  });
});
