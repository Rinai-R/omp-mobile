/**
 * The Markdown parser behind the renderer, kept free of React Native so it runs
 * under `node --test`. It covers what agents write in chat replies: ATX
 * headings (and `===` setext ones), paragraphs (a single newline stays a line
 * break, as chat apps keep it), nested bullet, numbered and task lists, nested
 * block quotes, rules, fenced code blocks, GFM pipe tables, and inline `code`,
 * **bold**, *italic*, ~~strike~~, [links](url), images (as links),
 * <autolinks>, bare URLs and backslash escapes. Anything else stays text.
 *
 * It is streaming-safe: an unclosed fence runs to the end of the text (marked
 * `open`), and half-written emphasis or a link shows as typed until it closes.
 */

export type Align = "left" | "center" | "right";

export interface ListItem {
  /** `true`/`false` for a task item (`- [x]` / `- [ ]`), absent otherwise. */
  checked?: boolean;
  blocks: Block[];
}

export type Block =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { kind: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { kind: "quote"; blocks: Block[] }
  /** `open`: the closing fence has not arrived yet (the reply is still streaming). */
  | { kind: "code"; lang: string; text: string; open: boolean }
  | { kind: "table"; header: string[]; aligns: Align[]; rows: string[][] }
  | { kind: "rule" };

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "bold"; children: Inline[] }
  | { kind: "italic"; children: Inline[] }
  | { kind: "strike"; children: Inline[] }
  | { kind: "link"; url: string; children: Inline[] };

const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^`\s]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const SETEXT = /^ {0,3}=+[ \t]*$/;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/;
const TASK = /^\[([ xX])\][ \t]+(.*)$/;
const QUOTE = /^ {0,3}>[ ]?(.*)$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
/** A header separator row: pipes and dashes with optional alignment colons. */
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function expandTabs(line: string): string {
  return line.includes("\t") ? line.replace(/\t/g, "    ") : line;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function blank(line: string | undefined): boolean {
  return line === undefined || line.trim() === "";
}

/** Strip up to `count` columns of leading spaces. */
function dedent(line: string, count: number): string {
  return line.slice(Math.min(count, indentOf(line)));
}

/** Cells of a table row; `\|` is a literal pipe, and pipes inside `code` do not split. */
export function splitRow(line: string): string[] {
  let body = line.trim();
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|") && !body.endsWith("\\|")) body = body.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  let inCode = false;
  for (let at = 0; at < body.length; at += 1) {
    const char = body[at] ?? "";
    if (char === "\\" && body[at + 1] === "|") {
      cell += "|";
      at += 1;
    } else if (char === "|" && !inCode) {
      cells.push(cell.trim());
      cell = "";
    } else {
      if (char === "`") inCode = !inCode;
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

/** The table starting at `index` (header, separator, rows), or `undefined` for prose that happens to hold a pipe. */
function tableAt(lines: string[], index: number): { block: Extract<Block, { kind: "table" }>; end: number } | undefined {
  const headerLine = lines[index] ?? "";
  const separator = lines[index + 1] ?? "";
  if (!headerLine.includes("|") || !separator.includes("|") || !TABLE_SEPARATOR.test(separator)) return undefined;
  const header = splitRow(headerLine);
  const cells = splitRow(separator);
  if (header.length === 0 || header.length !== cells.length) return undefined;
  const aligns = cells.map((cell): Align => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    return right ? "right" : "left";
  });
  const rows: string[][] = [];
  let at = index + 2;
  while (at < lines.length) {
    const line = lines[at] ?? "";
    if (blank(line) || !line.includes("|")) break;
    const row = splitRow(line);
    rows.push(header.map((_, column) => row[column] ?? ""));
    at += 1;
  }
  return { block: { kind: "table", header, aligns, rows }, end: at };
}

interface ItemStart {
  indent: number;
  ordered: boolean;
  /** The bullet character, or the number's delimiter: a change starts a new list. */
  marker: string;
  number: number;
  /** Where the item's content starts: continuation lines indented this far belong to it. */
  content: number;
  text: string;
}

function itemAt(line: string): ItemStart | undefined {
  const match = ITEM.exec(line);
  if (match === null) return undefined;
  const indent = (match[1] ?? "").length;
  const marker = match[2] ?? "-";
  const text = match[3] ?? "";
  const ordered = /\d/.test(marker);
  const gap = text === "" ? 1 : Math.min(4, Math.max(1, line.length - indent - marker.length - text.length));
  return {
    indent,
    ordered,
    marker: ordered ? marker.slice(-1) : marker,
    number: ordered ? Number.parseInt(marker, 10) : 1,
    content: indent + marker.length + gap,
    text,
  };
}

