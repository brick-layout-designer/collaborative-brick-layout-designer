// A placed module's own look (sidecar fields, packages/bbm sidecar.ts):
// whether its name shows, its outline and name colors, and the "Same
// color" link that keeps the two in step. Pure functions over a module
// entry; mutations.ts updateSidecarModule writes the result. The desktop's
// core/ModuleLook.h does the same.

import type { SidecarModule } from '@cld/bbm';

export type ModuleColorPart = 'outline' | 'name';

/** The default look's colors, as a color input shows them (rgba(100,180,255) without its opacity). */
export const MODULE_DEFAULT_COLOR = '#64b4ff';

/** Whether the two colors move together ("Same color", on unless turned off). */
export function colorsLinked(m: SidecarModule): boolean {
  return m.sameColor !== false;
}

/** The color a picker shows for one part: the chosen one, or the module's own default (moduleColors). */
export function moduleColor(m: SidecarModule, part: ModuleColorPart, fallback: string = MODULE_DEFAULT_COLOR): string {
  return (part === 'outline' ? m.outlineColor : m.nameColor) ?? fallback.toLowerCase();
}

/** Whether either color was chosen (so "Reset to default" has something to do). */
export function hasCustomColors(m: SidecarModule): boolean {
  return m.outlineColor !== undefined || m.nameColor !== undefined || m.sameColor === false;
}

/** Sets one part's color; with "Same color" on, the other part follows. */
export function withColor(m: SidecarModule, part: ModuleColorPart, hex: string): SidecarModule {
  const c = hex.toLowerCase();
  if (colorsLinked(m)) return { ...m, outlineColor: c, nameColor: c };
  return part === 'outline' ? { ...m, outlineColor: c } : { ...m, nameColor: c };
}

/** `m` without the given fields (defaults aren't written). */
function omit(m: SidecarModule, ...keys: (keyof SidecarModule)[]): SidecarModule {
  const out: SidecarModule = { ...m };
  for (const k of keys) delete out[k];
  return out;
}

/**
 * Turns "Same color" on or off. Turning it on gives the name the
 * outline's color (or both the default, if the outline has none).
 */
export function withSameColor(m: SidecarModule, on: boolean): SidecarModule {
  if (!on) return { ...m, sameColor: false };
  const linked = omit(m, 'sameColor', 'nameColor');
  return m.outlineColor !== undefined ? { ...linked, nameColor: m.outlineColor } : linked;
}

/** Back to the default look: both colors the module's own default color, linked. */
export function withDefaultColors(m: SidecarModule): SidecarModule {
  return omit(m, 'outlineColor', 'nameColor', 'sameColor');
}

/** Shows or hides this module's name (shown is the default, so it isn't written). */
export function withShowName(m: SidecarModule, show: boolean): SidecarModule {
  const rest = omit(m, 'showName');
  return show ? rest : { ...rest, showName: false };
}
