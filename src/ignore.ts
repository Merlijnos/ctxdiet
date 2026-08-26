/**
 * gitignore-style pattern matching, enough of it to answer one question:
 * "does this ignore file already cover <path>?"
 *
 * The previous check compared strings after stripping a trailing slash, so a
 * perfectly good `.claudeignore` containing `**' + '/node_modules/**` or `node_modules/*`
 * was reported as "weak, heavy paths unignored", and `fix` then appended a
 * redundant block to it. Anything short of real matching produces false
 * positives on the ignore files people actually write.
 *
 * Implemented against the gitignore spec's rules that matter here: comments,
 * negation with `!`, anchoring with a leading or embedded `/`, directory-only
 * patterns with a trailing `/`, and `*` / `?` / `**` wildcards. Character
 * classes are passed through to the regex.
 */
export interface IgnoreRule {
  /** Original text, for reporting. */
  source: string;
  negated: boolean;
  dirOnly: boolean;
  /** Matches the path the pattern names. */
  selfRe: RegExp;
  /** Matches anything beneath that path. */
  descendantRe: RegExp;
}

/** Escape everything the pattern language does not give meaning to. */
function escapeLiteral(ch: string): string {
  return /[.+^${}()|[\]\\]/.test(ch) ? "\\" + ch : ch;
}

function toRegExp(pattern: string, anchored: boolean): { selfRe: RegExp; descendantRe: RegExp } {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "*") {
      const doubled = pattern[i + 1] === "*";
      if (doubled) {
        i++;
        // `**/` matches zero or more leading directories; a bare `**` matches
        // anything including separators.
        if (pattern[i + 1] === "/") {
          i++;
          out += "(?:.*/)?";
        } else {
          out += ".*";
        }
      } else {
        out += "[^/]*";
      }
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      continue;
    }
    out += escapeLiteral(ch);
  }
  // An unanchored pattern may match at any depth.
  const prefix = anchored ? "^" : "^(?:.*/)?";
  return {
    selfRe: new RegExp(`${prefix}${out}$`),
    descendantRe: new RegExp(`${prefix}${out}/.+$`),
  };
}

export function parseIgnoreRules(content: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const raw of content.split("\n")) {
    // A trailing backslash escapes the space before it; otherwise trailing
    // whitespace is not part of the pattern.
    let line = raw.replace(/(?<!\\)\s+$/, "");
    if (line === "" || line.startsWith("#")) continue;

    const negated = line.startsWith("!");
    if (negated) line = line.slice(1);
    if (line.startsWith("\\")) line = line.slice(1); // escaped leading # or !

    const dirOnly = line.endsWith("/");
    if (dirOnly) line = line.slice(0, -1);

    // A `/` anywhere but the end anchors the pattern to the ignore file's dir.
    const anchored = line.startsWith("/") || line.slice(0, -1).includes("/");
    if (line.startsWith("/")) line = line.slice(1);
    if (line === "") continue;

    rules.push({ source: raw.trim(), negated, dirOnly, ...toRegExp(line, anchored) });
  }
  return rules;
}

/**
 * Whether `relPath` is ignored. Later rules win, which is how `!` re-includes
 * a path an earlier pattern excluded.
 */
export function isIgnored(rules: IgnoreRule[], relPath: string, isDir: boolean): boolean {
  const p = relPath.replace(/^\.\//, "").replace(/\/$/, "");
  let ignored = false;
  for (const rule of rules) {
    // Everything under an ignored directory is ignored, whatever it is; the
    // directory-only restriction applies to the named path itself.
    const hit =
      rule.descendantRe.test(p) || (rule.selfRe.test(p) && (!rule.dirOnly || isDir));
    if (!hit) continue;
    ignored = !rule.negated;
  }
  return ignored;
}

/**
 * Whether an ignore file effectively keeps `name` out of context.
 *
 * Looser than `isIgnored` on purpose. `node_modules/*` and `node_modules/**`
 * do not ignore the directory entry itself under gitignore rules, but they do
 * exclude everything in it, which is the whole question ctxdiet is asking. So
 * a directory counts as covered when either the entry itself or its contents
 * are ignored.
 */
export function covers(rules: IgnoreRule[], name: string, isDir: boolean): boolean {
  if (isIgnored(rules, name, isDir)) return true;
  if (!isDir) return false;
  // Probe two depths: `dir/*` catches the first, `dir/**` the rest.
  return (
    isIgnored(rules, `${name}/probe`, false) &&
    isIgnored(rules, `${name}/probe/probe`, false)
  );
}
