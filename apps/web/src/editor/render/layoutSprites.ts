// Which part pictures a layout needs: one URL per distinct part on its
// visible brick layers, so the loading card knows the full total up front.

import type { BbmMap } from '@cld/model';
import { spriteUrlFor, type PartWire } from '../../api';

export function layoutSpriteUrls(map: BbmMap, partsByKey: Map<string, PartWire>): Set<string> {
  const urls = new Set<string>();
  for (const l of map.layers) {
    if (l.type !== 'brick' || !l.visible) continue;
    for (const b of l.bricks) {
      const meta = partsByKey.get(b.partNumber.toLowerCase());
      const url = meta ? spriteUrlFor(meta) : '';
      if (url) urls.add(url);
    }
  }
  return urls;
}
