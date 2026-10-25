export interface DiffLine {
  kind: "same" | "add" | "remove";
  text: string;
}

/** Above this many compared lines the edit is shown as a whole replacement, not aligned. */
const MAX_CELLS = 40_000;

function lcs(before: string[], after: string[]): DiffLine[] {
  if (before.length === 0) return after.map((text) => ({ kind: "add" as const, text }));
  if (after.length === 0) return before.map((text) => ({ kind: "remove" as const, text }));
  if (before.length * after.length > MAX_CELLS) {
    return [
      ...before.map((text) => ({ kind: "remove" as const, text })),
      ...after.map((text) => ({ kind: "add" as const, text })),
    ];
  }
  const rows = before.length + 1;
  const cols = after.length + 1;
  const table = Array.from({ length: rows }, () => new Uint32Array(cols));
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i]![j] = before[i] === after[j] ? (table[i + 1]![j + 1] ?? 0) + 1 : Math.max(table[i + 1]![j] ?? 0, table[i]![j + 1] ?? 0);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      lines.push({ kind: "same", text: before[i] ?? "" });
      i += 1;
      j += 1;
    } else if ((table[i + 1]![j] ?? 0) >= (table[i]![j + 1] ?? 0)) {
      lines.push({ kind: "remove", text: before[i] ?? "" });
      i += 1;
    } else {
      lines.push({ kind: "add", text: after[j] ?? "" });
      j += 1;
    }
  }
  while (i < before.length) {
    lines.push({ kind: "remove", text: before[i] ?? "" });
    i += 1;
  }
  while (j < after.length) {
    lines.push({ kind: "add", text: after[j] ?? "" });
    j += 1;
  }
  return lines;
}

/** Line diff for an edit: shared head and tail are kept as context, the middle is aligned. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  return [
    ...a.slice(0, start).map((text): DiffLine => ({ kind: "same", text })),
    ...lcs(a.slice(start, endA), b.slice(start, endB)),
    ...a.slice(endA).map((text): DiffLine => ({ kind: "same", text })),
  ];
}

/** The text an edit tool call carries, when it is a whole replacement instead of two sides. */
export function editInput(args: unknown): string | undefined {
  if (args === null || typeof args !== "object" || !("input" in args)) return undefined;
  const input = args.input;
  return typeof input === "string" && input.trim() !== "" ? input : undefined;
}

/** The two sides of an edit tool call, when it carries them. */
export function editSides(args: unknown): { before: string; after: string } | undefined {
  if (args === null || typeof args !== "object") return undefined;
  if (!("old_string" in args) || typeof args.old_string !== "string") return undefined;
  if (!("new_string" in args) || typeof args.new_string !== "string") return undefined;
  return { before: args.old_string, after: args.new_string };
}

/** An edit's lines: OMP's own result diff, the call's two sides diffed, or its preformatted input. */
export function editDiff(args: unknown, result: unknown): DiffLine[] | undefined {
  const details = result !== null && typeof result === "object" ? (result as { details?: { diff?: unknown } }).details : undefined;
  if (typeof details?.diff === "string" && details.diff.trim() !== "") {
    return details.diff.split("\n").map((line): DiffLine => {
      if (/^\+\s*\d+\|/.test(line)) return { kind: "add", text: line.slice(1) };
      if (/^-\s*\d+\|/.test(line)) return { kind: "remove", text: line.slice(1) };
      return { kind: "same", text: line.replace(/^ /, "") };
    });
  }
  const sides = editSides(args);
  if (sides !== undefined) return diffLines(sides.before, sides.after);
  const input = editInput(args);
  if (input === undefined) return undefined;
  return input.split("\n").map((line): DiffLine => {
    if (line.startsWith("+")) return { kind: "add", text: line.slice(1) };
    if (line.startsWith("-")) return { kind: "remove", text: line.slice(1) };
    return { kind: "same", text: line };
  });
}
