#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_ROOT = path.join(ROOT, 'src');
const BASELINE_PATH = path.join(
  ROOT,
  'scripts',
  'check-hardcoded-i18n-baseline.json',
);

const EXTENSIONS = new Set(['.ts', '.tsx']);
const EXCLUDED_PATH_PARTS = [
  `${path.sep}locales${path.sep}`,
  `${path.sep}pages${path.sep}Help.tsx`,
  `${path.sep}pages${path.sep}QuickStart.tsx`,
];

const POLISH_DIACRITICS_RE = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;
const TRANSLATION_CALL_RE = /\b(?:tt|t)\s*\(/;

function walk(dir, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, out);
      continue;
    }
    if (!EXTENSIONS.has(path.extname(entry.name))) continue;
    out.push(fullPath);
  }
}

function isExcluded(filePath) {
  return EXCLUDED_PATH_PARTS.some((part) => filePath.includes(part));
}

function shouldIgnoreLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('//')) return true;
  if (trimmed.startsWith('/*')) return true;
  if (trimmed.startsWith('*')) return true;
  if (TRANSLATION_CALL_RE.test(line)) return true;
  if (/^\s*pl\s*:\s*['"`]/.test(line)) return true;
  return false;
}

function keyForViolation(filePath, lineText) {
  const relative = path.relative(ROOT, filePath).replace(/\\/g, '/');
  return `${relative}|${lineText.trim()}`;
}

function main() {
  const files = [];
  walk(SRC_ROOT, files);

  const violations = [];
  for (const filePath of files) {
    if (isExcluded(filePath)) continue;
    const text = fs.readFileSync(filePath, 'utf8');
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!POLISH_DIACRITICS_RE.test(line)) continue;
      if (shouldIgnoreLine(line)) continue;
      violations.push({
        filePath,
        line: i + 1,
        lineText: line.trim(),
      });
    }
  }

  const keys = Array.from(
    new Set(violations.map((v) => keyForViolation(v.filePath, v.lineText))),
  ).sort();
  const updateBaseline = process.argv.includes('--update-baseline');
  if (updateBaseline) {
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(keys, null, 2)}\n`, 'utf8');
    console.log(
      `[i18n-hardcoded] Baseline updated (${keys.length} entries): ${path.relative(ROOT, BASELINE_PATH).replace(/\\/g, '/')}`,
    );
    return;
  }

  let baseline = [];
  if (fs.existsSync(BASELINE_PATH)) {
    baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  }
  const baselineSet = new Set(Array.isArray(baseline) ? baseline : []);

  const newViolations = violations.filter((violation) => {
    const key = keyForViolation(violation.filePath, violation.lineText);
    return !baselineSet.has(key);
  });

  if (newViolations.length === 0) {
    console.log(
      `[i18n-hardcoded] OK (no new violations, baseline size=${baselineSet.size})`,
    );
    return;
  }

  console.error(
    `[i18n-hardcoded] Found ${newViolations.length} new hardcoded Polish string(s) outside locales/help/quick-start:`,
  );
  for (const violation of newViolations) {
    const relative = path.relative(ROOT, violation.filePath).replace(/\\/g, '/');
    console.error(` - ${relative}:${violation.line} -> ${violation.lineText}`);
  }
  console.error(
    `[i18n-hardcoded] If these are intentional legacy strings, update baseline with: node scripts/check-hardcoded-i18n.cjs --update-baseline`,
  );
  process.exitCode = 1;
}

main();
