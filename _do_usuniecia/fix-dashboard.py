import os
import sys

# Get the project root folder (two levels up from scripts/debug/)
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

path = os.path.join(project_root, "dashboard", "src-tauri", "src", "commands", "dashboard.rs")

# First run git restore safely
os.system(f'cd "{project_root}" && git checkout HEAD -- dashboard/src-tauri/src/commands/dashboard.rs')

with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Replace occurrences of query without is_hidden
content = content.replace(
    "WHERE s.date >= ?1 AND s.date <= ?2\n             GROUP BY s.app_id",
    "WHERE s.date >= ?1 AND s.date <= ?2 AND (s.is_hidden IS NULL OR s.is_hidden = 0)\n             GROUP BY s.app_id"
)
content = content.replace(
    "WHERE date >= ?1 AND date <= ?2),",
    "WHERE date >= ?1 AND date <= ?2 AND (is_hidden IS NULL OR is_hidden = 0)),"
)
content = content.replace(
    "WHERE date >= ?1 AND date <= ?2) +",
    "WHERE date >= ?1 AND date <= ?2 AND (is_hidden IS NULL OR is_hidden = 0)) +"
)
content = content.replace(
    "SELECT date FROM sessions WHERE date >= ?1 AND date <= ?2\n                     UNION",
    "SELECT date FROM sessions WHERE date >= ?1 AND date <= ?2 AND (is_hidden IS NULL OR is_hidden = 0)\n                     UNION"
)
content = content.replace(
    "WHERE s.date >= ?1 AND s.date <= ?2\n                GROUP BY s.id, s.app_id, fa.project_id",
    "WHERE s.date >= ?1 AND s.date <= ?2 AND (s.is_hidden IS NULL OR s.is_hidden = 0)\n                GROUP BY s.id, s.app_id, fa.project_id"
)
content = content.replace(
    "WHERE s.date >= ?1 AND s.date <= ?2\n            ),",
    "WHERE s.date >= ?1 AND s.date <= ?2 AND (s.is_hidden IS NULL OR s.is_hidden = 0)\n            ),"
)
content = content.replace(
    "SELECT start_time, duration_seconds FROM sessions\n                 WHERE date >= ?1 AND date <= ?2\n                 UNION ALL",
    "SELECT start_time, duration_seconds FROM sessions\n                 WHERE date >= ?1 AND date <= ?2 AND (is_hidden IS NULL OR is_hidden = 0)\n                 UNION ALL"
)
content = content.replace(
    "AND s.date <= ?2\n             LEFT JOIN projects p ON p.id = a.project_id",
    "AND s.date <= ?2\n              AND (s.is_hidden IS NULL OR s.is_hidden = 0)\n             LEFT JOIN projects p ON p.id = a.project_id"
)
content = content.replace(
    "LEFT JOIN sessions s ON s.app_id = a.id\n             LEFT JOIN projects p ON p.id = a.project_id",
    "LEFT JOIN sessions s ON s.app_id = a.id AND (s.is_hidden IS NULL OR s.is_hidden = 0)\n             LEFT JOIN projects p ON p.id = a.project_id"
)
content = content.replace(
    "WHERE app_id = ?1 AND date >= ?2 AND date <= ?3\n             GROUP BY date",
    "WHERE app_id = ?1 AND date >= ?2 AND date <= ?3 AND (is_hidden IS NULL OR is_hidden = 0)\n             GROUP BY date"
)
content = content.replace(
    "date TEXT NOT NULL\n            );",
    "date TEXT NOT NULL,\n                is_hidden INTEGER DEFAULT 0\n            );"
)

with open(path, "w", encoding="utf-8") as f:
    f.write(content)

print(f"dashboard.rs length after replace: {len(content)}")
