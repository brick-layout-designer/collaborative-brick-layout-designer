// A .bld-layout saved from a layout on this same server: offer to open
// the original instead of importing a copy (the copy stays the default).

import { Link } from 'react-router-dom';
import { api } from '../api';
import { serverBase, type LayoutSource } from '../layoutFile';

export interface OriginalLayout {
  id: string;
  title: string;
}

/** The layout `source` names, when it is on this server and you can open it. */
export async function originalHere(source: LayoutSource | undefined, here = window.location.origin): Promise<OriginalLayout | null> {
  if (!source || serverBase(source.server) !== serverBase(here)) return null;
  try {
    const { layout } = await api.layouts.get(source.layoutId);
    return { id: layout.id, title: layout.title };
  } catch {
    return null; // gone, or not yours to open: import it as a copy
  }
}

/** "This file is a copy of … · Open the original", above the import form. */
export function OriginalLayoutNotice({ original, onOpen }: { original: OriginalLayout; onOpen?: () => void }) {
  return (
    <div role="status" className="space-y-2 rounded-lg border border-line bg-accent-soft p-3 text-sm">
      <p>
        This file is a copy of <strong>“{original.title}”</strong>, which is on this server.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to={`/editor/${encodeURIComponent(original.id)}`}
          onClick={onOpen}
          className="tap-target inline-flex items-center rounded-lg bg-accent px-3 py-1.5 font-semibold text-accent-ink hover:bg-accent-hover"
        >
          Open the original
        </Link>
        <span className="text-muted">or create a new layout from the file below, as a copy.</span>
      </div>
    </div>
  );
}
