import i18n from '@/i18n';

export interface ReportTemplate {
  id: string;
  name: string;
  sections: string[];
  showLogo: boolean;
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = 'timeflow_report_templates';
const SELECTED_KEY = 'timeflow_report_selected_template';

const DEFAULT_SECTIONS = ['header', 'stats', 'financials', 'apps', 'sessions', 'comments', 'footer'];

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
    name: normalizedName,
    sections: normalizedSections.length > 0 ? normalizedSections : [...DEFAULT_SECTIONS],
  };
}

function createDefaultTemplate(): ReportTemplate {
  return {
    id: 'default',
    name: getDefaultTemplateName(),
    sections: [...DEFAULT_SECTIONS],
    showLogo: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function loadTemplates(): ReportTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // Migracja ze starego formatu
      const oldSections = localStorage.getItem('timeflow_report_template');
      const defaultTpl = createDefaultTemplate();
      if (oldSections) {
        try { defaultTpl.sections = JSON.parse(oldSections); } catch { /* ignore */ }
      }
      saveTemplates([defaultTpl]);
      return [defaultTpl];
    }
    const parsed = (JSON.parse(raw) as ReportTemplate[]).map(normalizeTemplate);
    return parsed.length > 0 ? parsed : [createDefaultTemplate()];
  } catch {
    return [createDefaultTemplate()];
  }
}

export function saveTemplates(templates: ReportTemplate[]): void {
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
