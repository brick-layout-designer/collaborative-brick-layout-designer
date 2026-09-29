// CSS font stack for a font family stored in a .bbm. Desktop hands the
// family to Qt, which substitutes a sans-serif face when it isn't
// installed; a bare "Tahoma" in CSS falls back to the browser default,
// usually a serif. So always end the stack in sans-serif faces.

const SANS_FALLBACK = 'Arial, Helvetica, "Liberation Sans", sans-serif';

export function fontStack(family: string | undefined): string {
  const f = (family ?? '').replace(/["\\]/g, '').trim();
  if (!f || /^(arial|helvetica|sans-serif)$/i.test(f)) return SANS_FALLBACK;
  return `"${f}", ${SANS_FALLBACK}`;
}
