#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOCALES_ROOT = path.join(ROOT, 'src', 'locales');
const BASE_LOCALE = 'en';

function listLocaleDirs() {
  return fs.readdirSync(LOCALES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function listJsonFiles(locale) {
  const localeRoot = path.join(LOCALES_ROOT, locale);
  const files = [];

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (path.extname(entry.name) !== '.json') continue;
      files.push(path.relative(localeRoot, fullPath).replace(/\\/g, '/'));
    }
  }

  walk(localeRoot);
  return files.sort();
}

function flattenKeys(value, prefix = '', out = new Map()) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, nested] of Object.entries(value)) {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      flattenKeys(nested, nextPrefix, out);
    }
    return out;
  }

  out.set(prefix, value);
  return out;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function formatIssueList(title, items) {
  if (items.length === 0) {
    return `${title}: OK`;
  }
  return `${title}:\n${items.map((item) => `  - ${item}`).join('\n')}`;
}

function main() {
  if (!fs.existsSync(LOCALES_ROOT)) {
    console.error(`[locale-consistency] Missing locales directory: ${LOCALES_ROOT}`);
    process.exit(1);
  }

  const locales = listLocaleDirs();
  if (!locales.includes(BASE_LOCALE)) {
    console.error(`[locale-consistency] Missing base locale directory: ${BASE_LOCALE}`);
    process.exit(1);
  }

  const baseFiles = listJsonFiles(BASE_LOCALE);
  const errors = [];

  for (const locale of locales) {
    const localeFiles = listJsonFiles(locale);
    const missingFiles = baseFiles.filter((file) => !localeFiles.includes(file));
    const orphanFiles = localeFiles.filter((file) => !baseFiles.includes(file));

    if (missingFiles.length > 0) {
      errors.push(
        `${locale} missing files:\n${missingFiles.map((file) => `  - ${file}`).join('\n')}`,
      );
    }
    if (orphanFiles.length > 0) {
      errors.push(
        `${locale} orphan files:\n${orphanFiles.map((file) => `  - ${file}`).join('\n')}`,
      );
    }

    for (const relativeFile of baseFiles) {
      if (!localeFiles.includes(relativeFile)) continue;

      const baseData = readJson(path.join(LOCALES_ROOT, BASE_LOCALE, relativeFile));
      const localeData = readJson(path.join(LOCALES_ROOT, locale, relativeFile));
      const baseKeys = flattenKeys(baseData);
      const localeKeys = flattenKeys(localeData);

      const missingKeys = [];
      const orphanKeys = [];
      const emptyKeys = [];

      for (const key of baseKeys.keys()) {
        if (!localeKeys.has(key)) {
          missingKeys.push(`${relativeFile}:${key}`);
          continue;
        }

        const value = localeKeys.get(key);
        if (typeof value === 'string' && value.trim() === '') {
          emptyKeys.push(`${relativeFile}:${key}`);
        }
      }

      for (const key of localeKeys.keys()) {
        if (!baseKeys.has(key)) {
          orphanKeys.push(`${relativeFile}:${key}`);
        }
      }

      if (missingKeys.length > 0) {
        errors.push(
          formatIssueList(`${locale} missing keys`, missingKeys),
        );
      }
      if (orphanKeys.length > 0) {
        errors.push(
          formatIssueList(`${locale} orphan keys`, orphanKeys),
        );
      }
      if (emptyKeys.length > 0) {
        errors.push(
          formatIssueList(`${locale} empty keys`, emptyKeys),
        );
      }
    }
  }

  if (errors.length > 0) {
    console.error('[locale-consistency] Locale validation failed:\n');
    console.error(errors.join('\n\n'));
    process.exit(1);
  }

  console.log(`[locale-consistency] OK (${locales.join(', ')})`);
}

main();
