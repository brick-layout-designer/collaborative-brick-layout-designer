// How big a part's sprite is drawn: one rule for the desktop's parts
// library (PartsLibrary::scanFile), the catalog scan and the server.
//
// An imported part keeps a hi-res `<key>.png`, its resolution declared by
// `<PixelsPerStud>` in the XML, beside an 8 px a stud `<key>.gif` for
// vanilla BlueBrick, which ignores the element. So a part whose XML
// declares a resolution draws its .png, and a .gif is always 8 px a stud
// whatever the XML says. Sending the .gif with that XML is what drew
// uploaded parts at a quarter of their size on the web.

/** BlueBrick's implicit resolution, and every .gif's. */
export const VANILLA_PX_PER_STUD = 8;

/** Sprite extensions to try beside a part's XML, best first, for the resolution it declares. */
export function spriteExtensionsFor(pxPerStud: number): readonly string[] {
  return pxPerStud !== VANILLA_PX_PER_STUD
    ? ['.png', '.gif', '.jpg', '.jpeg']
    : ['.gif', '.png', '.jpg', '.jpeg'];
}

/** The resolution a part is drawn at, from its XML's and the sprite file's. */
export function effectivePxPerStud(declared: number, spritePath: string): number {
  return spritePath.toLowerCase().endsWith('.gif') ? VANILLA_PX_PER_STUD : declared;
}

const PX_PER_STUD_ELEMENT = /[ \t]*<PixelsPerStud>[^<]*<\/PixelsPerStud>[ \t]*\r?\n?/g;

/**
 * A part's XML made to agree with a GIF sprite: without `<PixelsPerStud>`,
 * so every reader takes it at 8 px a stud as the desktop does. Returns
 * `xml` itself when there is nothing to change.
 */
export function xmlForGifSprite(xml: string): string {
  return xml.replace(PX_PER_STUD_ELEMENT, '');
}
