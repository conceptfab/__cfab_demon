import os

def update_file(path, replacements):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    for old, new in replacements:
        if old not in content:
            print(f"Warning: could not find snippet in {path}:\n{old[:100]}...")
        content = content.replace(old, new)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

update_file('src-tauri/src/commands/types.rs', [
    ('pub project_id: Option<i64>,\n    #[serde(rename = "minDuration")]', 'pub project_id: Option<i64>,\n    pub unassigned: Option<bool>,\n    #[serde(rename = "minDuration")]')
])

update_file('src-tauri/src/commands/sessions.rs', [
    ('if project_filter.is_none() {', 'if project_filter.is_none() && filters.unassigned.is_none() {'),
    ('''        if let Some(pid) = project_filter {
            sessions.retain(|s| {
                matches!(
                    inferred_project_by_session.get(&s.id),
                    Some(Some(inferred_pid)) if *inferred_pid == pid
                )
            });

            let offset = filters.offset.unwrap_or(0).max(0) as usize;
            if offset > 0 {
                sessions = sessions.into_iter().skip(offset).collect();
            }
            if let Some(limit) = filters.limit {
                sessions.truncate(limit.max(0) as usize);
            }
        }''', '''        let handle_pagination = project_filter.is_some() || filters.unassigned.is_some();

        if let Some(unassigned) = filters.unassigned {
            if unassigned {
                sessions.retain(|s| matches!(inferred_project_by_session.get(&s.id), Some(None) | None));
            } else {
                sessions.retain(|s| matches!(inferred_project_by_session.get(&s.id), Some(Some(_))));
            }
        } else if let Some(pid) = project_filter {
            sessions.retain(|s| matches!(inferred_project_by_session.get(&s.id), Some(Some(inferred_pid)) if *inferred_pid == pid));
        }

        if handle_pagination {
            let offset = filters.offset.unwrap_or(0).max(0) as usize;
            if offset > 0 { sessions = sessions.into_iter().skip(offset).collect(); }
            if let Some(limit) = filters.limit { sessions.truncate(limit.max(0) as usize); }
        }''')
])

update_file('src/lib/tauri.ts', [
    ('projectId?: number;', 'projectId?: number;\n  unassigned?: boolean;')
])

update_file('src/pages/Sessions.tsx', [
    ('const [sessions, setSessions] = useState<SessionWithApp[]>([]);', 'const [activeProjectId, setActiveProjectId] = useState<number | "unassigned" | null>(sessionsFocusProject);\n  const [sessions, setSessions] = useState<SessionWithApp[]>([]);'),
    ('const { refreshKey, triggerRefresh, sessionsFocusDate, clearSessionsFocusDate } = useAppStore();', 'const { refreshKey, triggerRefresh, sessionsFocusDate, clearSessionsFocusDate, sessionsFocusProject, setSessionsFocusProject } = useAppStore();'),
    ('''  useEffect(() => {
    if (!sessionsFocusDate) return;
    setRangeMode("daily");
    setAnchorDate(sessionsFocusDate);
    clearSessionsFocusDate();
  }, [sessionsFocusDate, clearSessionsFocusDate]);''', '''  useEffect(() => {
    if (!sessionsFocusDate && !sessionsFocusProject) return;
    if (sessionsFocusDate) {
      setRangeMode("daily");
      setAnchorDate(sessionsFocusDate);
      clearSessionsFocusDate();
    }
    if (sessionsFocusProject !== null) {
      setActiveProjectId(sessionsFocusProject);
      setSessionsFocusProject(null);
    }
  }, [sessionsFocusDate, clearSessionsFocusDate, sessionsFocusProject, setSessionsFocusProject]);'''),
    ('''  useEffect(() => {
    getSessions({ dateRange: activeDateRange, limit: PAGE_SIZE, offset: 0 })
      .then((data) => {
        setSessions(data);
        setHasMore(data.length >= PAGE_SIZE);
      })
      .catch(console.error);
  }, [activeDateRange, refreshKey]);''', '''  useEffect(() => {
    getSessions({ 
      dateRange: activeDateRange, 
      limit: PAGE_SIZE, 
      offset: 0,
      projectId: activeProjectId === "unassigned" ? undefined : (activeProjectId ?? undefined),
      unassigned: activeProjectId === "unassigned" ? true : undefined
    })
      .then((data) => {
        setSessions(data);
        setHasMore(data.length >= PAGE_SIZE);
      })
      .catch(console.error);
  }, [activeDateRange, refreshKey, activeProjectId]);'''),
    ('''  const loadMore = () => {
    getSessions({ dateRange: activeDateRange, limit: PAGE_SIZE, offset: sessions.length })
      .then((data) => {
        setSessions((prev) => [...prev, ...data]);
        setHasMore(data.length >= PAGE_SIZE);
      })
      .catch(console.error);
  };''', '''  const loadMore = () => {
    getSessions({ 
      dateRange: activeDateRange, 
      limit: PAGE_SIZE, 
      offset: sessions.length,
      projectId: activeProjectId === "unassigned" ? undefined : (activeProjectId ?? undefined),
      unassigned: activeProjectId === "unassigned" ? true : undefined
    })
      .then((data) => {
        setSessions((prev) => [...prev, ...data]);
        setHasMore(data.length >= PAGE_SIZE);
      })
      .catch(console.error);
  };'''),
    ('''              Compact
            </button>
          </div>
        </div>''', '''              Compact
            </button>
          </div>
          {activeProjectId !== null && (
            <div className="mx-1 h-5 w-px bg-border flex items-center gap-2" />
          )}
          {activeProjectId !== null && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActiveProjectId(null)}
              className="text-xs text-muted-foreground"
            >
              Clear filter
            </Button>
          )}
        </div>''')
])
print('Done!')
