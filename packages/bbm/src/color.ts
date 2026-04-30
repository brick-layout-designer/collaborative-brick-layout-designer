import type { ColorSpec } from '@cld/model';
import type { XmlBuilder } from './xml.js';
import { formatBool, parseBool } from './format.js';

/**
 * Read a color block (a wrapper element containing
 *   <IsKnownColor>bool</IsKnownColor>
 *   <Name>string</Name>
 * ).
 *
 * The wrapper element name varies (`<BackgroundColor>`, `<hullColor>`,
 * `<GridColor>`, ...), so this works on the *parsed* sub-object.
 */
export function readColorSpec(node: Record<string, unknown> | undefined): ColorSpec {
  if (!node) throw new Error('missing color element');
  const known = parseBool(stringField(node, 'IsKnownColor'));
  const name = stringField(node, 'Name');
  return known ? { kind: 'known', name } : { kind: 'argb', argb: name };
}

/**
 * Emit a color block. Caller has already opened the wrapper element.
 */
export function writeColorSpec(b: XmlBuilder, color: ColorSpec): void {
  if (color.kind === 'known') {
    b.textElement('IsKnownColor', formatBool(true));
    b.textElement('Name', color.name);
  } else {
    b.textElement('IsKnownColor', formatBool(false));
    b.textElement('Name', color.argb);
  }
}

/** Extract a string field from a parsed XML node. Trims, asserts presence. */
function stringField(node: Record<string, unknown>, key: string): string {
  const v = node[key];
  if (v === undefined || v === null) throw new Error(`missing field: ${key}`);
  return String(v);
}