/** Whether `line` starts a block that ends a paragraph above it. */
function interrupts(line: string): boolean {
  if (FENCE.test(line) || HEADING.test(line) || QUOTE.test(line) || RULE.test(line)) return true;
  const item = itemAt(line);
  return item !== undefined && item.text.trim() !== "";
}

/** A closing fence for `marker`: the same character, at least as long, nothing after it. */
function closesFence(line: string, marker: string): boolean {
  const trimmed = line.trim();
  return /^(`{3,}|~{3,})$/.test(trimmed) && trimmed[0] === marker[0] && trimmed.length >= marker.length;
}

function parseLines(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = (): void => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", text: paragraph.map((line) => line.trim()).join("\n") });
    paragraph = [];
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";

    const fence = FENCE.exec(line);
    if (fence !== null) {
      flush();
      const marker = fence[1] ?? "```";
      const indent = indentOf(line);
      const body: string[] = [];
      let open = true;
      index += 1;
      while (index < lines.length) {
        const next = lines[index] ?? "";
        index += 1;
        if (closesFence(next, marker)) {
          open = false;
          break;
        }
        body.push(dedent(next, indent));
      }
      blocks.push({ kind: "code", lang: fence[2] ?? "", text: body.join("\n"), open });
      continue;
    }

    if (blank(line)) {
      flush();
      index += 1;
      continue;
    }

    if (paragraph.length > 0 && SETEXT.test(line)) {
      const text = paragraph.map((part) => part.trim()).join(" ");
      paragraph = [];
      blocks.push({ kind: "heading", level: 1, text });
      index += 1;
      continue;
    }

    const table = tableAt(lines, index);
    if (table !== undefined) {
      flush();
      blocks.push(table.block);
      index = table.end;
      continue;
    }

    if (RULE.test(line)) {
      flush();
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading !== null) {
      flush();
      const level = (heading[1] ?? "#").length as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ kind: "heading", level, text: (heading[2] ?? "").trim() });
      index += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      flush();
      const inner: string[] = [];
      while (index < lines.length) {
        const next = lines[index] ?? "";
        const quoted = QUOTE.exec(next);
        if (quoted !== null) inner.push(quoted[1] ?? "");
        // A lazy continuation: prose right under a quoted line stays in the quote.
        else if (!blank(next) && !blank(inner.at(-1)) && !interrupts(next)) inner.push(next);
        else break;
        index += 1;
      }
      blocks.push({ kind: "quote", blocks: parseLines(inner) });
      continue;
    }

    const start = itemAt(line);
    if (start !== undefined && (paragraph.length === 0 || interrupts(line))) {
      flush();
      const list = parseList(lines, index, start);
      blocks.push(list.block);
      index = list.end;
      continue;
    }

    paragraph.push(line);
    index += 1;
  }
  flush();
  return blocks;
}

/** A list from `index` on, each item parsed as blocks of its own; `end` is the first line after it. */
function parseList(lines: string[], index: number, first: ItemStart): { block: Extract<Block, { kind: "list" }>; end: number } {
  const items: ListItem[] = [];
  let at = index;
  let current: ItemStart | undefined = first;
  while (current !== undefined) {
    const body: string[] = [current.text];
    at += 1;
    let fenced: string | undefined;
    while (at < lines.length) {
      const line = lines[at] ?? "";
      if (blank(line)) {
        // A blank line ends the item unless what follows is indented into it.
        let next = at + 1;
        while (next < lines.length && blank(lines[next])) next += 1;
        const after = lines[next];
        if (fenced === undefined && (after === undefined || indentOf(after) < current.content)) break;
        body.push("");
        at += 1;
        continue;
      }
      const indent = indentOf(line);
      const nested = itemAt(line);
      if (indent >= current.content || fenced !== undefined) {
        body.push(dedent(line, current.content));
      } else if (nested !== undefined && nested.indent > current.indent) {
        // Agents often indent nested items by two spaces under "1. ": any deeper item is nested.
        body.push(dedent(line, indent));
      } else if (nested === undefined && !blank(body.at(-1)) && !interrupts(line) && !line.includes("|")) {
        // A lazy continuation of the item's last paragraph.
        body.push(line.trim());
      } else {
        break;
      }
      const fence = FENCE.exec(body.at(-1) ?? "");
      if (fenced !== undefined) {
        if (closesFence(body.at(-1) ?? "", fenced)) fenced = undefined;
      } else if (fence !== null) {
        fenced = fence[1];
      }
      at += 1;
    }
    const task = current.ordered ? null : TASK.exec(body[0] ?? "");
    if (task !== null) body[0] = task[2] ?? "";
    const item: ListItem = { blocks: parseLines(body) };
    if (task !== null) item.checked = (task[1] ?? " ") !== " ";
    items.push(item);

    // The next item of the same list, possibly after blank lines.
    let next = at;
    while (next < lines.length && blank(lines[next])) next += 1;
    const line = lines[next] ?? "";
    const candidate = next < lines.length ? itemAt(line) : undefined;
    if (
      candidate !== undefined &&
      candidate.ordered === first.ordered &&
      candidate.marker === first.marker &&
      candidate.indent <= first.indent + 1 &&
      !RULE.test(line)
    ) {
      at = next;
      current = candidate;
    } else {
      current = undefined;
    }
  }
  return { block: { kind: "list", ordered: first.ordered, start: first.number, items }, end: at };
}

