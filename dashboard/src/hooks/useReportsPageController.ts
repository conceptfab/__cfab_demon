import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  deleteTemplate,
  duplicateTemplate,
  getSelectedTemplateId,
  loadTemplates,
  saveTemplate,
  setSelectedTemplateId,
} from '@/lib/report-templates';
import type { ReportTemplate } from '@/lib/report-templates';
import {
  ESTIMATE_DEFAULT_SECTION_IDS,
  REPORT_DEFAULT_SECTION_IDS,
} from '@/pages/reports/reports-page-constants';
import { REPORT_PAGE_SECTIONS } from '@/pages/reports/reports-page-sections';
import { ESTIMATE_REPORT_SECTIONS } from '@/pages/reports/estimate-report-sections';

export function useReportsPageController() {
  const { t } = useTranslation();

  const [templates, setTemplates] = useState<ReportTemplate[]>(() =>
    loadTemplates(),
  );
  const [activeTemplateId, setActiveTemplateId] = useState(() =>
    getSelectedTemplateId(),
  );

  const activeTemplate =
    templates.find((template) => template.id === activeTemplateId) ??
    templates[0] ??
    null;
  const activeIds = activeTemplate?.sections ?? [];
  const sectionRegistry =
    activeTemplate?.kind === 'estimate'
      ? ESTIMATE_REPORT_SECTIONS
      : REPORT_PAGE_SECTIONS;
  const deferredActiveTemplate = useDeferredValue(activeTemplate);
  const previewTemplate = deferredActiveTemplate ?? activeTemplate;
  const previewLoading = deferredActiveTemplate !== activeTemplate;
  const previewIds = previewTemplate?.sections ?? [];

  const saveSections = useCallback(
    (sections: string[]) => {
      if (!activeTemplate) return;
      const updated = { ...activeTemplate, sections };
      const newList = saveTemplate(updated);
      setTemplates(newList);
    },
    [activeTemplate],
  );

  const patchTemplate = useCallback(
    (patch: Partial<ReportTemplate>) => {
      if (!activeTemplate) return;
      const updated = { ...activeTemplate, ...patch };
      const newList = saveTemplate(updated);
      setTemplates(newList);
    },
    [activeTemplate],
  );

  const handleSelectTemplate = (id: string) => {
    setActiveTemplateId(id);
    setSelectedTemplateId(id);
  };

  const handleNewTemplate = () => {
    const kind = activeTemplate?.kind ?? 'project';
    const sections =
      kind === 'estimate'
        ? [...ESTIMATE_DEFAULT_SECTION_IDS]
        : [...REPORT_DEFAULT_SECTION_IDS];
    const newTpl: ReportTemplate = {
      id: crypto.randomUUID(),
      name: t('reports_page.template.new_template'),
      kind,
      sections,
      showLogo: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const newList = saveTemplate(newTpl);
    setTemplates(newList);
    handleSelectTemplate(newTpl.id);
  };

  const handleDuplicate = () => {
    if (!activeTemplate) return;
    const newList = duplicateTemplate(
      activeTemplate.id,
      t('reports_page.template.copy_suffix'),
    );
    setTemplates(newList);
    const newest = newList[newList.length - 1];
    if (newest) handleSelectTemplate(newest.id);
  };

  const handleDelete = () => {
    if (!activeTemplate || templates.length <= 1) return;
    const newList = deleteTemplate(activeTemplate.id);
    setTemplates(newList);
    handleSelectTemplate(newList[0].id);
  };

  const availableSections = sectionRegistry.filter(
    (section) => !activeIds.includes(section.id),
  );

  const addSection = (id: string) => saveSections([...activeIds, id]);
  const removeSection = (id: string) =>
    saveSections(activeIds.filter((x) => x !== id));

  const moveUp = (idx: number) => {
    if (idx <= 0) return;
    const next = [...activeIds];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    saveSections(next);
  };

  const moveDown = (idx: number) => {
    if (idx >= activeIds.length - 1) return;
    const next = [...activeIds];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    saveSections(next);
  };

  const sectionDefById = useMemo(
    () => new Map(sectionRegistry.map((section) => [section.id, section])),
    [sectionRegistry],
  );

  const getSectionDef = useCallback(
    (id: string) => sectionDefById.get(id),
    [sectionDefById],
  );

  return {
    activeIds,
    activeTemplate,
    addSection,
    availableSections,
    getSectionDef,
    handleDelete,
    handleDuplicate,
    handleNewTemplate,
    handleSelectTemplate,
    moveDown,
    moveUp,
    patchTemplate,
    previewIds,
    previewLoading,
    removeSection,
    t,
    templates,
  };
}

export type ReportsPageController = ReturnType<typeof useReportsPageController>;
