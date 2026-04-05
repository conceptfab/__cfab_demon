import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { ProjectColorPicker } from '@/components/project/ProjectColorPicker';
import type { PmProject, PmClientColors, PmClientInfo } from '@/lib/pm-types';
import { pmApi } from '@/lib/tauri/pm';
import { logTauriError } from '@/lib/utils';

interface Props {
  projects: PmProject[];
  clientColors: PmClientColors;
  onColorsChanged: (colors: PmClientColors) => void;
}

// 20 distinct default colors — vibrant on dark bg
const DEFAULT_PALETTE = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#a855f7',
  '#6366f1', '#84cc16', '#e11d48', '#0ea5e9', '#d946ef',
  '#10b981', '#f43f5e', '#7c3aed', '#eab308', '#64748b',
];

function emptyInfo(color: string): PmClientInfo {
  return { color, comment: '', contact: '' };
}

function groupClients(projects: PmProject[]) {
  const rawSet = new Set<string>();
  for (const p of projects) rawSet.add(p.prj_client.toUpperCase());
  const rawList = [...rawSet];

  const groupMap = new Map<string, string>();
  for (const name of rawList) {
    const underIdx = name.indexOf('_');
    if (underIdx > 0) {
      const base = name.slice(0, underIdx);
      if (rawSet.has(base)) {
        groupMap.set(name, base);
        continue;
      }
    }
    groupMap.set(name, name);
  }

  // Build group stats
  const stats = new Map<string, { count: number; budgetSum: number; variants: string[] }>();
  for (const p of projects) {
    const group = groupMap.get(p.prj_client.toUpperCase()) || p.prj_client.toUpperCase();
    let s = stats.get(group);
    if (!s) { s = { count: 0, budgetSum: 0, variants: [] }; stats.set(group, s); }
    s.count++;
    const b = parseFloat(p.prj_budget);
    if (!isNaN(b)) s.budgetSum += b;
    const variant = p.prj_client.toUpperCase();
    if (!s.variants.includes(variant)) s.variants.push(variant);
  }

  return { stats, groups: [...stats.keys()].sort((a, b) => a.localeCompare(b)) };
}

export function PmClientsList({ projects, clientColors, onColorsChanged }: Props) {
  const { t } = useTranslation();
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);

  const { stats, groups } = useMemo(() => groupClients(projects), [projects]);

  // Ensure every group has info
  const data = useMemo(() => {
    const result = { ...clientColors };
    let nextIdx = 0;
    for (const g of groups) {
      if (!result[g]) {
        result[g] = emptyInfo(DEFAULT_PALETTE[nextIdx % DEFAULT_PALETTE.length]);
        nextIdx++;
      }
    }
    return result;
  }, [clientColors, groups]);

  const persist = (updated: PmClientColors) => {
    onColorsChanged(updated);
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(async () => {
      savingRef.current = true;
      try {
        await pmApi.savePmClientColors(updated);
      } catch (e) {
        logTauriError('pm save client data', e);
      } finally {
        savingRef.current = false;
      }
    }, 400);
  };

  const handleColorSave = async (client: string, color: string) => {
    const updated = { ...data, [client]: { ...data[client], color } };
    onColorsChanged(updated);
    try {
      await pmApi.savePmClientColors(updated);
    } catch (e) {
      logTauriError('pm save client color', e);
    }
  };

  const handleFieldChange = (client: string, field: 'comment' | 'contact', value: string) => {
    const updated = { ...data, [client]: { ...data[client], [field]: value } };
    persist(updated);
  };

  if (groups.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-muted-foreground text-sm">
        {t('pm.empty')}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-2">
      <p className="text-[10px] text-muted-foreground shrink-0">
        {groups.length} {t('pm.statusbar.clients')}
      </p>

      <div className="overflow-auto rounded-md border border-border min-h-0 flex-1">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium w-10">{t('pm.clients.color')}</th>
              <th className="px-3 py-2 font-medium">{t('pm.columns.client')}</th>
              <th className="px-3 py-2 font-medium text-center w-16">{t('pm.clients.projects_count')}</th>
              <th className="px-3 py-2 font-medium text-right w-20">{t('pm.columns.budget')}</th>
              <th className="px-3 py-2 font-medium">{t('pm.clients.contact')}</th>
              <th className="px-3 py-2 font-medium">{t('pm.clients.comment')}</th>
              <th className="px-3 py-2 font-medium">{t('pm.clients.variants')}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const s = stats.get(g)!;
              const info = data[g] || emptyInfo('#64748b');

              return (
                <tr key={g} className="border-b border-border/50">
                  {/* Color swatch — reuse ProjectColorPicker */}
                  <td className="px-3 py-2">
                    <ProjectColorPicker
                      currentColor={info.color}
                      labels={{
                        changeColor: t('pm.clients.color'),
                        chooseColor: t('pm.clients.color'),
                        saveColor: t('pm.detail.save'),
                      }}
                      onSave={(color) => handleColorSave(g, color)}
                    />
                  </td>

                  {/* Client name */}
                  <td className="px-3 py-2 font-medium" style={{ color: info.color }}>
                    {g}
                  </td>

                  {/* Project count */}
                  <td className="px-3 py-2 text-center font-mono text-xs">{s.count}</td>

                  {/* Budget sum */}
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {s.budgetSum > 0 ? s.budgetSum.toLocaleString() : '—'}
                  </td>

                  {/* Contact — inline editable */}
                  <td className="px-3 py-2">
                    <input
                      className="w-full bg-transparent border-b border-transparent hover:border-border focus:border-primary text-xs px-0 py-0.5 outline-none transition-colors placeholder:text-muted-foreground/40"
                      placeholder={t('pm.clients.contact_placeholder')}
                      value={info.contact}
                      onChange={(e) => handleFieldChange(g, 'contact', e.target.value)}
                    />
                  </td>

                  {/* Comment — inline editable */}
                  <td className="px-3 py-2">
                    <input
                      className="w-full bg-transparent border-b border-transparent hover:border-border focus:border-primary text-xs px-0 py-0.5 outline-none transition-colors placeholder:text-muted-foreground/40"
                      placeholder={t('pm.clients.comment_placeholder')}
                      value={info.comment}
                      onChange={(e) => handleFieldChange(g, 'comment', e.target.value)}
                    />
                  </td>

                  {/* Variants */}
                  <td className="px-3 py-2">
                    {s.variants.length > 1 && (
                      <div className="flex gap-1 flex-wrap">
                        {s.variants.map((v) => (
                          <Badge key={v} variant="outline" className="text-[9px]">{v}</Badge>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
