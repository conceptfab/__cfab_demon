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

  it('adds timeline to stored default template once (before sessions)', async () => {
    localStorage.setItem(
      'timeflow_report_templates',
      JSON.stringify([
        { id: 'default', name: 'X', sections: ['header', 'sessions', 'footer'], showLogo: true, createdAt: '', updatedAt: '' },
      ]),
    );
    const { loadTemplates } = await import('@/lib/report-templates');
    const all = loadTemplates();
    expect(all.find((t) => t.id === 'default')?.sections).toEqual([
      'header', 'timeline', 'sessions', 'footer',
    ]);
  });

  it('does not re-add timeline after user removed it (migration runs once)', async () => {
    localStorage.setItem('timeflow_report_timeline_added', '1');
    localStorage.setItem(
      'timeflow_report_templates',
      JSON.stringify([
        { id: 'default', name: 'X', sections: ['header', 'sessions', 'footer'], showLogo: true, createdAt: '', updatedAt: '' },
      ]),
    );
    const { loadTemplates } = await import('@/lib/report-templates');
    const all = loadTemplates();
    expect(all.find((t) => t.id === 'default')?.sections).toEqual([
      'header', 'sessions', 'footer',
    ]);
  });

  it('includes timeline in freshly seeded default template', async () => {
    const { loadTemplates } = await import('@/lib/report-templates');
    const all = loadTemplates();
    expect(all.find((t) => t.id === 'default')?.sections).toContain('timeline');
  });
});

// Regresja: raport projektu renderował się pusty, gdy dla projektu wybrano
// szablon estymacji (sekcje `est_*` nie pasują do sekcji projektu → wszystkie
// sekcje null). Selektor projektu i kontroler muszą trzymać się kind === 'project'.
describe('project report template resolution', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('loadProjectTemplates pomija szablony estymacji', async () => {
    const { loadProjectTemplates } = await import('@/lib/report-templates');
    const list = loadProjectTemplates();
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((t) => t.kind === 'project')).toBe(true);
    expect(list.some((t) => t.id === ESTIMATE_SIMPLE_TEMPLATE_ID)).toBe(false);
    expect(list.some((t) => t.id === 'default')).toBe(true);
  });

  it('getProjectTemplate spada na szablon projektu, gdy id wskazuje estymację', async () => {
    const { getProjectTemplate } = await import('@/lib/report-templates');
    const tpl = getProjectTemplate(ESTIMATE_SIMPLE_TEMPLATE_ID);
    expect(tpl.kind).toBe('project');
    expect(tpl.sections).toContain('header');
  });

  it('getProjectTemplate zwraca szablon projektu dla null', async () => {
    const { getProjectTemplate } = await import('@/lib/report-templates');
    const tpl = getProjectTemplate(null);
    expect(tpl.kind).toBe('project');
    expect(tpl.sections).toContain('header');
  });
});
