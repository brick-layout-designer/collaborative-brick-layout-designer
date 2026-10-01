// Tables that turn into cards on a phone. Wide admin tables (nine columns
// of users, clubs, layouts…) can't be read by scrolling sideways on a
// 360 px screen, so inside a `.cards-on-phone` box each row becomes a card
// with every value labelled by its column (styles.css). The labels come
// from the table's own header, copied onto each cell as data-label.

import { useCallback, useEffect, useRef } from 'react';

/** Copy each column's header text onto its cells, for the phone card view. */
export function labelTableCells(root: ParentNode): void {
  for (const table of root.querySelectorAll('table')) {
    const heads = Array.from(table.querySelectorAll('thead th')).map((th) => (th.textContent ?? '').trim());
    for (const tr of table.querySelectorAll('tbody tr')) {
      let col = 0;
      for (const cell of tr.children) {
        const span = (cell as HTMLTableCellElement).colSpan || 1;
        // A cell across the whole row (an "empty" message) has no label.
        const label = span > 1 ? '' : (heads[col] ?? '');
        if (cell.getAttribute('data-label') !== label) cell.setAttribute('data-label', label);
        col += span;
      }
    }
  }
}

/** A ref for the box whose tables become cards: keeps their cells labelled as they load and change. */
export function useCardTables(): (el: HTMLElement | null) => void {
  const watch = useRef<MutationObserver | null>(null);
  useEffect(() => () => watch.current?.disconnect(), []);
  return useCallback((el: HTMLElement | null) => {
    watch.current?.disconnect();
    watch.current = null;
    if (!el) return;
    labelTableCells(el);
    watch.current = new MutationObserver(() => labelTableCells(el));
    watch.current.observe(el, { childList: true, subtree: true });
  }, []);
}
