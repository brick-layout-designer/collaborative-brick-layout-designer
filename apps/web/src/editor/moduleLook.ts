// A placed module's own look (sidecar fields, packages/bbm sidecar.ts):
// whether its name shows, its outline and name colours, and the "Same
// colour" link that keeps the two in step. Pure functions over a module
// entry; mutations.ts updateSidecarModule writes the result. The desktop's
// core/ModuleLook.h does the same.

import type { SidecarModule } from '@cld/bbm';

export type ModuleColourPart = 'outline' | 'name';

/** The default look's colours, as a colour input shows them (rgba(100,180,255) without its opacity). */
export const MODULE_DEFAULT_COLOUR = '#64b4ff';

/** Whether the two colours move together ("Same colour", on unless turned off). */
export function coloursLinked(m: SidecarModule): boolean {
  return m.sameColor !== false;
}

/** The colour a picker shows for one part: the chosen one, or the default. */
export function moduleColour(m: SidecarModule, part: ModuleColourPart): string {
  return (part === 'outline' ? m.outlineColor : m.nameColor) ?? MODULE_DEFAULT_COLOUR;
}

/** Whether either colour was chosen (so "Reset to default" has something to do). */
export function hasCustomColours(m: SidecarModule): boolean {
  return m.outlineColor !== undefined || m.nameColor !== undefined || m.sameColor === false;
}

/** Sets one part's colour; with "Same colour" on, the other part follows. */
export function withColour(m: SidecarModule, part: ModuleColourPart, hex: string): SidecarModule {
  const c = hex.toLowerCase();
  if (coloursLinked(m)) return { ...m, outlineColor: c, nameColor: c };
  return part === 'outline' ? { ...m, outlineColor: c } : { ...m, nameColor: c };
}

/** `m` without the given fields (defaults aren't written). */
function omit(m: SidecarModule, ...keys: (keyof SidecarModule)[]): SidecarModule {
  const out: SidecarModule = { ...m };
  for (const k of keys) delete out[k];
  return out;
}

/**
 * Turns "Same colour" on or off. Turning it on gives the name the
 * outline's colour (or both the default, if the outline has none).
 */
export function withSameColour(m: SidecarModule, on: boolean): SidecarModule {
  if (!on) return { ...m, sameColor: false };
  const linked = omit(m, 'sameColor', 'nameColor');
  return m.outlineColor !== undefined ? { ...linked, nameColor: m.outlineColor } : linked;
}

/** Back to the default look: both colours the default light blue, linked. */
export function withDefaultColours(m: SidecarModule): SidecarModule {
  return omit(m, 'outlineColor', 'nameColor', 'sameColor');
}

/** Shows or hides this module's name (shown is the default, so it isn't written). */
export function withShowName(m: SidecarModule, show: boolean): SidecarModule {
  const rest = omit(m, 'showName');
  return show ? rest : { ...rest, showName: false };
}
