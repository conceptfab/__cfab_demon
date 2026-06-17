import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/i18n', () => ({
  default: { t: (key: string) => key },
}));

import { ESTIMATE_PLUS_TEMPLATE_ID, ESTIMATE_SIMPLE_TEMPLATE_ID } from '@/lib/report-templates';

describe('report templates with kind', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('seeds two estimate templates on first load and tags legacy as project kind', async () => {
    const { loadTemplates } = await import('@/lib/report-templates');
    const all = loadTemplates();
    const estimate = all.filter((t) => t.kind === 'estimate');
    expect(estimate.map((t) => t.id).sort()).toEqual(
      [ESTIMATE_PLUS_TEMPLATE_ID, ESTIMATE_SIMPLE_TEMPLATE_ID].sort(),
    );
    const project = all.find((t) => t.id === 'default');
    expect(project?.kind).toBe('project');
  });

  it('keeps existing stored templates without kind as project kind (back-compat)', async () => {
    localStorage.setItem(
      'timeflow_report_templates',
      JSON.stringify([
        { id: 'default', name: 'X', sections: ['header', 'footer'], showLogo: true, createdAt: '', updatedAt: '' },
      ]),
    );
    const { loadTemplates } = await import('@/lib/report-templates');
    const all = loadTemplates();
    expect(all.find((t) => t.id === 'default')?.kind).toBe('project');
    expect(all.some((t) => t.kind === 'estimate')).toBe(true);
  });
});
