/**
 * The Markdown block and inline parsers behind the renderer, kept free of React
 * Native so they run under `node --test`: paragraphs, headings (# to ###),
 * bullet and numbered lists, block quotes, rules, fenced code blocks, pipe
 * tables, and inline `code`, **bold**, *italic* and [links](url). Anything else
 * stays plain text.
 */

export type Block =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "list"; ordered: boolean; items: { text: string; depth: number; marker: string }[] }
  | { kind: "quote"; text: string }
  | { kind: "code"; lang: string; text: string }
  | { kind: "table"; header: string[]; aligns: ("left" | "center" | "right")[]; rows: string[][] }
  | { kind: "rule" };

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "bold"; children: Inline[] }
  | { kind: "italic"; children: Inline[] }
  | { kind: "link"; url: string; children: Inline[] };

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^(\s*)([-*+])\s+(.*)$/;
const NUMBERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
/** A header separator row: pipes and dashes with optional alignment colons. */
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/;

function splitRow(line: string): string[] {
  const trimmed = line.trim();
  const inner = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  const body = inner.endsWith("|") ? inner.slice(0, -1) : inner;
  return body.split("|").map((cell) => cell.trim());
}

/** The table starting at `index` (header, separator, rows), or `undefined` for prose that happens to hold a pipe. */
function tableAt(
  lines: string[],
  index: number,
): { block: Extract<Block, { kind: "table" }>; end: number } | undefined {
  const headerLine = lines[index] ?? "";
  const separator = lines[index + 1] ?? "";
  if (!headerLine.includes("|") || !TABLE_SEPARATOR.test(separator)) return undefined;
  const header = splitRow(headerLine);
  const cells = splitRow(separator);
  if (header.length === 0 || header.length !== cells.length) return undefined;
  const aligns = cells.map((cell): "left" | "center" | "right" => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    return right ? "right" : "left";
  });
  const rows: string[][] = [];
  let at = index + 2;
  while (at < lines.length) {
    const line = lines[at] ?? "";
    if (line.trim() === "" || !line.includes("|")) break;
    const row = splitRow(line);
    rows.push(header.map((_, column) => row[column] ?? ""));
    at += 1;
  }
  return { block: { kind: "table", header, aligns, rows }, end: at - 1 };
}

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = (): void => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const fence = FENCE.exec(line);
    if (fence !== null) {
      flush();
      const marker = fence[1] ?? "```";
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").trim().startsWith(marker)) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      // An unclosed fence (still streaming) runs to the end of the text.
      blocks.push({ kind: "code", lang: fence[2] ?? "", text: body.join("\n") });
      continue;
    }
    if (line.trim() === "") {
      flush();
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
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      flush();
      const level = Math.min(3, (heading[1] ?? "#").length) as 1 | 2 | 3;
      blocks.push({ kind: "heading", level, text: heading[2] ?? "" });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet === null ? NUMBERED.exec(line) : null;
    const item = bullet ?? numbered;
    if (item !== null) {
      flush();
      const ordered = numbered !== null;
      const depth = Math.min(4, Math.floor((item[1] ?? "").replace(/\t/g, "  ").length / 2));
      const entry = { text: item[3] ?? "", depth, marker: ordered ? `${item[2] ?? "1"}.` : "•" };
      const previous = blocks.at(-1);
      if (previous?.kind === "list" && (previous.ordered === ordered || depth > 0)) previous.items.push(entry);
      else blocks.push({ kind: "list", ordered, items: [entry] });
      continue;
    }
    const quote = QUOTE.exec(line);
    if (quote !== null) {
      flush();
      const previous = blocks.at(-1);
      if (previous?.kind === "quote") previous.text += `\n${quote[1] ?? ""}`;
      else blocks.push({ kind: "quote", text: quote[1] ?? "" });
      continue;
    }
    // A lazy continuation line of the previous list item.
    const previous = blocks.at(-1);
    if (paragraph.length === 0 && previous?.kind === "list" && /^\s+\S/.test(line)) {
      const last = previous.items.at(-1);
      if (last !== undefined) {
        last.text += ` ${line.trim()}`;
        continue;
      }
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

const INLINE =
  /(`+)([\s\S]*?[^`])\1(?!`)|\*\*(?=\S)([\s\S]+?)\*\*|__(?=\S)([\s\S]+?)__|\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\*(?=[^\s*])([\s\S]*?[^\s*])\*|\b_(?=[^\s_])([\s\S]*?[^\s_])_\b/;

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let rest = source;
  while (rest.length > 0) {
    const match = INLINE.exec(rest);
    if (match === null) {
      out.push({ kind: "text", text: rest });
      break;
    }
    if (match.index > 0) out.push({ kind: "text", text: rest.slice(0, match.index) });
    if (match[2] !== undefined) out.push({ kind: "code", text: match[2].trim() === "" ? match[2] : match[2].trim() });
    else if (match[3] !== undefined || match[4] !== undefined)
      out.push({ kind: "bold", children: parseInline(match[3] ?? match[4] ?? "") });
    else if (match[5] !== undefined) out.push({ kind: "link", url: match[6] ?? "", children: parseInline(match[5]) });
    else out.push({ kind: "italic", children: parseInline(match[7] ?? match[8] ?? "") });
    rest = rest.slice(match.index + match[0].length);
  }
  return out;
}
