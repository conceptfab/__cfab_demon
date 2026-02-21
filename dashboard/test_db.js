const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('C:/_cloud/__cfab_demon/dashboard/cfab_dashboard_copy.db');

db.all("SELECT * FROM projects WHERE name LIKE '%cfab%' OR name LIKE '%pano%'", [], (err, rows) => {
    console.log('--- PROJECTS ---');
    console.log(rows);
    
    db.all("SELECT a.executable_name, a.display_name, p.name as project_name FROM applications a LEFT JOIN projects p ON a.project_id = p.id WHERE p.name LIKE '%cfab%' OR p.name LIKE '%pano%'", [], (err, rows) => {
        console.log('--- APPS ---');
        console.log(rows);
        
        db.all("SELECT fa.file_name, a.executable_name FROM file_activities fa JOIN applications a ON fa.app_id = a.id WHERE fa.file_name LIKE '%pano%' LIMIT 10", [], (err, rows) => {
            console.log('--- FILES ---');
            console.log(rows);
            db.close();
        });
    });
});
