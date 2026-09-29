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

## Drawing

Both apps draw the venue the same way. The web's `editor/render/venueDraw.ts` and the desktop's `rendering/VenueDraw.cpp` compute the same geometry, and each has a test checking the same numbers. Sizes are in studs unless given in px. Line widths in px stay the same at every zoom.

**Outline edges**
- Walls, doors and openings keep their existing pens.
- An estimated edge is drawn at 45% opacity, and its label ends in " (est.)".

**Obstacles**

| Kind | Fill | Outline | Extra marks |
|---|---|---|---|
| column | `rgba(60,60,60,0.75)` | `rgb(40,40,40)` 1 px | none |
| stairs | `rgba(214,180,196,0.55)` | `rgb(120,80,100)` 1 px | treads and an arrow (below) |
| elevator | `rgba(150,150,170,0.45)` | `rgb(70,70,90)` 1 px | both diagonals of the bounding box |
| counter | `rgba(170,125,70,0.45)` | `rgb(110,80,40)` 1 px | none |
| railing | no fill | `rgb(40,40,40)` 3 px | none |
| other | `rgba(120,120,120,0.4)` | `rgb(90,90,90)` 1 px | none |

Stairs with an `upDegrees` also get:
- **Treads:** lines across the stairs, perpendicular to the way up, every 10 studs.
- **Arrow:** runs from 15% to 85% of the way up, along the middle of the stairs. Its head strokes are `min(20% of the length, 30% of the width)` long, going back and ±0.6 of that sideways.

**Power points**
- A circle with a radius of 6 studs, outlined in `rgb(220,100,20)` 2 px.
- Floor outlets are filled in that colour; wall outlets are filled white.
- The label "label · N A · N V" goes to the right, leaving out empty parts.

**Notes**
- The text sits at the note's position.
- Estimated notes are italic and grey (`rgb(120,120,120)`), and end in " (est.)".

**Measurements**
- A line between the two points, with end ticks 5 studs to each side of the line, in `rgb(40,90,140)` 1.5 px.
- The label is centred 8 studs to the line's left (above a left-to-right line) and turned to read left to right.
- Estimated measurements are dashed and grey, and their labels end in " (est.)".
