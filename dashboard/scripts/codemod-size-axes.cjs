const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const files = execSync(
  'git ls-files "src/**/*.tsx" "src/**/*.ts"',
  { cwd: __dirname + '/..', encoding: 'utf8' }
).trim().split('\n').filter(Boolean);

let total = 0;
let changed = 0;
for (const rel of files) {
  const file = path.join(__dirname, '..', rel);
  let src = fs.readFileSync(file, 'utf8');
  const orig = src;

  // Replace w-N h-N → size-N (same value N, in any order)
  // Pattern: w-X h-X or h-X w-X where X is same Tailwind size token
  src = src.replace(/\bw-([\w./[\]-]+)\s+h-\1\b/g, 'size-$1');
  src = src.replace(/\bh-([\w./[\]-]+)\s+w-\1\b/g, 'size-$1');

  if (src !== orig) {
    fs.writeFileSync(file, src);
    const hits = (orig.match(/\b[wh]-([\w./[\]-]+)\s+[hw]-\1\b/g) || []).length;
    console.log(`  ${rel}: ~${hits || '?'} occurrences`);
    changed++;
  }
}
console.log(`\nDone: ${changed} files changed`);
