# `.bbm` test sample files

Real-world `.bbm` files used as goldens for load/round-trip tests.

## Provenance

| File | Source | Size |
|---|---|---|
| `tight-corner.bbm` | Provided by @aronwk from local BlueBrick 1.9.2 projects directory | 231 KB |
| `fordyce-2026.bbm` | Provided by @aronwk; 2026 Fordyce event layout | 557 KB |
| `corner-lobby.bld-layout` | Made by the desktop's tests (tests/import/LayoutFileTest.cpp, `BLD_UPDATE_FIXTURES=1`): `tight-corner.bbm` with a label, a module, the Grand Lobby venue and a 4×4 background image, as a layout file (references/LAYOUT-FILE.md) | 14 KB |
| `web-made.bld-layout` | The same layout opened and downloaded again by the web (apps/web/src/test/layoutFile.test.ts, `BLD_UPDATE_FIXTURES=1`); the desktop reads it | 14 KB |
| `with-parts.bld-layout` | Made by the desktop's tests (LayoutFileTest `ReadsTheSharedFixtureWithParts`): one brick of `CLDTEST.1`, a part the file carries under `parts/` | 1 KB |
| `oracle/*` | Copied from the desktop repo's `fixtures/bluebrick-oracle`: maps and budgets saved by vanilla BlueBrick 1.9.2 (under Wine), and its conversions of the `.ldr`, `.mpd`, `.tdl` and `.ncp` sources beside them. `sleepers.*` was made here: rails with LDraw sleepers and angle remaps, built by packages/parts-catalog/scripts/make-sleepers-fixture.ts and converted by vanilla's bbconv (see the desktop repo's scripts/bluebrick-oracle) | 1.1 MB |

These files are loaded read-only by the round-trip tests. Contributors adding
more fixtures should note author/origin here and make sure the file is
appropriate to ship under this repo's GPL-3.0 license.

## Byte-exact round-trip status

- **Enforced in CI** via `tests/saveload/RealFixtureTest::ByteExactRoundTrip`
  — every `.bbm` here must load + re-save byte-for-byte identical.
- Vanilla format properties matched: CRLF line endings, 2-space indent,
  no BOM, no xmlns attributes on `<Map>`, `<EmptyTag />` spacing, lowercase
  `utf-8` in the XML declaration, lowercase hex unknown colors, known-color
  name preservation, no-trailing-newline.

## Rendering previews

Each fixture has a PNG preview in `docs/preview/` produced by `cld-render`,
refreshed manually when the rendering pipeline changes.
