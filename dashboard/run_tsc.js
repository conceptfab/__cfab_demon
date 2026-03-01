const fs = require('fs');
const { execSync } = require('child_process');
try {
  const result = execSync('npx.cmd vite build', {
    encoding: 'utf-8',
    cwd: __dirname,
  });
  fs.writeFileSync('diag_tsc.txt', 'SUCCESS\n' + result);
} catch (e) {
  fs.writeFileSync(
    'diag_tsc.txt',
    'ERROR\n' + (e.stdout || '') + '\n' + (e.stderr || '') + '\n' + e.message,
  );
}
