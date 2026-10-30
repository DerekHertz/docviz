// One hop of context for a step check: the definitions of the functions a step's code calls.
// A step label often names what a helper does ("charge the exact cost"); without the helper's
// code that claim can't be checked. Callers, settings and other context stay out on purpose.

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'new', 'await', 'async',
  'super', 'import', 'export', 'def', 'elif', 'with', 'not', 'and', 'or', 'in', 'lambda', 'class', 'yield', 'assert', 'else', 'try']);

const EXT = { js: /\.(m|c)?[jt]sx?$/, py: /\.py$/ };
const TEST_PATH = /(^|\/)(node_modules|tests?|__tests__|e2e|test-support)\/|\.(test|spec)\.[^/]+$|(^|\/)test_[^/]*\.py$|_test\.py$/;

export const langOf = (path) => (EXT.py.test(path) ? 'py' : EXT.js.test(path) ? 'js' : null);

// Built-ins and methods every codebase has: following them would add unrelated code, and
// unrelated context makes Jev less accurate.
const BUILTINS = new Set(['setTimeout', 'clearTimeout', 'setInterval', 'Promise', 'Number', 'String', 'Object', 'Array', 'JSON',
  'Math', 'Boolean', 'Error', 'Date', 'Map', 'Set', 'RegExp', 'Symbol', 'require', 'fetch', 'parseInt', 'parseFloat', 'isNaN',
  'len', 'str', 'int', 'float', 'bool', 'isinstance', 'print', 'range', 'list', 'dict', 'set', 'tuple', 'max', 'min', 'any',
  'all', 'next', 'sorted', 'enumerate', 'zip', 'open', 'sum', 'abs', 'round', 'getattr', 'hasattr', 'type', 'iter', 'repr']);
const METHODS = new Set(['get', 'set', 'has', 'add', 'delete', 'find', 'filter', 'map', 'reduce', 'sort', 'push', 'pop', 'shift',
  'split', 'join', 'trim', 'test', 'match', 'matchAll', 'replace', 'slice', 'splice', 'includes', 'indexOf', 'some', 'every',
  'forEach', 'entries', 'keys', 'values', 'then', 'catch', 'finally', 'toString', 'concat', 'startsWith', 'endsWith', 'log',
  'error', 'warn', 'info', 'json', 'text', 'abort', 'race', 'resolve', 'reject', 'cwd', 'exec', 'bind', 'call', 'apply',
  'append', 'extend', 'strip', 'lower', 'upper', 'format', 'search', 'findall', 'fullmatch', 'sub', 'rfind', 'items',
  'splitlines', 'encode', 'decode', 'write', 'read', 'close', 'update', 'copy', 'trimEnd', 'trimStart', 'padStart', 'toFixed']);

// Code with string literals and comments blanked, so "translation failed (" isn't a call.
const codeOnly = (code) => code
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')
  .replace(/^\s*#.*$/gm, '')
  .replace(/`(?:\\[\s\S]|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, '""');

/** Names called in `code`, in order of first call: no keywords, built-ins, common methods or its own name. */
export function calledNames(code, self) {
  const out = [];
  for (const m of codeOnly(code).matchAll(/(\.\s*)?([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = m[2];
    if (name === self || KEYWORDS.has(name) || BUILTINS.has(name) || (m[1] && METHODS.has(name)) || out.includes(name)) continue;
    out.push(name);
  }
  return out;
}

const esc = (s) => s.replace(/[$]/g, '\\$');
const defLine = (lang, name) => (lang === 'py'
  ? new RegExp(`^(\\s*)(async\\s+)?def\\s+${esc(name)}\\s*\\(`)
  : new RegExp(`^(\\s*)(?:(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s*\\*?\\s*${esc(name)}\\s*[(<]|(?:export\\s+)?(?:const|let|var)\\s+${esc(name)}\\s*[=:]|(?:async\\s+)?${esc(name)}\\s*\\([^)]*\\)\\s*(?::[^={]+)?\\{)`));

const indentOf = (line) => line.match(/^\s*/)[0].length;
const braces = (line) => (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;

// The 0-based index of a definition's last line.
function blockEnd(lines, start, lang) {
  const indent = indentOf(lines[start]);
  if (lang === 'py') {
    let end = start;
    for (let i = start + 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      if (indentOf(lines[i]) <= indent) break;
      end = i;
    }
    return end;
  }
  let depth = braces(lines[start]);
  if (depth <= 0 && !/[(=>,]\s*$/.test(lines[start])) return start;
  for (let i = start + 1; i < lines.length; i++) {
    depth += braces(lines[i]);
    if (depth <= 0 && (indentOf(lines[i]) <= indent || /^\s*[)}\]]/.test(lines[i]))) return i;
  }
  return start;
}

/**
 * Definitions of what `code` calls, found in `files` (read with `read(path)`) of the same language,
 * tests left out. Each is at most `maxLines` lines; all together at most `budget` characters.
 */
export function definitionsCalled(code, { files, read, self, lang, maxLines = 25, budget = 2500 }) {
  const pool = files.filter((p) => langOf(p) === lang && !TEST_PATH.test(p));
  const out = [];
  let used = 0;
  for (const name of calledNames(code, self)) {
    const re = defLine(lang, name);
    let found = null;
    for (const path of pool) {
      const text = read(path);
      if (!text || !text.includes(name)) continue;
      const lines = text.split('\n');
      const at = lines.findIndex((l) => re.test(l));
      if (at < 0) continue;
      const end = blockEnd(lines, at, lang);
      const body = lines.slice(at, end + 1);
      const shown = body.length > maxLines ? [...body.slice(0, maxLines), `… (${body.length - maxLines} more lines)`] : body;
      found = { name, path, start: at + 1, end: end + 1, text: shown.join('\n') };
      break;
    }
    if (!found || used + found.text.length > budget) continue;
    used += found.text.length;
    out.push(found);
  }
  return out;
}

export const contextText = (defs) => defs.map((d) => `// ${d.path}:${d.start}-${d.end} (${d.name}, called by the step)\n${d.text}`).join('\n\n');
