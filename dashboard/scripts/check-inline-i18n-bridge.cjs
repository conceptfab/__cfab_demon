#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_ROOT = path.join(ROOT, 'src');
const EXTENSIONS = new Set(['.ts', '.tsx']);
const VIOLATION_RE = /\buseInlineT\b/;

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

function main() {
  const files = [];
  walk(SRC_ROOT, files);

  const violations = [];
  for (const filePath of files) {
    const text = fs.readFileSync(filePath, 'utf8');
    if (!VIOLATION_RE.test(text)) continue;
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!VIOLATION_RE.test(line)) return;
      violations.push({
        filePath,
        line: index + 1,
        lineText: line.trim(),
      });
    });
  }

  if (violations.length === 0) {
    console.log('[inline-i18n-bridge] OK (no useInlineT references)');
    return;
  }

  console.error(
    `[inline-i18n-bridge] Found ${violations.length} legacy useInlineT reference(s):`,
  );
  for (const violation of violations) {
    const relative = path.relative(ROOT, violation.filePath).replace(/\\/g, '/');
    console.error(` - ${relative}:${violation.line} -> ${violation.lineText}`);
  }
  process.exitCode = 1;
}

main();
