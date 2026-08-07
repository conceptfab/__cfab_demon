import {
  LayoutDashboard,
  FolderKanban,
  CircleDollarSign,
  AppWindow,
  BarChart3,
  List,
  Import,
  Brain,
  FileText,
  Briefcase,
  Cpu,
  Users,
  ListTodo,
} from 'lucide-react';

export const sidebarNavItems = [
  { id: 'dashboard', labelKey: 'layout.nav.dashboard', icon: LayoutDashboard },
  // Drugi pod względem ważności ekran — patrz spec §7.
  { id: 'todo', labelKey: 'layout.nav.todo', icon: ListTodo },
  { id: 'sessions', labelKey: 'layout.nav.sessions', icon: List },
  { id: 'projects', labelKey: 'layout.nav.projects', icon: FolderKanban },
  { id: 'estimates', labelKey: 'layout.nav.estimates', icon: CircleDollarSign },
  { id: 'clients', labelKey: 'layout.nav.clients', icon: Users },
  {
    id: 'applications',
    labelKey: 'layout.nav.applications',
    icon: AppWindow,
  },
  { id: 'analysis', labelKey: 'layout.nav.analysis', icon: BarChart3 },
  { id: 'ai', labelKey: 'layout.nav.ai', icon: Brain },
  { id: 'data', labelKey: 'layout.nav.data', icon: Import },
  { id: 'reports', labelKey: 'layout.nav.reports', icon: FileText },
  { id: 'pm', labelKey: 'layout.nav.pm', icon: Briefcase },
  { id: 'daemon', labelKey: 'layout.nav.daemon', icon: Cpu },
] as const;
