#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function hashInlinePair(input) {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;

  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }

  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return `${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}`;
}

function buildInlineI18nKey(pl, en) {
  return `inline.${hashInlinePair(`${pl}\u0000${en}`)}`;
}

function walkFiles(rootDir) {
  const files = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      files.push(full);
    }
  }

  walk(rootDir);
  return files;
}

function getLiteralString(expr) {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return expr.text;
  }
  return null;
}

function collectInlinePairsFromFile(filePath) {
  const sourceText = fs.readFileSync(filePath, 'utf8');
  const source = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const inlineHookNames = new Set();
  const translatorFnNames = new Set();
  const pairs = [];
  let skippedDynamic = 0;

  function scanImports(node) {
    if (!ts.isImportDeclaration(node)) return;
    if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) return;

    const modulePath = node.moduleSpecifier.text;
    if (modulePath !== '@/lib/inline-i18n' && !modulePath.endsWith('/inline-i18n')) {
      return;
    }

    if (!node.importClause || !node.importClause.namedBindings) return;
    const named = node.importClause.namedBindings;
    if (!ts.isNamedImports(named)) return;

    for (const el of named.elements) {
      const importedName = el.propertyName ? el.propertyName.text : el.name.text;
      if (importedName === 'useInlineT') {
        inlineHookNames.add(el.name.text);
      }
    }
  }

  function scanTranslatorAssignments(node) {
    if (!ts.isVariableDeclaration(node)) return;
    if (!ts.isIdentifier(node.name)) return;
    if (!node.initializer || !ts.isCallExpression(node.initializer)) return;
    const call = node.initializer;
    if (!ts.isIdentifier(call.expression)) return;
    if (!inlineHookNames.has(call.expression.text)) return;
    translatorFnNames.add(node.name.text);
  }

  function scanTranslatorCalls(node) {
    if (!ts.isCallExpression(node)) return;
    if (!ts.isIdentifier(node.expression)) return;
    if (!translatorFnNames.has(node.expression.text)) return;
    if (node.arguments.length < 2) return;

    const pl = getLiteralString(node.arguments[0]);
    const en = getLiteralString(node.arguments[1]);
    if (pl === null || en === null) {
      skippedDynamic += 1;
      return;
    }

    pairs.push({ pl, en });
  }

  function visitAll(node, visitor) {
    visitor(node);
    ts.forEachChild(node, (child) => visitAll(child, visitor));
  }

  visitAll(source, scanImports);
  if (inlineHookNames.size === 0) {
    return { pairs: [], skippedDynamic: 0 };
  }
  visitAll(source, scanTranslatorAssignments);
  if (translatorFnNames.size === 0) {
    return { pairs: [], skippedDynamic: 0 };
  }
  visitAll(source, scanTranslatorCalls);

  return { pairs, skippedDynamic };
}

function sortObjectByKey(obj) {
  return Object.fromEntries(
    Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function ensureObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  return {};
}

function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const srcRoot = path.join(projectRoot, 'src');
  const enPath = path.join(srcRoot, 'locales', 'en', 'common.json');
  const plPath = path.join(srcRoot, 'locales', 'pl', 'common.json');

  const files = walkFiles(srcRoot);
  const unique = new Map();
  let skippedDynamic = 0;

  for (const file of files) {
    const result = collectInlinePairsFromFile(file);
    skippedDynamic += result.skippedDynamic;
    for (const pair of result.pairs) {
      unique.set(`${pair.pl}\u0000${pair.en}`, pair);
    }
  }

  const enJson = JSON.parse(fs.readFileSync(enPath, 'utf8'));
  const plJson = JSON.parse(fs.readFileSync(plPath, 'utf8'));

  const prevEnInline = ensureObject(enJson.inline);
  const prevPlInline = ensureObject(plJson.inline);
  const enInline = {};
  const plInline = {};

  const keyToPair = new Map();
  let inserted = 0;
  let updated = 0;

  for (const pair of unique.values()) {
    const fullKey = buildInlineI18nKey(pair.pl, pair.en);
    const shortKey = fullKey.startsWith('inline.')
      ? fullKey.slice('inline.'.length)
      : fullKey;
    const previous = keyToPair.get(shortKey);
    if (previous) {
      const same =
        previous.pl === pair.pl && previous.en === pair.en;
      if (!same) {
        throw new Error(
          `Hash collision for key "${shortKey}" between pairs:\n` +
            `1) ${previous.pl} || ${previous.en}\n` +
            `2) ${pair.pl} || ${pair.en}`,
        );
      }
    }
    keyToPair.set(shortKey, pair);

    const hadBefore =
      Object.prototype.hasOwnProperty.call(prevEnInline, shortKey) ||
      Object.prototype.hasOwnProperty.call(prevPlInline, shortKey);

    enInline[shortKey] = pair.en;
    plInline[shortKey] = pair.pl;
    if (hadBefore) updated += 1;
    else inserted += 1;
  }

  enJson.inline = sortObjectByKey(enInline);
  plJson.inline = sortObjectByKey(plInline);

  const previousKeys = new Set([
    ...Object.keys(prevEnInline),
    ...Object.keys(prevPlInline),
  ]);
  const nextKeys = new Set(Object.keys(enInline));
  let removed = 0;
  previousKeys.forEach((key) => {
    if (!nextKeys.has(key)) removed += 1;
  });

  fs.writeFileSync(enPath, `${JSON.stringify(enJson, null, 2)}\n`);
  fs.writeFileSync(plPath, `${JSON.stringify(plJson, null, 2)}\n`);

  console.log(
    `Inline i18n sync complete. Pairs: ${unique.size}, inserted: ${inserted}, updated: ${updated}, removed: ${removed}, skipped dynamic templates: ${skippedDynamic}.`,
  );
}

main();
