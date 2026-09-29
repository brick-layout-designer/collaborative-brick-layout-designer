// Builds packages/bbm/tests/fixtures/oracle/sleepers.bbm: rails whose
// LDraw export has sleepers (one raised), parts with <LDraw> angle and
// translation remaps, and a hidden layer. Vanilla BlueBrick's bbconv
// (desktop repo scripts/bluebrick-oracle) then made sleepers.ldr/.mpd from
// it, and sleepers.from-ldr/.from-mpd.bbm from those.
//
//   npx tsx scripts/make-sleepers-fixture.ts out.bbm
import { writeFileSync } from 'node:fs';
import { writeBbm } from '@cld/bbm';
import type { Brick } from '@cld/model';
import { scanCatalog } from '../src/scan.js';
import { rebuildConnectivity } from '../src/connectivity.js';
import { MapLibrary, newBrickLayer, newMap } from '../src/mapformats/library.js';

const out = process.argv[2]!;
const lib = new MapLibrary((await scanCatalog(new URL('../../../parts-library/parts', import.meta.url).pathname)).catalog);
const f = Math.fround;
function first(pn: string, x: number, y: number, orientation = 0, altitude = 0): Brick {
  const b = lib.newBrick(lib.meta(pn)!);
  b.orientation = orientation;
  b.altitude = altitude;
  lib.placeByImageCentre(b, { x, y });
  return b;
}
// Attach `pn` by its connection `mine` to `fixed`'s connection `theirs`.
function attach(fixed: Brick, theirs: number, pn: string, mine: number, altitude = fixed.altitude): Brick {
  const fm = lib.meta(fixed.partNumber)!;
  const m = lib.meta(pn)!;
  const b = lib.newBrick(m);
  let o = f(fixed.orientation + fm.connections[theirs]!.angle + 180 - m.connections[mine]!.angle);
  o = ((o % 360) + 360) % 360;
  b.orientation = o;
  b.altitude = altitude;
  b.activeConnectionPointIndex = mine;
  lib.placeByConnection(b, mine, lib.connectionWorld(fixed, theirs));
  return b;
}
const map = newMap(new Date(2026, 8, 28));
map.author = 'Oracle';
const rails: Brick[] = [];
const a = first('3228AC02.1', 0, 0);
const b = attach(a, 1, '3228AC02.1', 0);
const c = attach(b, 1, '3229AC01.1', 0);
rails.push(a, b, c);
const d = first('3229BC01.7', 0, 40);
const e = attach(d, 1, '3229BC01.7', 0, 48);
rails.push(d, e);
const g = first('2865.8', 0, 80, 30);
const h = attach(g, 1, '2867.8', 0);
rails.push(g, h);
const hidden = newBrickLayer('Hidden rails', [first('2867.8', 60, 60, 0, 10), first('3228AC02.1', 60, 20, 90, 24)]);
hidden.visible = false;
map.layers.push(newBrickLayer('Rails', rails), hidden);
rebuildConnectivity(map, lib.catalog);
writeFileSync(out, writeBbm(map));
