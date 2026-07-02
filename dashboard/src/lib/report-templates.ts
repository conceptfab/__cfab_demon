import i18n from '@/i18n';

export type ReportTemplateKind = 'project' | 'estimate';

export interface ReportTemplate {
  id: string;
  name: string;
  kind: ReportTemplateKind;
  sections: string[];
  showLogo: boolean;
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = 'timeflow_report_templates';
const SELECTED_KEY = 'timeflow_report_selected_template';
const TIMELINE_MIGRATION_KEY = 'timeflow_report_timeline_added';

export const ESTIMATE_SIMPLE_TEMPLATE_ID = 'estimate-simple';
export const ESTIMATE_PLUS_TEMPLATE_ID = 'estimate-plus';

const ESTIMATE_SIMPLE_SECTIONS = ['est_header', 'est_summary', 'est_footer'];
const ESTIMATE_PLUS_SECTIONS = ['est_header', 'est_summary', 'est_per_day', 'est_footer'];

const DEFAULT_SECTIONS = ['header', 'stats', 'financials', 'apps', 'timeline', 'sessions', 'comments', 'footer'];

function generateId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getDefaultTemplateName(): string {
  return i18n.t('reports_page.template.default_template');
}

function normalizeTemplate(template: ReportTemplate): ReportTemplate {
  const defaultName = getDefaultTemplateName();
  const normalizedName =
    template.id === 'default' &&
    (!template.name || template.name === 'reports_page.template.default_template')
      ? defaultName
      : template.name;
  const normalizedSections =
    Array.isArray(template.sections) && template.sections.length > 0
      ? template.sections.filter((section) => section !== 'files')
      : [];

  return {
    ...template,
    kind: template.kind === 'estimate' ? 'estimate' : 'project',
    name: normalizedName,
    sections: normalizedSections.length > 0 ? normalizedSections : [...DEFAULT_SECTIONS],
  };
}

function createDefaultTemplate(): ReportTemplate {
  return {
    id: 'default',
    name: getDefaultTemplateName(),
    kind: 'project',
    sections: [...DEFAULT_SECTIONS],
    showLogo: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function createEstimateTemplates(): ReportTemplate[] {
  const now = new Date().toISOString();
  return [
    {
      id: ESTIMATE_SIMPLE_TEMPLATE_ID,
      name: i18n.t('reports_page.template.estimate_simple'),
      kind: 'estimate',
      sections: [...ESTIMATE_SIMPLE_SECTIONS],
      showLogo: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: ESTIMATE_PLUS_TEMPLATE_ID,
      name: i18n.t('reports_page.template.estimate_plus'),
      kind: 'estimate',
      sections: [...ESTIMATE_PLUS_SECTIONS],
      showLogo: true,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

/** Dokłada brakujące domyślne szablony estymacji (po id) — idempotentnie. */
function ensureEstimateTemplates(list: ReportTemplate[]): ReportTemplate[] {
  const have = new Set(list.map((t) => t.id));
  const missing = createEstimateTemplates().filter((t) => !have.has(t.id));
  return missing.length > 0 ? [...list, ...missing] : list;
}

/** Jednorazowo dopisuje sekcję 'timeline' do zapisanego szablonu 'default' (przed 'sessions'). */
function ensureTimelineSection(list: ReportTemplate[]): ReportTemplate[] {
  if (localStorage.getItem(TIMELINE_MIGRATION_KEY)) return list;
  localStorage.setItem(TIMELINE_MIGRATION_KEY, '1');
  let changed = false;
  const next = list.map((t) => {
    if (t.id !== 'default' || t.kind !== 'project' || t.sections.includes('timeline')) {
      return t;
    }
    const sections = [...t.sections];
    const idx = sections.indexOf('sessions');
    sections.splice(idx >= 0 ? idx : sections.length, 0, 'timeline');
    changed = true;
    return { ...t, sections };
  });
  return changed ? next : list;
}

export function loadTemplates(): ReportTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const oldSections = localStorage.getItem('timeflow_report_template');
      const defaultTpl = createDefaultTemplate();
      if (oldSections) {
        try { defaultTpl.sections = JSON.parse(oldSections); } catch { /* ignore */ }
      }
      const seeded = [defaultTpl, ...createEstimateTemplates()];
      saveTemplates(seeded);
      return seeded;
    }
    const parsed = (JSON.parse(raw) as ReportTemplate[]).map(normalizeTemplate);
    const base = parsed.length > 0 ? parsed : [createDefaultTemplate()];
    const withEstimates = ensureEstimateTemplates(base);
    const withTimeline = ensureTimelineSection(withEstimates);
    if (withTimeline !== withEstimates || withEstimates.length !== base.length) {
      saveTemplates(withTimeline);
    }
    return withTimeline;
  } catch {
    return [createDefaultTemplate(), ...createEstimateTemplates()];
  }
}

function saveTemplates(templates: ReportTemplate[]): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(templates.map(normalizeTemplate)),
  );
}

export function getSelectedTemplateId(): string {
  return localStorage.getItem(SELECTED_KEY) || 'default';
}

export function setSelectedTemplateId(id: string): void {
  localStorage.setItem(SELECTED_KEY, id);
}

export function getTemplate(id: string): ReportTemplate {
  const all = loadTemplates();
  return normalizeTemplate(all.find(t => t.id === id) || all[0] || createDefaultTemplate());
}

export function saveTemplate(template: ReportTemplate): ReportTemplate[] {
  const all = loadTemplates();
  const idx = all.findIndex(t => t.id === template.id);
  const nextTemplate: ReportTemplate = {
    ...template,
    updatedAt: new Date().toISOString(),
  };
  if (idx >= 0) {
    all[idx] = normalizeTemplate(nextTemplate);
  } else {
    all.push(normalizeTemplate(nextTemplate));
  }
  saveTemplates(all);
  return all;
}

export function deleteTemplate(id: string): ReportTemplate[] {
  let all = loadTemplates().filter(t => t.id !== id);
  if (all.length === 0) all = [createDefaultTemplate()];
  saveTemplates(all);
  return all;
}

export function duplicateTemplate(id: string, copyLabel = 'copy'): ReportTemplate[] {
  const all = loadTemplates();
  const source = all.find(t => t.id === id);
  if (!source) return all;
  const suffix = copyLabel === 'copy'
    ? i18n.t('reports_page.template.copy_suffix')
    : copyLabel;
  const copy: ReportTemplate = {
    ...source,
    id: generateId(),
    name: `${source.name} (${suffix})`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  all.push(copy);
  saveTemplates(all);
  return all;
}
