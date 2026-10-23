/**
 * Terminal QR codes for the pairing URI, drawn with Unicode half blocks.
 *
 * Each text line carries two module rows: "▀" is a dark top half, "▄" a dark
 * bottom half, "█" both and a space neither. Dark modules are the terminal's
 * foreground and the quiet zone is plain spaces, so on a light terminal the
 * code is dark on light, and on a dark terminal it is the same code inverted,
 * which the phone scanners (ML Kit, Vision) read as well. No colors are used,
 * so the output survives logs, tmux and terminals without ANSI support.
 */
import qrcode from "qrcode-generator";

/** Modules of blank margin on every side. */
export const QUIET_ZONE = 2;

/** Error correction level: M survives a slightly blurry photo of a screen. */
const LEVEL = "M";

/**
 * The QR module matrix for `text`, `true` for a dark module.
 * @param {string} text
 * @returns {boolean[][]}
 */
export function qrMatrix(text) {
  // Type 0 picks the smallest version that fits; byte mode keeps URIs intact.
  const code = qrcode(0, LEVEL);
  code.addData(text, "Byte");
  code.make();
  const size = code.getModuleCount();
  const rows = [];
  for (let row = 0; row < size; row += 1) {
    const cells = [];
    for (let col = 0; col < size; col += 1) cells.push(code.isDark(row, col));
    rows.push(cells);
  }
  return rows;
}

/**
 * Render `text` as a QR code of half blocks with a blank quiet zone.
 * Every line has the same width; lines are joined with "\n" (no trailing newline).
 * @param {string} text
 * @returns {string}
 */
export function renderQr(text) {
  const matrix = qrMatrix(text);
  const size = matrix.length;
  const total = size + QUIET_ZONE * 2;
  /** Whether the module at (row, col) of the padded grid is dark. */
  const dark = (row, col) => {
    const r = row - QUIET_ZONE;
    const c = col - QUIET_ZONE;
    return r >= 0 && r < size && c >= 0 && c < size && matrix[r][c] === true;
  };
  const lines = [];
  // An odd row count leaves the last line's bottom half outside the grid: blank.
  for (let row = 0; row < total; row += 2) {
    let line = "";
    for (let col = 0; col < total; col += 1) {
      const top = dark(row, col);
      const bottom = row + 1 < total && dark(row + 1, col);
      line += top ? (bottom ? "█" : "▀") : bottom ? "▄" : " ";
    }
    lines.push(line);
  }
  return lines.join("\n");
}
