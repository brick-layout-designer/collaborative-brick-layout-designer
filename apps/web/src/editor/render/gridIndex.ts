// Grid cell-index labels — the `DisplayCellIndex` option of a Grid layer,
// as BlueBrick's LayerGrid.draw and desktop MapView::drawCellIndices
// (MapViewPaint.cpp:115-140) draw them: column labels along the origin
// cell's row and row labels down its column, each centred in its cell,
// counting from 1 at the cell after the origin. The origin cell and cells
// before it stay blank.
//
// Column / row types: 0 = Letters (A, B, ..., Z, AA, ...), 1 = Numbers
// (1, 2, ...) — core::CellIndexType. Pure, for tests.

export interface CellCorner {
  x: number;
  y: number;
}

/** Desktop LayerGrid::cellIndexLabel: 1 → "A" / "1", 27 → "AA"; blank for n ≤ 0. */
export function cellIndexLabel(n: number, letters: boolean): string {
  if (n <= 0) return '';
  if (!letters) return String(n);
  let out = '';
  let rest = n;
  do {
    out = String.fromCharCode(65 + ((rest - 1) % 26)) + out;
    rest = rest % 26 === 0 ? rest / 26 - 1 : Math.floor(rest / 26);
  } while (rest > 0);
  return out;
}

const isLetters = (type: string | number) => String(type).trim() !== '1';

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
  /** Top-left of the cell, in studs; the text is centred in the cell. */
  x: number;
  y: number;
  text: string;
}

/** Labels for the origin row and column cells overlapping the stud bounds. */
export function cellIndexLabels(
  bounds: { xMin: number; yMin: number; xMax: number; yMax: number },
  cellSize: number,
  corner: CellCorner,
  columnType: string | number,
  rowType: string | number,
): CellLabel[] {
  if (!(cellSize > 0)) return [];
  const out: CellLabel[] = [];
  const push = (cx: number, cy: number, text: string) => {
    if (text) out.push({ x: cx * cellSize, y: cy * cellSize, text });
  };
  // Column labels along the origin row, when that row is in view.
  if ((corner.y + 1) * cellSize > bounds.yMin && corner.y * cellSize < bounds.yMax) {
    const first = Math.max(corner.x, Math.floor(bounds.xMin / cellSize));
    const last = Math.ceil(bounds.xMax / cellSize);
    for (let x = first; x <= last; x++) push(x, corner.y, cellIndexLabel(x - corner.x, isLetters(columnType)));
  }
  // Row labels down the origin column, when that column is in view.
  if ((corner.x + 1) * cellSize > bounds.xMin && corner.x * cellSize < bounds.xMax) {
    const first = Math.max(corner.y, Math.floor(bounds.yMin / cellSize));
    const last = Math.ceil(bounds.yMax / cellSize);
    for (let y = first; y <= last; y++) push(corner.x, y, cellIndexLabel(y - corner.y, isLetters(rowType)));
  }
  return out;
}

/** The grid layer that draws: the first visible one, like desktop (MapViewPaint.cpp:71-73). */
export function drawnGridLayer<L extends { type: string; visible: boolean }>(layers: readonly L[]): L | undefined {
  return layers.find((l) => l.type === 'grid' && l.visible);
}
