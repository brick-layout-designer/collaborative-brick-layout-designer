// Export Image settings remembered between uses, like desktop's
// QSettings export/width, height, keepAspect, transparent, antialias
// (MainWindowMenus.cpp:117-205), plus the web's format and JPEG quality.
// Per user; saved after a successful export.

export interface ExportImageSettings {
  width: number;
  height: number;
  keepAspect: boolean;
  transparent: boolean;
  antialias: boolean;
  format: 'png' | 'jpeg';
  quality: number;
}

const KEY = 'cld:exportImage';

/** The saved settings, or null the first time (or when unreadable). */
export function loadExportSettings(): ExportImageSettings | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<ExportImageSettings>;
    const int = (n: unknown, lo: number, hi: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : null);
    const width = int(v.width, 1, 1 << 16);
    const height = int(v.height, 1, 1 << 16);
    if (width === null || height === null) return null;
    return {
      width,
      height,
      keepAspect: v.keepAspect !== false,
      transparent: v.transparent === true,
      antialias: v.antialias !== false,
      format: v.format === 'jpeg' ? 'jpeg' : 'png',
      quality: int(v.quality, 1, 100) ?? 90,
    };
  } catch {
    return null;
  }
}

export function saveExportSettings(s: ExportImageSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* per-user convenience only */
  }
}
