/**
 * Column widths for a Markdown table on a phone, kept free of React Native so
 * it runs under `node --test`. A column is as wide as its longest cell's text,
 * between a minimum that keeps short columns from crowding and a maximum past
 * which a cell wraps; a table narrower than its space spreads to fill it, a
 * wider one keeps its widths and scrolls sideways.
 */

const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]|[\u{20000}-\u{3fffd}]/u;

/** How many of `text`'s characters are wide (CJK, fullwidth) and how many narrow. */
function countWidths(text: string): { narrow: number; wide: number } {
  let narrow = 0;
  let wide = 0;
  for (const char of text) {
    if ((char.codePointAt(0) ?? 0) >= 0x1100 && WIDE.test(char)) wide += 1;
    else narrow += 1;
  }
  return { narrow, wide };
}

/** Display columns of `text`: wide (CJK, fullwidth) characters take two. */
export function displayColumns(text: string): number {
  const { narrow, wide } = countWidths(text);
  return narrow + 2 * wide;
}

/** A run of a cell's text; `mono` runs are inline code, set in the wider monospace face. */
export interface Run {
  text: string;
  mono?: boolean;
}

/** A cell's plain text, or its runs when some of it is code. */
export type Cell = string | readonly Run[];

export interface TableMetrics {
  /** Width of a narrow (Latin, digit) character of cell text, in points. */
  charWidth: number;
  /** Width of a wide (CJK, fullwidth) character; two `charWidth`s when absent. */
  wideWidth?: number;
  /** Width of one display column of inline code in a cell; `charWidth` when absent. */
  monoWidth?: number;
  /** Horizontal padding inside a cell, both sides together. */
  padding: number;
  minColumn: number;
  maxColumn: number;
}

/** The width a cell's text needs on one line, in points. */
export function cellWidth(cell: Cell, metrics: TableMetrics): number {
  const runs = typeof cell === "string" ? [{ text: cell }] : cell;
  const wideWidth = metrics.wideWidth ?? 2 * metrics.charWidth;
  return runs.reduce((sum, run) => {
    if (run.mono === true) return sum + displayColumns(run.text) * (metrics.monoWidth ?? metrics.charWidth);
    const { narrow, wide } = countWidths(run.text);
    return sum + narrow * metrics.charWidth + wide * wideWidth;
  }, 0);
}

/**
 * Natural widths for each column, from the text of its header and cells.
 * The header weighs a little more, as it is set in a heavier weight.
 */
export function columnWidths(header: readonly Cell[], rows: readonly (readonly Cell[])[], metrics: TableMetrics): number[] {
  return header.map((head, column) => {
    const longest = Math.max(cellWidth(head, metrics) * 1.08, ...rows.map((row) => cellWidth(row[column] ?? "", metrics)));
    return Math.round(Math.min(metrics.maxColumn, Math.max(metrics.minColumn, longest + metrics.padding)));
  });
}

/** Widths spread over `available` when they leave room, unchanged when they need to scroll. */
export function fitColumns(widths: number[], available: number): number[] {
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (total === 0 || available <= total + 1) return widths;
  const scale = available / total;
  const fitted = widths.map((width) => Math.floor(width * scale));
  // Give the rounding remainder to the last column, so the table ends flush with its box.
  const rest = Math.floor(available) - fitted.reduce((sum, width) => sum + width, 0);
  fitted[fitted.length - 1] = (fitted[fitted.length - 1] ?? 0) + Math.max(0, rest);
  return fitted;
}

/**
 * Widths pulled in to `available` when they overshoot it by no more than
 * `slack` (a share of it): the estimate errs wide, and a table that nearly fits
 * reads better whole than scrolled a few points. Wider tables keep their
 * widths and scroll.
 */
export function shrinkColumns(widths: number[], available: number, slack = 0.15): number[] {
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (available <= 0 || total <= available || total > available * (1 + slack)) return widths;
  const scale = available / total;
  return widths.map((width) => Math.floor(width * scale));
}
