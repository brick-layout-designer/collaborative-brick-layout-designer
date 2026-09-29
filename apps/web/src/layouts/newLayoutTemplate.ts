// "File > New" template — desktop's general/newMapTemplate preference
// (PreferencesDialog.cpp:73-87, MainWindowFileIO.cpp:300-322): new
// layouts start as a copy of the chosen map. On the web the template is
// one of the user's layouts, remembered per user.

export interface NewLayoutTemplate {
  id: string;
  title: string;
}

const KEY = 'cld:newLayoutTemplate';

export function getNewLayoutTemplate(): NewLayoutTemplate | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<NewLayoutTemplate> | null;
    return v && typeof v.id === 'string' && v.id ? { id: v.id, title: typeof v.title === 'string' ? v.title : '' } : null;
  } catch {
    return null;
  }
}

export function setNewLayoutTemplate(t: NewLayoutTemplate | null): void {
  try {
    if (t) localStorage.setItem(KEY, JSON.stringify(t));
    else localStorage.removeItem(KEY);
  } catch {
    /* per-user convenience only */
  }
}

/**
 * The template's .bbm and sidecar, as the new layout's starting content.
 * Throws when the template layout can't be read (deleted, no access).
 */
export async function templateContent(id: string): Promise<{ bbm: string; sidecar?: string }> {
  const bbm = await fetch(`/api/layouts/${encodeURIComponent(id)}/export.bbm`, { credentials: 'include' });
  if (!bbm.ok) throw new Error('The template layout is no longer available.');
  const out: { bbm: string; sidecar?: string } = { bbm: await bbm.text() };
  const bld = await fetch(`/api/layouts/${encodeURIComponent(id)}/export.bbm.bld`, { credentials: 'include' });
  if (bld.ok) out.sidecar = await bld.text();
  return out;
}
