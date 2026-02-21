import os

path = "src/pages/Sessions.tsx"
with open(path, "r", encoding="utf-8") as f:
    text = f.read()

replacements = [
    (
        'const [sessions, setSessions] = useState<SessionWithApp[]>([]);',
        'const [activeProjectId, setActiveProjectId] = useState<number | "unassigned" | null>(sessionsFocusProject);\n  const [sessions, setSessions] = useState<SessionWithApp[]>([]);'
    ),
    (
        'const { refreshKey, triggerRefresh, sessionsFocusDate, clearSessionsFocusDate } = useAppStore();',
        'const { refreshKey, triggerRefresh, sessionsFocusDate, clearSessionsFocusDate, sessionsFocusProject, setSessionsFocusProject } = useAppStore();'
    ),
    (
        '''  useEffect(() => {
    if (!sessionsFocusDate) return;
    setRangeMode("daily");
    setAnchorDate(sessionsFocusDate);
    clearSessionsFocusDate();
  }, [sessionsFocusDate, clearSessionsFocusDate]);''',
        '''  useEffect(() => {
    if (!sessionsFocusDate && sessionsFocusProject === null) return;
    if (sessionsFocusDate) {
      setRangeMode("daily");
      setAnchorDate(sessionsFocusDate);
      clearSessionsFocusDate();
    }
    if (sessionsFocusProject !== null) {
      setActiveProjectId(sessionsFocusProject);
      setSessionsFocusProject(null);
    }
  }, [sessionsFocusDate, clearSessionsFocusDate, sessionsFocusProject, setSessionsFocusProject]);'''
    ),
    (
        '''  useEffect(() => {
    getSessions({ dateRange: activeDateRange, limit: PAGE_SIZE, offset: 0 })
      .then((data) => {
        setSessions(data);
        setHasMore(data.length >= PAGE_SIZE);
      })
      .catch(console.error);
  }, [activeDateRange, refreshKey]);''',
        '''  useEffect(() => {
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
  }, [activeDateRange, refreshKey, activeProjectId]);'''
    ),
    (
        '''  const loadMore = () => {
    getSessions({ dateRange: activeDateRange, limit: PAGE_SIZE, offset: sessions.length })
      .then((data) => {
        setSessions((prev) => [...prev, ...data]);
        setHasMore(data.length >= PAGE_SIZE);
      })
      .catch(console.error);
  };''',
        '''  const loadMore = () => {
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
  };'''
    ),
    (
        '''              Compact
            </button>
          </div>
        </div>
      </div>''',
        '''              Compact
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
        </div>
      </div>'''
    )
]

for old, new in replacements:
    if old in text:
        text = text.replace(old, new)
        print("Replaced!")
    else:
        print("Not found:\n", old[:50])

with open(path, "w", encoding="utf-8") as f:
    f.write(text)
