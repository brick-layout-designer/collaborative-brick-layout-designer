# Venue model

A venue is the room a layout goes in. The web editor and the desktop app share this model. It appears in three places:

- `.bld-venue` files, tagged `"schema": "bld-venue/1"`;
- the `venue` field of a layout's sidecar (`.bbm.bld`, or `meta.cache` in a live layout);
- the server's venue library (`/api/venues`), stored without the `schema` tag.

Both apps must read and write every field below the same way. `packages/bbm/tests/fixtures/grand-lobby.bld-venue` (the desktop repo has the same file at `fixtures/venues/grand-lobby.bld-venue`) is the shared test: each app reads it, writes it back, and must get the same JSON.

## Coordinates

- Coordinates are in **studs** (1 stud = 8 mm, so 1 ft ≈ 38.098 studs).
- **x** grows to the east and **y** to the south, as on the map.
- Angles are in degrees, clockwise from east. So 90 is south and 270 is north.

## Fields

| Field | Type | Written |
|---|---|---|
| `name` | string | always |
| `enabled` | bool: whether to draw it and check against it | always |
| `minWalkwayStuds` | number | always |
| `bounds` | `{x, y, w, h}`, the reserved layout area (all 0 when none) | always |
| `edges[]` | the outline, as `{kind, doorWidthStuds, label, poly[]}`. `kind` is 0 for a wall, 1 for a door, 2 for an opening | always |
| `edges[].estimated` | `true` when the edge is not measured yet | only when true |
| `obstacles[]` | `{label, poly[]}`, a closed polygon | always |
| `obstacles[].kind` | `column`, `stairs`, `elevator`, `counter` or `railing` | only when set; absent means "other" |
| `obstacles[].upDegrees` | stairs: the direction of going up | only when set |
| `power[]` | `{x, y, kind: "wall" \| "floor", label?, amps?, volts?}` | only when there is at least one |
| `notes[]` | `{x, y, text, estimated?}` | only when there is at least one |
| `dimensions[]` | `{from{x,y}, to{x,y}, label?, estimated?}`, drawn as a dimension line | only when there is at least one |

Rules for optional fields:

- `label` is written only when it is not empty.
- `amps` and `volts` are written only when above 0.
- `estimated` is written only when true.
- An `obstacles[].kind` this build doesn't know reads as "other".

## Unknown fields

A field an app doesn't know, at any level, is kept when the venue is read and written again. This way an older build doesn't lose what a newer one added.
