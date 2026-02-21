const db = require('better-sqlite3')('C:/Users/micz/AppData/Roaming/conceptfab/cfab_demon.db');

try {
  const p = db.prepare(`SELECT * FROM projects WHERE name LIKE '%background%' OR name LIKE '(%)'`).all();
  console.log("PROJECTS:", p);

  const a = db.prepare(`SELECT * FROM applications WHERE display_name LIKE '%background%' OR executable_name LIKE '%background%'`).all();
  console.log("APPLICATIONS:", a);

  const s = db.prepare(`
    SELECT count(*) as c 
    FROM sessions s 
    LEFT JOIN projects p ON p.id = s.project_id 
    WHERE p.name = '(background)' OR s.project_id IS NULL
  `).all();
  console.log("SESSIONS:", s);

  const raw_p = db.prepare("SELECT * FROM projects").all();
  console.log("ALL PROJECTS LIMIT 10:", raw_p.slice(0, 10));

} catch(e) {
  console.error(e);
}
