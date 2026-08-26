/**
 * Minimal YAML front-matter reader.
 *
 * Agents, skills and slash commands are *not* loaded whole into every session.
 * The runtime reads each definition's front matter, its `name` and
 * `description`, so the model knows what exists, and only pulls the body in
 * when the definition is actually invoked. Splitting the two is what lets
 * ctxdiet report a per-session cost that matches reality instead of charging
 * every session for text nobody read.
 *
 * Deliberately not a YAML parser: front matter in these files is a flat block
 * of `key: value` lines, and pulling in a YAML dependency to read two keys
 * would cost more than it is worth.
 */
export interface Frontmatter {
  /** Raw front-matter block, delimiters included. Empty when there is none. */
  block: string;
  /** Everything after the front matter. */
  body: string;
  fields: Record<string, string>;
}

const DELIM = /^---[ \t]*$/;

export function parseFrontmatter(content: string): Frontmatter {
  const lines = content.split("\n");
  if (lines.length === 0 || !DELIM.test(lines[0] ?? "")) {
    return { block: "", body: content, fields: {} };
  }

  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (DELIM.test(lines[i] ?? "")) {
      end = i;
      break;
    }
  }
  if (end < 0) return { block: "", body: content, fields: {} }; // unterminated

  const block = lines.slice(0, end + 1).join("\n");
  const body = lines.slice(end + 1).join("\n");
  const fields: Record<string, string> = {};
  for (const raw of lines.slice(1, end)) {
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(raw);
    if (!m) continue;
    const key = m[1];
    if (key === undefined) continue;
    fields[key.toLowerCase()] = (m[2] ?? "").trim().replace(/^["']|["']$/g, "");
  }
  return { block, body, fields };
}
