const db = require('better-sqlite3')('C:/Users/micz/AppData/Roaming/TimeFlow/timeflow_demon.db');
const rows = db.prepare(`SELECT id, name FROM projects WHERE name LIKE '%background%'`).all();
require('fs').writeFileSync('debug_db.txt', JSON.stringify(rows, null, 2));

