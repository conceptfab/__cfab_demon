#!/usr/bin/env node
/**
 * Generates webui/rpc_generated.rs: a dispatch arm for every #[tauri::command]
 * that is registered in generate_handler!. The LAN web UI bridge calls these so
 * the browser can invoke the same commands as the desktop webview.
 *
 * All commands share the shape `fn NAME(app: AppHandle, ...serde args) -> Result<T, String>`
 * (verified: no State/Window params), so dispatch is mechanical:
 *   - skip a leading AppHandle param (pass app.clone())
 *   - pull each remaining param from the JSON args object by camelCase key
 *   - await if async, propagate the Result, serialize the Ok value
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const COMMANDS_DIR = path.join(SRC, 'commands');
const LIB_RS = path.join(SRC, 'lib.rs');
const OUT = path.join(SRC, 'webui', 'rpc_generated.rs');

// 1) Commands actually registered in generate_handler![...]
const lib = fs.readFileSync(LIB_RS, 'utf8');
const handlerMatch = lib.match(/generate_handler!\s*\[([\s\S]*?)\]/);
if (!handlerMatch) throw new Error('generate_handler! not found in lib.rs');
const registered = new Set(
  [...handlerMatch[1].matchAll(/commands::([a-z0-9_]+)/g)].map((m) => m[1]),
);

// 2) Walk command source files
function rsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return rsFiles(p);
    return e.name.endsWith('.rs') ? [p] : [];
  });
}

// Split a param list on top-level commas (respecting <>, (), []).
function splitParams(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '<' || ch === '(' || ch === '[') depth++;
    else if (ch === '>' || ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

// Extract balanced (...) starting at index of '('. Returns {body, end}.
function balanced(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return { body: src.slice(openIdx + 1, i), end: i };
    }
  }
  throw new Error('unbalanced parens');
}

const arms = [];
const skipped = [];

for (const file of rsFiles(COMMANDS_DIR)) {
  const src = fs.readFileSync(file, 'utf8');
  // Match both `#[tauri::command]` and the imported-short `#[command]` form.
  const re = /#\[(?:tauri::)?command[^\]]*\]/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    // find the fn signature after the attribute (skip other attributes)
    const after = src.slice(m.index);
    const fnMatch = after.match(/\b(pub\s+)?(async\s+)?fn\s+([a-z0-9_]+)\s*\(/);
    if (!fnMatch) continue;
    const isAsync = !!fnMatch[2];
    const name = fnMatch[3];
    if (!registered.has(name)) continue;

    const openIdx = m.index + fnMatch.index + fnMatch[0].length - 1; // index of '('
    const { body, end } = balanced(src, openIdx);
    const retMatch = src.slice(end + 1).match(/^\s*->\s*([^\{]+)\{/);
    const ret = retMatch ? retMatch[1].trim() : '()';
    const isResult = /^Result\s*</.test(ret);

    const params = splitParams(body);
    // Commands taking a Window/WebviewWindow/State (or a non-leading AppHandle)
    // param can't be dispatched from the LAN bridge — those types aren't
    // deserializable from JSON and there's no real window/state in that context.
    // Skip the whole command rather than emit a non-compiling `from_arg` arm.
    const unbridgeable = params.some((p, idx) => {
      const colon = p.indexOf(':');
      if (colon === -1) return false;
      const ptype = p.slice(colon + 1).trim();
      if (idx === 0 && /AppHandle/.test(ptype)) return false; // leading AppHandle is fine
      return /\b(Window|WebviewWindow|State|AppHandle)\b/.test(ptype);
    });
    if (unbridgeable) {
      skipped.push(name);
      continue;
    }
    const callArgs = [];
    params.forEach((p, idx) => {
      const colon = p.indexOf(':');
      if (colon === -1) return;
      const pname = p.slice(0, colon).trim().replace(/^mut\s+/, '');
      const ptype = p.slice(colon + 1).trim();
      if (idx === 0 && /AppHandle/.test(ptype)) {
        callArgs.push('app.clone()');
      } else {
        callArgs.push(`from_arg(args, "${pname}")?`);
      }
    });

    const call = `crate::commands::${name}(${callArgs.join(', ')})`;
    const awaited = isAsync ? `tauri::async_runtime::block_on(${call})` : call;
    const value = isResult ? `${awaited}?` : awaited;
    // Wrap in a closure returning Result so `?` propagates here (the outer fn
    // returns Option<Result<..>>, where `?` on a Result would not compile).
    arms.push(
      `        "${name}" => Some((|| -> Result<Value, String> { ok(${value}) })()),`,
    );
  }
}

arms.sort();
const armText = [...new Set(arms)].join('\n');

const header = `// @generated by scripts/gen_webrpc.cjs — DO NOT EDIT BY HAND.
// Regenerate: node scripts/gen_webrpc.cjs
#![allow(clippy::all)]
use serde::de::DeserializeOwned;
use serde_json::Value;
use tauri::AppHandle;

fn ok<T: serde::Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|e| format!("bad_response: {e}"))
}

fn to_camel(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut upper = false;
    for c in name.chars() {
        if c == '_' {
            upper = true;
        } else if upper {
            out.extend(c.to_uppercase());
            upper = false;
        } else {
            out.push(c);
        }
    }
    out
}

/// Pull a command argument from the JSON object. The browser sends camelCase
/// keys (Tauri normally converts them), so try camelCase first, then snake_case.
fn from_arg<T: DeserializeOwned>(args: &Value, name: &str) -> Result<T, String> {
    let camel = to_camel(name);
    let value = args
        .get(camel.as_str())
        .or_else(|| args.get(name))
        .cloned()
        .unwrap_or(Value::Null);
    serde_json::from_value(value).map_err(|e| format!("bad_arg {name}: {e}"))
}

/// Returns Some(result) for a known command, None if the command is not bridged.
pub fn dispatch_generated(
    app: &AppHandle,
    command: &str,
    args: &Value,
) -> Option<Result<Value, String>> {
    match command {
${armText}
        _ => None,
    }
}
`;

if (process.argv.includes('--check')) {
  const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (existing !== header) {
    process.stderr.write(
      'rpc_generated.rs is out of date — run: node scripts/gen_webrpc.cjs\n',
    );
    process.exit(1);
  }
  console.log('rpc_generated.rs is up to date');
  process.exit(0);
}

fs.writeFileSync(OUT, header);
console.log(`Generated ${OUT}`);
console.log(`Arms: ${new Set(arms).size} (registered commands: ${registered.size})`);
if (skipped.length) console.log('Skipped:', skipped.join(', '));