export function parseBlocks(source: string): Block[] {
  return parseLines(source.replace(/\r\n?/g, "\n").split("\n").map(expandTabs));
}

const CACHE_LIMIT = 300;
const cache = new Map<string, Block[]>();

/**
 * `parseBlocks`, remembered by text: rows of a long transcript render again as
 * they scroll back into view, and their text has not changed.
 */
export function parseMarkdown(source: string): Block[] {
  const known = cache.get(source);
  if (known !== undefined) {
    cache.delete(source);
    cache.set(source, known);
    return known;
  }
  const blocks = parseBlocks(source);
  cache.set(source, blocks);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return blocks;
}

/** Punctuation that ends a sentence after a bare URL rather than belonging to it (ASCII and CJK). */
const URL_TAIL = /[.,:;!?'"\]}*_~]$/;
const URL_BODY = /^(?:https?:\/\/|www\.)[^\s<>"'`，。；：！？、（）《》「」『』【】]+/i;

/** The URL at the start of `text`, without the punctuation that usually follows one. */
function bareUrl(text: string): string | undefined {
  const match = URL_BODY.exec(text);
  if (match === null) return undefined;
  let url = match[0];
  for (;;) {
    if (URL_TAIL.test(url)) url = url.slice(0, -1);
    // A closing paren only when it closes one inside the URL (Wikipedia links).
    else if (url.endsWith(")") && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) url = url.slice(0, -1);
    else break;
  }
  return /^(?:https?:\/\/|www\.)[^./]+\.?/i.test(url) && url.length > 10 ? url : undefined;
}

const ESCAPABLE = "\\`*_{}[]()#+-.!|~<>\n";

/** A letter or digit of a script that separates words by spaces, so `_` beside it is part of a word. */
function wordChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9\u00c0-\u024f]/.test(char);
}

function space(char: string | undefined): boolean {
  return char === undefined || /\s/.test(char);
}

/** The end of the code span opening at `at`, or -1. */
function codeEnd(source: string, at: number): { end: number; run: number } | undefined {
  let run = 0;
  while (source[at + run] === "`") run += 1;
  const tick = "`".repeat(run);
  let from = at + run;
  for (;;) {
    const end = source.indexOf(tick, from);
    if (end === -1) return undefined;
    if (source[end + run] !== "`") return { end, run };
    from = end + run;
    while (source[from] === "`") from += 1;
  }
}

/**
 * Where the run of `length` `char`s that closes emphasis opened just before
 * `from` sits, skipping code spans and runs of another length; -1 when it
 * never closes (yet). One linear scan, so unclosed markers cannot blow up.
 */
function emphasisEnd(source: string, from: number, char: string, length: number): number {
  /** Runs of the other emphasis length seen so far: an odd count means one is open inside this one. */
  let others = 0;
  for (let at = from; at < source.length; at += 1) {
    const current = source[at];
    if (current === "\\") {
      at += 1;
      continue;
    }
    if (current === "`") {
      const code = codeEnd(source, at);
      if (code !== undefined) at = code.end + code.run - 1;
      continue;
    }
    if (current !== char) continue;
    let run = 0;
    while (source[at + run] === char) run += 1;
    const closes = at > from && !space(source[at - 1]) && !(char === "_" && wordChar(source[at + run]));
    if (closes && run === length) return at;
    // `***` closes an inner and an outer run at once: the inner one takes the first characters.
    if (closes && run === 3 && length !== 3) return others % 2 === 1 ? at + (3 - length) : at;
    if (run !== length) others += 1;
    at += run - 1;
  }
  return -1;
}

