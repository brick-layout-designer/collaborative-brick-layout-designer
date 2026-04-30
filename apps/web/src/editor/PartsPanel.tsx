import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, spriteUrlFor, type PartWire } from '../api';
import { ensureSetThumbnail, getSetThumbnailSync } from './render/setThumbnail';

interface PartContextMenu {
  part: PartWire;
  x: number;
  y: number;
}

const ALL_CATEGORIES = '__all__';

type IconSize = 'S' | 'M' | 'L';
// Tile min-width and img size class for each icon size level.
const ICON_CFG: Record<IconSize, { minWidth: number; imgCls: string }> = {
  S: { minWidth: 56,  imgCls: 'h-8 w-8'   },
  M: { minWidth: 84,  imgCls: 'h-12 w-12' },
  L: { minWidth: 116, imgCls: 'h-16 w-16' },
};

export function PartsPanel({ onPlacePart }: { onPlacePart: (part: PartWire) => void }) {
  const [ctxMenu, setCtxMenu] = useState<PartContextMenu | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [iconSize, setIconSize] = useState<IconSize>(
    () => (localStorage.getItem('cld:partsIconSize') as IconSize | null) ?? 'M',
  );

  useEffect(() => {
    if (!ctxMenu) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    }
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [ctxMenu]);

  const { data, isLoading } = useQuery({
    queryKey: ['parts-catalog'],
    queryFn: api.parts.catalog,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });
  const [filter, setFilter] = useState('');
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);

  // Index by lowercase key + bare partNumber so the set-thumbnail
  // compositor can resolve each subpart's metadata.
  const partsByKey = useMemo(() => {
    const m = new Map<string, PartWire>();
    if (data) {
      for (const p of data.parts) {
        m.set(p.key.toLowerCase(), p);
        const bare = p.partNumber.toLowerCase();
        if (!m.has(bare)) m.set(bare, p);
      }
    }
    return m;
  }, [data]);

  // Categories come straight from the wire's `category` field — derived
  // server-side from the parent folder of the XML, matching desktop's
  // PartsBrowser::categoryForPath (PartsBrowser.cpp:198-202).
  const categories = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    for (const p of data.parts) set.add(p.category || 'Other');
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [data]);

  const visible = useMemo(() => {
    if (!data) return [];
    const needle = filter.trim().toLowerCase();
    const scored: { score: number; part: PartWire }[] = [];
    for (const p of data.parts) {
      if (category !== ALL_CATEGORIES && (p.category || 'Other') !== category) {
        continue;
      }
      // Same fuzzy hay as desktop (PartsBrowser.cpp:242):
      //   "<key> <description>" lowercased.
      const hay = `${p.key} ${p.description}`.toLowerCase();
      const score = fuzzyScore(needle, hay);
      if (score <= 0) continue;
      scored.push({ score, part: p });
    }
    if (needle.length === 0) {
      // Empty filter → alphabetical by key, like desktop's
      // grid_->sortItems(Qt::AscendingOrder) (PartsBrowser.cpp:353).
      scored.sort((a, b) => a.part.key.localeCompare(b.part.key));
    } else {
      // Stable sort by descending score, alphabetical tie-break by key
      // (PartsBrowser.cpp:336-341).
      scored.sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        return a.part.key.localeCompare(b.part.key);
      });
    }
    return scored.map((s) => s.part);
  }, [data, filter, category]);

  const cfg = ICON_CFG[iconSize];

  function cycleIconSize() {
    const next: IconSize = iconSize === 'S' ? 'M' : iconSize === 'M' ? 'L' : 'S';
    setIconSize(next);
    localStorage.setItem('cld:partsIconSize', next);
  }

  return (
    <aside className="relative flex h-full min-h-0 w-full flex-col bg-neutral-925 text-sm">
      <div className="space-y-2 border-b border-neutral-800 p-2">
        <div className="flex gap-1">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs"
          >
            <option value={ALL_CATEGORIES}>All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            onClick={cycleIconSize}
            title={`Icon size: ${iconSize} — click to cycle S/M/L`}
            className="shrink-0 rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-[10px] text-neutral-400 hover:bg-neutral-700"
          >
            {iconSize}
          </button>
        </div>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder='Fuzzy filter — e.g. "plt2" matches "plate2x4"'
          className="w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs"
        />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {isLoading && <p className="p-3 text-xs text-neutral-500">Loading catalog…</p>}
        {!isLoading && visible.length === 0 && (
          <p className="p-3 text-xs text-neutral-500">No parts match this filter.</p>
        )}
        {/*
          Auto-fill the column count based on panel width — mirrors
          desktop's PartsBrowser, which uses QListView::IconMode +
          QListView::Adjust (PartsBrowser.cpp:115-117) so resizing the
          dock reflows the thumbnail grid. Each cell is at least 84px
          wide (12-px h-12 thumbnail + caption + a few px padding); the
          grid grows to as many full columns as the available width
          allows.
        */}
        <ul
          className="grid gap-1 p-2"
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${cfg.minWidth}px, 1fr))` }}
        >
          {visible.map((p) => {
            // Caption + tooltip rules ported from PartsBrowser.cpp:215-228:
            //   caption: short description, else the part key
            //   tooltip: "<description>\n(<key>)", else just the key
            // Truncate captions at 27 chars + ellipsis so multi-line
            // wrapping doesn't make tiles tower over each other.
            const desc = p.description ?? '';
            const captionShort = desc.length > 28 ? desc.slice(0, 27) + '…' : desc;
            const caption = captionShort || p.key;
            const tooltip = desc ? `${desc}\n(${p.key})` : p.key;
            return (
              <li key={p.key}>
                <button
                  onClick={() => onPlacePart(p)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setCtxMenu({ part: p, x: e.clientX, y: e.clientY });
                  }}
                  draggable
                  onDragStart={(e) => {
                    if (e.dataTransfer) {
                      e.dataTransfer.effectAllowed = 'copy';
                      e.dataTransfer.setData('application/x-cld-part', p.key);
                      e.dataTransfer.setData('text/plain', p.key);
                    }
                  }}
                  title={tooltip}
                  className="flex w-full flex-col items-center rounded p-1 text-[10px] bg-neutral-900 hover:bg-neutral-800"
                >
                  <PartThumbnail part={p} partsByKey={partsByKey} imgCls={cfg.imgCls} />
                  <span className="mt-1 line-clamp-2 text-center leading-tight">
                    {caption}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      {ctxMenu && (
        <PartContextMenuPopup
          ref={menuRef}
          menu={ctxMenu}
          onAddToMap={() => { onPlacePart(ctxMenu.part); setCtxMenu(null); }}
          onCopyPartNumber={() => {
            void navigator.clipboard.writeText(ctxMenu.part.partNumber);
            setCtxMenu(null);
          }}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </aside>
  );
}

function PartContextMenuPopup({
  menu,
  onAddToMap,
  onCopyPartNumber,
  onClose,
  ref,
}: {
  menu: PartContextMenu;
  onAddToMap: () => void;
  onCopyPartNumber: () => void;
  onClose: () => void;
  ref: React.Ref<HTMLDivElement>;
}) {
  const itemCls = 'block w-full px-3 py-1 text-left text-xs hover:bg-neutral-700 whitespace-nowrap';
  return (
    <div
      ref={ref}
      style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 9999 }}
      className="min-w-[160px] rounded border border-neutral-700 bg-neutral-900 py-1 shadow-lg"
      onContextMenu={(e) => e.preventDefault()}
    >
      <button className={itemCls} onClick={onAddToMap}>
        Add to map
      </button>
      <button className={itemCls} onClick={onCopyPartNumber}>
        Copy part number
      </button>
      <hr className="my-1 border-neutral-700" />
      <button className={itemCls + ' text-neutral-500'} onClick={onClose}>
        Cancel
      </button>
    </div>
  );
}

/**
 * Subsequence-based fuzzy match — direct port of desktop's
 * PartsBrowser::fuzzyScore (PartsBrowser.cpp:62-94). Every char of
 * `needle` must appear in `hay` in order. Returns 0 = no match.
 *
 * Scoring (matches desktop exactly):
 *   - +10 per matched char, +5 extra per consecutive run
 *   - +15 if the first hit is at position 0
 *   - −min(firstHit, 10) penalty for skipping over leading text
 *   - −min(spread, 10) penalty for spread-out matches
 *   - empty needle → 1 (everything visible, matches desktop)
 */
/**
 * Renders the 48×48 thumbnail for a part tile. For leaf parts this is
 * just the catalog sprite. For groups (`.set` parts) we either:
 *   - use the pre-rendered `.set.gif` if BlueBrickParts shipped one, or
 *   - synthesise a composite via `ensureSetThumbnail` from the
 *     subparts' images, matching the original BlueBrick C# behaviour
 *     at BrickLibrary.cs:1554-1672.
 *
 * Synthesis is async (subpart sprites must load); we re-render once
 * the data URL becomes available.
 */
function PartThumbnail({
  part,
  partsByKey,
  imgCls = 'h-12 w-12',
}: {
  part: PartWire;
  partsByKey: Map<string, PartWire>;
  imgCls?: string;
}) {
  const directUrl = spriteUrlFor(part);
  const [synthUrl, setSynthUrl] = useState<string | null>(() =>
    !directUrl && part.kind === 'group' ? getSetThumbnailSync(part.key) : null,
  );

  useEffect(() => {
    if (directUrl) return;
    if (part.kind !== 'group') return;
    if (synthUrl) return;
    let cancelled = false;
    void ensureSetThumbnail(part, partsByKey).then((u) => {
      if (!cancelled) setSynthUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [directUrl, part, partsByKey, synthUrl]);

  const url = directUrl || synthUrl;
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className={`${imgCls} object-contain`}
        loading="lazy"
      />
    );
  }
  return <div className={`${imgCls} rounded bg-neutral-800`} />;
}

function fuzzyScore(needle: string, hay: string): number {
  if (needle.length === 0) return 1;
  let hi = 0;
  let score = 0;
  let consecutive = 0;
  let firstHit = -1;
  let lastHit = -1;
  for (let n = 0; n < needle.length; n++) {
    const nc = needle[n];
    let matched = false;
    while (hi < hay.length) {
      if (hay[hi] === nc) {
        if (firstHit < 0) firstHit = hi;
        consecutive = lastHit === hi - 1 ? consecutive + 1 : 0;
        lastHit = hi;
        score += 10 + consecutive * 5;
        if (hi === 0) score += 15;
        hi += 1;
        matched = true;
        break;
      }
      hi += 1;
    }
    if (!matched) return 0;
  }
  const spread = lastHit - firstHit - (needle.length - 1);
  if (firstHit > 0) score -= Math.min(firstHit, 10);
  score -= Math.min(spread, 10);
  return Math.max(score, 1);
}
