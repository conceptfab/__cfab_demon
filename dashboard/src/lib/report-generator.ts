/**
 * Generate a standalone HTML project report in a new browser window.
 * Uses the saved template from localStorage and real project data.
 * No app UI — pure printable HTML document.
 */

import {
  getProjects,
  getProjectExtraInfo,
  getProjectEstimates,
  getSessions,
  getManualSessions,
  getDaemonStatus,
} from '@/lib/tauri';
import { formatDuration, formatMoney } from '@/lib/utils';
import { format, parseISO } from 'date-fns';

function loadTemplate(): string[] {
  try {
    const saved = localStorage.getItem('timeflow_report_template');
    return saved
      ? JSON.parse(saved)
      : [
          'header',
          'stats',
          'financials',
          'apps',
          'sessions',
          'comments',
          'footer',
        ];
  } catch {
    return [
      'header',
      'stats',
      'financials',
      'apps',
      'sessions',
      'comments',
      'footer',
    ];
  }
}

export async function generateProjectReport(
  projectId: number,
  currencyCode: string,
) {
  const dr = { start: '1970-01-01', end: '2100-01-01' };

  const [projects, estimates, daemonStatus] = await Promise.all([
    getProjects(),
    getProjectEstimates(dr),
    getDaemonStatus().catch(() => null),
  ]);
  const appVersion = daemonStatus?.dashboard_version || '?';
  const project = projects.find((p) => p.id === projectId);
  if (!project) throw new Error('Project not found');

  const [extra, sessions, manual] = await Promise.all([
    getProjectExtraInfo(project.id, dr),
    getSessions({
      projectId: project.id,
      limit: 10000,
      dateRange: dr,
      includeAiSuggestions: true,
    }),
    getManualSessions({ projectId: project.id }),
  ]);

  const est = estimates.find((e) => e.project_id === project.id);
  const estimateVal = est?.estimated_value || 0;
  const totalSessions = sessions.length + manual.length;
  const aiSuggestions = sessions.filter((s) => s.suggested_project_id).length;
  const aiAssigned = sessions.filter((s) => s.ai_assigned).length;
  const withComments = sessions.filter((s) => s.comment?.trim());
  const now = format(new Date(), 'yyyy-MM-dd HH:mm');
  const sections = loadTemplate();
  const has = (id: string) => sections.includes(id);

  // Build top apps HTML
  const appsHtml = extra.top_apps
    .slice(0, 10)
    .map((app) => {
      const maxSec = extra.top_apps[0]?.seconds || 1;
      const pct = Math.max(5, Math.round((app.seconds / maxSec) * 100));
      return `<tr>
      <td style="padding:4px 12px 4px 0;font-weight:500;white-space:nowrap">${app.name}</td>
      <td style="width:100%;padding:2px 0">
        <div style="background:#e2e8f0;border-radius:4px;overflow:hidden">
          <div style="width:${pct}%;background:#3b82f6;color:white;font-size:11px;padding:2px 8px;white-space:nowrap">${formatDuration(app.seconds)}</div>
        </div>
      </td>
    </tr>`;
    })
    .join('');

  // Build sessions table
  const sessionsHtml = sessions
    .slice(0, 50)
    .map(
      (s) => `
    <tr style="border-bottom:1px solid #f1f5f9">
      <td style="padding:4px 8px 4px 0;color:#64748b;font-family:monospace;white-space:nowrap">${format(parseISO(s.start_time), 'yyyy-MM-dd')}</td>
      <td style="padding:4px 8px 4px 0">${s.app_name}</td>
      <td style="padding:4px 8px 4px 0;font-family:monospace;text-align:right">${formatDuration(s.duration_seconds)}</td>
      <td style="padding:4px 0;color:#94a3b8;max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.comment?.trim() || ''}</td>
    </tr>
  `,
    )
    .join('');

  // Build comments
  const commentsHtml = withComments
    .slice(0, 25)
    .map(
      (s) => `
    <div style="display:flex;gap:12px;font-size:12px;margin-bottom:4px">
      <span style="color:#94a3b8;font-family:monospace;white-space:nowrap">${format(parseISO(s.start_time), 'yyyy-MM-dd')}</span>
      <span>${s.comment}</span>
    </div>
  `,
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <title>${project.name} — TIMEFLOW Report</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; color:#1e293b; background:#fff; padding:40px 50px; font-size:13px; line-height:1.5; }
    h1 { font-size:22px; font-weight:700; margin-bottom:2px; }
    .section { margin-bottom:28px; }
    .section-title { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; color:#94a3b8; margin-bottom:8px; }
    .stat-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
    .stat-card { border:1px solid #e2e8f0; border-radius:8px; padding:12px; }
    .stat-label { font-size:10px; color:#94a3b8; text-transform:uppercase; letter-spacing:1px; }
    .stat-value { font-size:20px; font-weight:700; margin-top:2px; }
    .accent { color:#0284c7; }
    .money { color:#059669; }
    .financial-box { border:1px solid #d1fae5; background:#f0fdf4; border-radius:8px; padding:16px; display:flex; align-items:baseline; gap:24px; }
    table { width:100%; border-collapse:collapse; font-size:12px; }
    thead th { text-align:left; font-weight:600; font-size:10px; text-transform:uppercase; letter-spacing:1px; color:#94a3b8; padding:4px 8px 4px 0; border-bottom:2px solid #e2e8f0; }
    .footer { text-align:center; font-size:10px; color:#cbd5e1; border-top:1px solid #e2e8f0; padding-top:16px; margin-top:32px; }
    @media print { body { padding:20px 30px; } }
  </style>
</head>
<body>

${
  has('header')
    ? `
  <div class="section">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
      <div style="width:16px;height:16px;border-radius:50%;background:${project.color}"></div>
      <h1>${project.name}</h1>
    </div>
    <div style="font-size:11px;color:#94a3b8">
      TIMEFLOW v${appVersion} · ${now}
      ${project.frozen_at ? ' · <span style="color:#3b82f6">Projekt zamrożony</span>' : ''}
    </div>
  </div>
`
    : ''
}

${
  has('stats')
    ? `
  <div class="section">
    <div class="section-title">Statystyki</div>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">Łączny czas</div><div class="stat-value accent">${formatDuration(project.total_seconds)}</div></div>
      <div class="stat-card"><div class="stat-label">Sesje</div><div class="stat-value">${totalSessions}</div></div>
      <div class="stat-card"><div class="stat-label">Aplikacje</div><div class="stat-value">${extra.top_apps.length}</div></div>
      <div class="stat-card"><div class="stat-label">Pliki</div><div class="stat-value">${extra.db_stats?.file_activity_count ?? 0}</div></div>
    </div>
  </div>
`
    : ''
}

${
  has('financials') && estimateVal > 0
    ? `
  <div class="section">
    <div class="section-title">Finanse</div>
    <div class="financial-box">
      <div><div class="stat-label">Szacowana wartość</div><div style="font-size:24px;font-weight:700;color:#059669">${formatMoney(estimateVal, currencyCode)}</div></div>
      <div style="font-size:20px;color:#e2e8f0">/</div>
      <div><div class="stat-label">Czas pracy</div><div style="font-size:20px;font-weight:700">${formatDuration(project.total_seconds)}</div></div>
    </div>
  </div>
`
    : ''
}

${
  has('apps') && extra.top_apps.length > 0
    ? `
  <div class="section">
    <div class="section-title">Najczęściej używane aplikacje</div>
    <table>${appsHtml}</table>
  </div>
`
    : ''
}

${
  has('files') && (extra.db_stats?.file_activity_count ?? 0) > 0
    ? `
  <div class="section">
    <div class="section-title">Aktywność na plikach</div>
    <p>Zarejestrowano: <strong>${extra.db_stats?.file_activity_count ?? 0}</strong> plików</p>
  </div>
`
    : ''
}

${
  has('ai')
    ? `
  <div class="section">
    <div class="section-title">Model AI</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="stat-card"><div class="stat-label">Sugestie AI</div><div class="stat-value">${aiSuggestions}</div></div>
      <div class="stat-card"><div class="stat-label">Auto-przypisane</div><div class="stat-value">${aiAssigned}</div></div>
    </div>
  </div>
`
    : ''
}

${
  has('sessions') && sessions.length > 0
    ? `
  <div class="section">
    <div class="section-title">Sesje (${sessions.length})</div>
    <table>
      <thead><tr><th>Data</th><th>Aplikacja</th><th style="text-align:right">Czas</th><th>Komentarz</th></tr></thead>
      <tbody>${sessionsHtml}</tbody>
    </table>
    ${sessions.length > 50 ? `<p style="font-size:10px;color:#94a3b8;margin-top:4px">+${sessions.length - 50} więcej sesji...</p>` : ''}
  </div>
`
    : ''
}

${
  has('comments') && withComments.length > 0
    ? `
  <div class="section">
    <div class="section-title">Komentarze (${withComments.length})</div>
    ${commentsHtml}
  </div>
`
    : ''
}

${
  has('footer')
    ? `
  <div class="footer">TIMEFLOW v${appVersion} · ${project.name} · ${now}</div>
`
    : ''
}

<script>window.onafterprint = window.onafterprint || null;</script>
</body>
</html>`;

  // Open in new window
  const win = window.open('', '_blank', 'width=900,height=700');
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}
