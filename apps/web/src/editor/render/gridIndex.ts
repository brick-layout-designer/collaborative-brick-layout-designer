// Grid cell-index labels ("A1", "B1", ...) — the `DisplayCellIndex`
// option of a Grid layer (core/LayerGrid.h:31-38, saved by
// saveload/LayerIO.cpp:148-153). The desktop port keeps the fields and
// the dialog checkbox (MainWindow.cpp:199-201) but draws no labels; this
// follows vanilla BlueBrick, which writes a column + row label in the
// top-left corner of every cell.
//
// Column / row types: 0 = Letters (A, B, ..., Z, AA, ...), 1 = Numbers
// (1, 2, ...) — core::CellIndexType. The cell at `corner` (in cell units)
// is index 0 → "A" / "1"; cells before it count backwards with a leading
// minus ("-A", "-1"). Pure, for tests.

export interface CellCorner {
  x: number;
  y: number;
}

/** Letters label for a zero-based index: 0→A, 25→Z, 26→AA. */
function letters(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** Label for one axis. `type` is the stored CellIndexType ("0" letters, "1" numbers). */
export function axisLabel(index: number, type: string | number): string {
  const numbers = String(type).trim() === '1';
  if (index >= 0) return numbers ? String(index + 1) : letters(index);
  return `-${numbers ? String(-index) : letters(-index - 1)}`;
}

/**
 * The stored corner is a `<CellIndexCorner><X/><Y/></CellIndexCorner>`
 * point; depending on the reader it arrives as text. Take the first two
 * integers found, else (0, 0).
 */
export function parseCellIndexCorner(raw: unknown): CellCorner {
  if (raw && typeof raw === 'object') {
    const o = raw as { x?: unknown; y?: unknown; X?: unknown; Y?: unknown };
    const x = Number(o.x ?? o.X);
    const y = Number(o.y ?? o.Y);
    return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
  }
  const nums = String(raw ?? '').match(/-?\d+/g);
  if (!nums || nums.length < 2) return { x: 0, y: 0 };
  return { x: Number(nums[0]), y: Number(nums[1]) };
}

export interface CellLabel {
  /** Top-left of the cell, in studs. */
  x: number;
  y: number;
  text: string;
}

/**
 * Labels for every cell overlapping the stud bounds. Returns [] when more
 * than `maxLabels` cells would be labelled (zoomed far out).
 */
export function cellIndexLabels(
  bounds: { xMin: number; yMin: number; xMax: number; yMax: number },
  cellSize: number,
  corner: CellCorner,
  columnType: string | number,
  rowType: string | number,
  maxLabels = 400,
): CellLabel[] {
  if (!(cellSize > 0)) return [];
  const c0 = Math.floor(bounds.xMin / cellSize);
  const c1 = Math.floor(bounds.xMax / cellSize);
  const r0 = Math.floor(bounds.yMin / cellSize);
  const r1 = Math.floor(bounds.yMax / cellSize);
  if ((c1 - c0 + 1) * (r1 - r0 + 1) > maxLabels) return [];
  const out: CellLabel[] = [];
  for (let r = r0; r <= r1; r++) {
    const row = axisLabel(r - corner.y, rowType);
    for (let c = c0; c <= c1; c++) {
      out.push({ x: c * cellSize, y: r * cellSize, text: axisLabel(c - corner.x, columnType) + row });
    }
  }
  return out;
}
