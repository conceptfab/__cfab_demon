export interface ReportTemplate {
  id: string;
  name: string;
  sections: string[];
  fontFamily: 'system' | 'serif' | 'mono';
  baseFontSize: number;
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

function createDefaultTemplate(): ReportTemplate {
  return {
    id: 'default',
    name: 'Standard',
    sections: [...DEFAULT_SECTIONS],
    fontFamily: 'system',
    baseFontSize: 13,
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
    const parsed = JSON.parse(raw) as ReportTemplate[];
    return parsed.length > 0 ? parsed : [createDefaultTemplate()];
  } catch {
    return [createDefaultTemplate()];
  }
}

export function saveTemplates(templates: ReportTemplate[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
}

export function getSelectedTemplateId(): string {
  return localStorage.getItem(SELECTED_KEY) || 'default';
}

export function setSelectedTemplateId(id: string): void {
  localStorage.setItem(SELECTED_KEY, id);
}

export function getTemplate(id: string): ReportTemplate {
  const all = loadTemplates();
  return all.find(t => t.id === id) || all[0] || createDefaultTemplate();
}

export function saveTemplate(template: ReportTemplate): ReportTemplate[] {
  const all = loadTemplates();
  const idx = all.findIndex(t => t.id === template.id);
  template.updatedAt = new Date().toISOString();
  if (idx >= 0) {
    all[idx] = template;
  } else {
    all.push(template);
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

export function duplicateTemplate(id: string): ReportTemplate[] {
  const all = loadTemplates();
  const source = all.find(t => t.id === id);
  if (!source) return all;
  const copy: ReportTemplate = {
    ...source,
    id: generateId(),
    name: `${source.name} (kopia)`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  all.push(copy);
  saveTemplates(all);
  return all;
}