/** `[label](url "title")` at `at`: the label, the URL and the index after it. */
function linkAt(source: string, at: number): { label: string; url: string; end: number } | undefined {
  let depth = 0;
  let close = -1;
  for (let index = at; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        close = index;
        break;
      }
    }
  }
  if (close === -1 || source[close + 1] !== "(") return undefined;
  const target = /^\(\s*<?([^\s<>()]*(?:\([^\s()]*\)[^\s<>()]*)*)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/.exec(source.slice(close + 1));
  if (target === null) return undefined;
  return { label: source.slice(at + 1, close), url: target[1] ?? "", end: close + 1 + target[0].length };
}

/** Inline Markdown as nodes; adjacent text is merged. */
export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const push = (node: Inline): void => {
    if (text !== "") out.push({ kind: "text", text });
    text = "";
    out.push(node);
  };

  let at = 0;
  while (at < source.length) {
    const char = source[at] ?? "";

    if (char === "\\" && ESCAPABLE.includes(source[at + 1] ?? "\0")) {
      text += source[at + 1];
      at += 2;
      continue;
    }

    if (char === "`") {
      const code = codeEnd(source, at);
      if (code !== undefined) {
        const body = source.slice(at + code.run, code.end).replace(/\n/g, " ");
        push({ kind: "code", text: /^ .*\S.* $/.test(body) ? body.slice(1, -1) : body });
        at = code.end + code.run;
        continue;
      }
      let run = 0;
      while (source[at + run] === "`") run += 1;
      text += source.slice(at, at + run);
      at += run;
      continue;
    }

    if (char === "[" || (char === "!" && source[at + 1] === "[")) {
      const image = char === "!";
      const link = linkAt(source, image ? at + 1 : at);
      if (link !== undefined) {
        // An image shows as a link to it, by its alt text.
        const children = link.label.trim() === "" ? [{ kind: "text" as const, text: link.url }] : parseInline(link.label);
        push({ kind: "link", url: link.url, children });
        at = link.end;
        continue;
      }
    }

    if (char === "<") {
      const auto = /^<((?:https?|mailto):[^\s<>]+)>/i.exec(source.slice(at, at + 2048));
      if (auto !== null) {
        const url = auto[1] ?? "";
        push({ kind: "link", url, children: [{ kind: "text", text: url.replace(/^mailto:/i, "") }] });
        at += auto[0].length;
        continue;
      }
    }

    if ((char === "h" || char === "w" || char === "H" || char === "W") && !wordChar(source[at - 1])) {
      const url = bareUrl(source.slice(at, at + 2048));
      if (url !== undefined) {
        push({ kind: "link", url: /^www\./i.test(url) ? `https://${url}` : url, children: [{ kind: "text", text: url }] });
        at += url.length;
        continue;
      }
    }

    if (char === "~" && source[at + 1] === "~" && !space(source[at + 2])) {
      const end = emphasisEnd(source, at + 2, "~", 2);
      if (end !== -1) {
        push({ kind: "strike", children: parseInline(source.slice(at + 2, end)) });
        at = end + 2;
        continue;
      }
    }

    if (char === "*" || char === "_") {
      let run = 0;
      while (source[at + run] === char) run += 1;
      // `_` inside a word (snake_case) is not emphasis; `*` may be.
      const opens = run <= 3 && !space(source[at + run]) && !(char === "_" && wordChar(source[at - 1]));
      if (opens) {
        const end = emphasisEnd(source, at + run, char, run);
        if (end !== -1) {
          const inner = parseInline(source.slice(at + run, end));
          const node: Inline =
            run === 1
              ? { kind: "italic", children: inner }
              : run === 2
                ? { kind: "bold", children: inner }
                : { kind: "bold", children: [{ kind: "italic", children: inner }] };
          push(node);
          at = end + run;
          continue;
        }
      }
      text += source.slice(at, at + run);
      at += run;
      continue;
    }

    text += char;
    at += 1;
  }
  if (text !== "") out.push({ kind: "text", text });
  return out;
}

/** Plain text of inline Markdown, for measuring columns and accessibility. */
export function plainText(nodes: readonly Inline[]): string {
  return nodes.map((node) => (node.kind === "text" || node.kind === "code" ? node.text : plainText(node.children))).join("");
}
