# Desktop CLD ↔ Web port — parity checklist

Living inventory of every user-facing feature in the desktop application.
The web port is being driven to 1-to-1 parity. Each line cites the
desktop file:line so the implementer can navigate to the reference.

Legend: `[x]` shipped, `[ ]` pending, `[~]` partial.

Desktop reference root: `/home/aronwk/Documents/git/collaborative-layout-designer/`
Web source root: this repository.

---

## File menu (`MainWindowMenus.cpp`)

- [x] **New** (`Ctrl+N`) — navigates to layouts page; confirms if sync is broken. (`MainWindowMenus.cpp:76-78`)
- [x] **Open...** (`Ctrl+O`) — navigates to layouts page; confirms if sync is broken. (`MainWindowMenus.cpp:80-82`)
- [n/a] **Open Recent** submenu — layout list page is the equivalent; a "Recent" submenu would be redundant
- [x] **Save** (`Ctrl+S`) — explicit save flush; writes `.bbm` + sidecar (`MainWindowMenus.cpp:88-90`)
- [n/a] **Save As...** (`Ctrl+Shift+S`) — layouts are server-side; "Save As" doesn't map to the web model
- [x] **Export as Image...** — `ExportImageDialog`: 1×/2×/4× resolution, transparent background option; PNG download client-side (`MainWindowMenus.cpp:97-201`).
- [x] **Export as PDF...** — tiled print mode in `ExportImageDialog`: paper size (A4/A3/Letter portrait+landscape), DPI (96/150/300), tile overlap; opens print window with `@page` CSS → browser Print → PDF
- [x] **Print...** (`Ctrl+P`) — covered by tiled print mode in `ExportImageDialog` (same as above)
- [n/a] **Quit** (`Ctrl+Q`) — browser tab close; no equivalent needed

---

## Edit menu (`MainWindowMenus.cpp:323-489`)

- [x] **Undo / Redo** (`Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y`)
- [x] **Cut / Copy / Paste** (`Ctrl+X` / `Ctrl+C` / `Ctrl+V`) — uses the OS clipboard so paste works across tabs
- [x] **Duplicate** (`Ctrl+D`)
- [x] **Delete** (`Del` / `Backspace`)
- [x] **Find & Replace** (`Ctrl+F`) — scope (Text content / Part number), match case, click result to select; Replace all for text-cell scope.
- [x] **Select All** (`Ctrl+A`), **Deselect All** (`Ctrl+Shift+A`)
- [x] **Select Path** (`Ctrl+P`) — BFS over connection links (`MapView.cpp:1481-1543`)
- [x] **Group / Ungroup** (`Ctrl+G` / `Ctrl+Shift+G`) — group-aware selection in editor
- [x] **Transform → Arrow nudge** by current snap step
- [x] **Bring to Front / Send to Back** (`Ctrl+Shift+]` / `Ctrl+Shift+[`)
- [x] **Rotation Step** — dropdown `90 / 45 / 22.5 / 11.25 / 5 / 1°` in editor toolbar (`editorStore.rotationStepDegrees`)
- [x] **Rotate CW / CCW** (`Shift+R` / `R`) — uses configured rotation step
- [x] **Insert → Text...** (`Ctrl+T`) — TextDialog with font / size / bold / italic / colour / rotation
- [x] **Insert → Anchored Label...** (`Ctrl+L`) — `AddAnchoredLabelDialog`: text, font, size, bold/italic, colour, World/Brick anchor, offset, rotation, minZoom; mutations via sidecar cache patch (`addAnchoredLabel` / `editAnchoredLabel` / `deleteAnchoredLabel` in `mutations.ts`)
- [x] **Preferences...** (`Ctrl+,`) — General (wheel zoom, undo depth, reopen-last-file), Editing (snap, rotation, paint colour), Appearance (view toggles, selection tint, module frame) tabs fully shipped (`PreferencesDialog.tsx`)

---

## View menu (`MainWindowMenus.cpp:491-554`)

- [x] **Zoom In / Out** (`Ctrl+=` / `Ctrl+-`) — wheel + keyboard, anchored under cursor (or stage centre for keyboard)
- [x] **Fit to View** (`F`)
- [x] **Status Bar** — mouse studs / selection count / zoom % / current tool
- [n/a] **Show Map Scroll Bars** toggle — web uses middle-click pan; scrollbars don't apply
- [x] Render toggles (persisted): Connection Points, Grid, Brick Hulls, Brick Elevation, Ruler Attach Points, Always Show Connections, Electric Circuits, Export Watermark, Module Label Percent — all persisted to localStorage. Electric Circuits toggle wired but no underlying render data yet.
- [x] Dock toggles — Panels menu shows hidden panels and lets the user un-hide them; per-user persisted via localStorage. Modules [x], Module Library [x], Used Parts [x], Venue Library [x] panels all shipped.

---

## Tools menu (`MainWindowToolsMenu.cpp`)

- [x] **Manage Parts Libraries...** — platform admin installs zip libraries (URL or upload); org admins enable/disable per-library; `PartLibrariesTab` in AdminPage + `OrgPartLibraries` in OrgDetailPage + `/api/admin/part-libraries` + `/api/orgs/:slug/part-libraries` routes; migration `0010_part_libraries.sql`
- [x] **Reload Parts Library** — `POST /api/admin/reload-parts` clears in-process catalog cache; "Reload parts" button in Admin → Libraries tab triggers rescan on next catalog request
- [n/a] **Import → LDraw (.ldr/.dat/.mpd)...** — not planned for web
- [n/a] **Import → Studio (.io)...** — not planned for web
- [n/a] **Import → LDD (.lxf/.lxfml)...** — not planned for web
- [x] **Export Part List (CSV)...** — aggregated counts by part number, CSV download (`MainWindowFileIO.cpp:253-293`)
- [n/a] **Download Additional Parts...** — superseded by server-side part library manager (admin installs zip from URL; org admins enable/disable per org)

---

## Map menu (`MainWindowMapMenu.cpp`)

- [x] **Background Colour...** — colour picker → `setBackgroundColor` mutation
- [x] **Background Image...** — `BackgroundImageDialog`: file upload (PNG/JPG/GIF/WebP, 10 MB), opacity slider, optional placement rect in studs; stored via `POST /api/layouts/:id/background-image`; `BackgroundImage` in sidecar; rendered as `KonvaImage` layer below all content; remove button calls `DELETE`.
- [x] **General Info...** — Author / LUG / Event / Date / Comment dialog
- [x] **Venue → Draw Outline...** — `venueOutline` tool: click to add vertices, dashed polygon preview with closing segment + vertex dots + hint text; Enter commits (builds `VenueEdge[]` from polygon segments, calls `setVenue`), Esc cancels; accessible from Map menu and Toolbar
- [x] **Venue → Draw by Dimensions...** — `VenueDimensionsDialog`: unit (ft/in), start X/Y, segment table (length/angle/kind/label), compass-preset angle dropdown, Rectangle preset helper; builds polygon and calls `setVenue`
- [x] **Venue → Add Obstacle...** — `venueObstacle` tool: same click-polygon flow; Enter appends a `VenueObstacle` to existing venue (or creates bare venue if none); accessible from Map menu and Toolbar
- [x] **Venue → Edit Properties...** — `VenuePropertiesDialog`: name, render toggle, min walkway (ft), per-edge kind/door-width/label table; Clear Venue button; wired into Map menu → "Venue → Edit Properties..."
- [x] **Venue → Clear** (with confirmation) — Map menu → "Venue → Clear" calls `setVenue(doc, null)` after `window.confirm`
- [x] **Venue → Save to Library...** — `VenueSaveLibraryDialog`: personal or org dropdown (orgs fetched via `api.orgs.list`), `POST /api/venues` with optional `orgSlug`; status bar confirms; shown in Venue Library panel
- [x] **Venue → Export as File...** — client-side download of venue JSON as `.cld-venue` file; Map menu entry `onVenueExportFile`
- [x] **Venue → Load from Library...** — `VenueLibraryPanel` dock panel: lists server venues, ↓ button loads into layout via `setVenue`; filter input; delete per row
- [x] **Venue → Load from File...** — file picker for `.cld-venue`/`.json`; parses JSON and calls `setVenue`

---

## Budget menu (`MainWindowMenus.cpp:563-570`)

- [x] **Open Budget Editor...** — modeless `BudgetDialog`: New/Open `.bbb`/Save/Refresh, table (Part #, Used, Limit), red rows over budget, over-budget count in footer; wired into Map menu → "Budget..."

---

## Modules menu (`MainWindowMenus.cpp:573-582`)

- [x] **Create from Selection...** — `SaveModuleDialog`: name prompt → creates module via `/api/modules` + snapshot upload; accessible from Map menu → "Save Selection as Module..."
- [x] **Import .bbm as Module...** — `ImportBbmDialog`: file picker → `readBbm` → collect all brick-layer bricks → translate centroid to origin → `insertBricks` into active layer (`ImportBbmAsModuleCommand` port; flattens to one target layer)
- [x] **Save Selection as Module...** — same as "Create from Selection..." above (single entry point in Map menu)
- [x] **Save Selection as Set...** — `SaveAsSetDialog`: name prompt → generates BrickTracks-style `.set.xml` (positions relative to centroid, tab-indented) → client-side download; no server round-trip

---

## Help menu

- [x] **About** page — `/about` route with project info, AI disclosure, credits

---

## Toolbar (`MainWindow.cpp:578-845`)

- [x] New / Open / Save buttons — New [x] + Open [x] buttons in header (navigate to layouts page, same guard as Ctrl+N/O); Save [x]
- [x] Undo / Redo
- [x] Delete / Cut / Copy / Paste (header toolbar buttons)
- [x] **Snap-grid drop-down** (off / 32 / 16 / 8 / 4 / 2 / 1 / 0.5 studs)
- [x] **Rotation-angle drop-down** (90 / 45 / 22.5 / 11.25 / 5 / 1°) — `RotationPicker` in editor toolbar
- [x] Rotate CCW / CW (keyboard `R` / `Shift+R`)
- [x] Send to Back / Bring to Front (keyboard `Ctrl+Shift+[` / `Ctrl+Shift+]`)
- [x] **Tool drop-down** — Select / Drag / Paint / Erase / Linear Ruler / Circular Ruler / Rotate / Delete (Place removed; click-from-panel is the desktop model)
- [x] **Paint colour** swatch (HTML5 colour picker)

---

## Canvas mouse behaviours (`MapView.cpp`, `MapViewDrag.cpp`, `MapViewContextMenu.cpp`)

- [x] Left-click empty space → marquee
- [x] Left-click brick → select (replace; Shift / Ctrl modifiers); group-aware (clicking a grouped brick selects the whole group)
- [x] Double-click brick → Edit Brick dialog (per-brick properties)
- [x] Left-drag brick → move with live connection-snap + grid fallback (single-brick); green snap ring at the active connection target
- [x] Left-drag selection → group move (translates rigidly; live connection-snap runs on the leader brick with all selected IDs excluded from snap targets; snap-rotation only applies to leader, not siblings — matches desktop behaviour for multi-brick drags)
- [x] Left-drag a single linear-ruler endpoint handle → reshape ruler (`EndpointHandle` in `RulerLayer.tsx`)
- [x] Middle-button drag → pan
- [x] Right-click → context menu (selection-aware) — see below
- [x] Wheel → zoom anchored under cursor
- [x] Drag selection out of viewport → cursor flips to `not-allowed`, release deletes
- [x] Double-click brick / ruler / text / label / venue → open per-type Properties dialog (`MapView.cpp:1568-1613`) — brick [x], ruler [x], text [x], anchored label [x] (double-click opens `AddAnchoredLabelDialog` in edit mode via `setEditingLabel`), venue [x] (double-click on `VenueOverlay` opens `VenuePropertiesDialog` via `onOpenVenueProps`)
- [x] Drag thumbnail from Parts panel → live ghost preview with connection-snap rotation; drop places at cursor
- [x] Drag from Module Library panel → drop on canvas imports bricks into active layer
- [x] Paint / Erase tool: click + drag stamps cells once each; auto-creates Area layer
- [x] Linear / Circular ruler tool: click-drag with live dashed preview snapped to grid step during drag; commits a ruler item on release
- [x] Venue Outline / Obstacle tool: clicks add vertices, dashed preview with vertex dots + hint label, Enter / Esc commit / cancel; grid-snap applied to each vertex
- [x] Click + place auto-selects new brick so chain-placing snaps off it (`MapView.cpp:1394-1408`)

### Right-click context menu (`MapViewContextMenu.cpp`)

Selection-aware; entries vary based on what's under the cursor:
- [x] **Properties...** (single brick) — opens Edit Brick dialog
- [x] **Properties...** (single ruler / text) — text cell opens Edit Text dialog; ruler opens Edit Ruler dialog
- [x] **Edit Text...** (single text cell — right-click on text cell opens Edit Text dialog)
- [x] **Rotate CCW / CW**
- [x] **Bring to Front / Send to Back**
- [x] **Group** (≥ 2) / **Ungroup**
- [x] **Select Connected**
- [x] **Cut / Copy / Duplicate / Delete**
- [x] Empty area: **Paste**, **Add Text Here...**
- [x] Ruler-attach flow: when a single ruler is selected and user right-clicks a brick, offers **Attach Endpoint 1/2** / **Attach Centre**
- [x] Tail: **Undo / Redo**

---

## Canvas keyboard shortcuts (`MapView.cpp:942-983`)

- [x] `R` / `Shift+R` — rotate ±90° (needs to use configured rotation step)
- [x] `Delete` / `Backspace` — delete selection
- [x] Arrow keys — nudge by current snap step (also applies to rulers + anchored labels in desktop)
- [x] `Enter` / `Esc` — commit / cancel venue-draw polygon (venueOutline / venueObstacle tools)
- [x] `Escape` — cancel place / deselect (web extension, fine)
- [x] All Edit-menu shortcuts that are wired (Ctrl+Z/Y, Ctrl+A, Ctrl+Shift+A, Ctrl+S, Ctrl+D, F)
- [x] `Ctrl+N` — navigate to layouts page (web new-layout equivalent)
- [x] `Ctrl+O` — navigate to layouts page (web open-layout equivalent)
- [x] `Ctrl+L` — opens Add Anchored Label dialog (sidecar mutations now built); `Ctrl+,` opens Preferences dialog
- [n/a] `Ctrl+Shift+S` (Save As) — no equivalent in web model; `Ctrl+P` (print) — browser native

---

## Side panels / docks

### Parts Browser (`PartsBrowser.cpp`)

- [x] Category dropdown (parent-folder buckets)
- [x] Fuzzy filter line edit (subsequence match, run-length scoring)
- [x] Icon grid: S/M/L icon size toggle (`PartsPanel.tsx`; S=32px, M=48px, L=64px; persisted `cld:partsIconSize`); grid auto-reflows on resize matching desktop's `QListView::Adjust`
- [x] **Drag thumbnail to canvas** — HTML5 drag with live ghost + connection-snap on drop
- [x] **Item activation (click)** places at view centre with selection-anchor snap + chain placement
- [x] Right-click: **Add to map** [x], **Copy part number** [x], **Delete imported part...** [n/a] (LDraw/Studio/LDD import not planned for web; no `imports/` subfolder)

### Layers Panel (`LayerPanel.cpp`)

- [x] Toolbar: **+ (Add Layer)** with submenu (Brick/Area/Text/Ruler), **▲ / ▼**, **✕ Delete**, **Show all**, **Solo**.
- [x] List rows with kind glyph + name + visibility checkbox + transparency slider + active highlight
- [x] Click row → set active layer
- [x] Double-click name → inline rename (Enter commits, Escape cancels, blur commits; remote renames sync without clobbering in-progress edits)
- [x] Right-click context menu — Show/Hide, Solo, Show all, Rename, Move up/down, Delete, **Layer Options…** (`LayersPanel.tsx` `LayerRow` → `LayerOptionsDialog.tsx`)

### Modules Panel (`ModulesPanel.cpp`) — **PARTIAL**

- [x] List `name (N members — sourceFile)` — reads `sidecar.modules[]`; shown in Panels menu (hidden by default)
- [x] Click toggles member-brick selection in the scene (additive toggle)
- [x] Right-click: **Select Members** [x], **Rename** [x] (inline), **Flatten** [x] (`flattenSidecarModule`), **Delete** [x] (`deleteSidecarModule`)
- [x] Buttons: Create (→ SaveModuleDialog via Map menu [x]), Import… (→ ImportBbmDialog [x]); Save to Library / Clone / Re-scan all shipped
- [x] Right-click: Move… [x], Rotate submenu [x], Clone [x] (bbox-offset copy, new sidecar entry), Save to Library [x] (creates server module, sets sourceFile), Re-scan from source [x] (re-fetches snapshot by module ID, replaces member bricks)

### Module Library Panel (`ModuleLibraryPanel.tsx`) — **SHIPPED**

- [x] Filter input
- [x] List saved server modules (personal + org-owned + shared)
- [x] Drag MIME `application/x-cld-module` → canvas drop inserts bricks into active layer
- [x] Click ↓ button or double-click → insert into active layer
- [x] Delete button per row
- [n/a] Local `.bbm` folder picker — superseded by server-side module library

### Used Parts Panel (`PartUsagePanel.cpp`) — **PARTIAL**

- [x] Filter line edit (matches part # + description)
- [x] 4-column sortable table: Part / Count / Budget / Description — Budget column hidden when no limits set; shows `count/limit` (green) or `+over` (red) per row; row tinted red when over limit
- [x] Summary line: distinct parts / total bricks in panel header
- [x] Double-click → Select All of This Part
- [x] Right-click on row → Select All of This Part (context menu)

### Moveable / dockable panels

- [x] Allow user to move panels between left / right docks (or hide) via the kebab menu in each panel header
- [x] Drag-and-drop reordering within a dock — HTML5 drag via `⠿` handle in `PanelHost.tsx`; drop onto another panel swaps position; blue outline highlight on drag-over
- [x] Floating undocked panels — "Float panel" in the `⋯` menu tears a panel off into a free-floating `<FloatingPanel>` window (portal into `document.body`); draggable by title bar, resizable by corner handle; position+size persisted in `dockLayout.ts`; dock back via `⋯` menu in the float title bar
- [x] Persist per-user dock layout (`localStorage` keyed on user id; matches QSettings `ui/state`)
- [x] Persist visibility — Panels menu in header lists hidden panels for re-show

---

## Dialogs (modal/modeless)

- [x] **Preferences** (`Ctrl+,`) — all three relevant tabs fully shipped:
  - General: wheel zoom factor [x], undo stack depth [x], reopen-last-file [x]; show-splash [n/a], new-map template [n/a], language [n/a]
  - Editing: default snap step [x], default rotation step [x], default paint colour [x]
  - Appearance: show grid [x], always-show connections [x], selection tint [x], module frame thickness [x], show module names [x], show module frames [x], electric circuits toggle [x], export watermark [x], module label % [x], venue label px [x] (persisted `cld:venueLabelPx`, wired to `VenueOverlay` label fontSize)
  - Library: module library folder [n/a — server-side]; additional parts library paths → replaced by admin-installed part libraries (org-selectable)
  - Import: LDraw/Studio/LDD [n/a] — not planned
- [x] **Part Library management** — platform-admin installs libraries, org-admin enables/disables per library (`apps/web/src/admin/AdminPage.tsx` Libraries tab; `apps/web/src/orgs/OrgDetailPage.tsx` Part libraries section)
- [n/a] **Library Paths** dialog (legacy local-path model) — superseded by server-side part library manager
- [x] **Find & Replace** — text-cell Replace All wired; part-number replace not applicable (part identity)
- [x] **Layer Options** dialog — `LayerOptionsDialog.tsx`: name, hull visibility/colour/thickness, display-brick-elevation (brick layers only); accessible via right-click → "Layer Options…"
- [x] **General Info** dialog — Author / LUG / Event / Date / Comment (`GeneralInfoDialog`)
- [x] **Background Image** dialog — `BackgroundImageDialog.tsx`
- [x] **Edit Brick** dialog — Part #, X/Y studs, Rotation, Altitude, Active connection # (`EditBrickDialog`)
- [x] **Edit Ruler** dialog — line color/thickness, unit, guideline, label, Detach buttons (`EditRulerDialog`)
- [x] **Add Text** dialog — text, font, size, bold, italic, color, rotation (`TextDialog` via `Ctrl+T`)
- [x] **Edit Text** dialog (double-click or right-click on existing text cell → `TextDialog` pre-populated; patches text/font/color/orientation via `editTextCellFull`)
- [x] **Add / Edit Anchored Label** dialog — `AddAnchoredLabelDialog.tsx` (text, font, colour, World/Brick anchor, offset, rotation, minZoom); double-click on a rendered label opens in edit mode via `initialLabel` prop + `editAnchoredLabel` mutation
- [x] **Export Image** dialog — resolution + transparent background (`ExportImageDialog.tsx`)
- [x] **Venue Properties** dialog — `VenuePropertiesDialog.tsx`: name, enabled, min walkway (ft), per-edge kind/door-width/label table; Clear Venue button; wired into Map menu
- [x] **Venue by Dimensions** dialog — `VenueDimensionsDialog.tsx`: unit, origin, segment table with compass-preset angles and Rectangle preset; wired into Map menu
- [x] **Module Move** dialog (ΔX/ΔY studs, undoable via Yjs transaction) — `ModulesPanel.tsx` right-click → Move…
- [x] **Module Rotate** submenu (−90/−45/+45/+90/+180°, undoable) — `ModulesPanel.tsx` right-click → Rotate ▸
- [x] **Module Save to Library** — right-click → "Save to Library" in ModulesPanel creates a server module, updates sourceFile on the sidecar entry; filename sanitiser not needed (server assigns ID)
- [x] **Budget** modeless dialog — `BudgetDialog.tsx`: fixed-position panel (bottom-right), New/Open/Save, part-usage table with inline limit editing, red highlight on over-budget rows
- [n/a] **Download Center** dialog — superseded by server-side part library manager
- [n/a] **Import Preview** dialog — only shown after LDraw/Studio/LDD import, which is [n/a] for web
- [n/a] **Background Task progress** — web model uses async mutations with inline pending states; no separate progress window needed
- [n/a] **Restore autosave?** prompt at startup — Yjs provides continuous sync; there is no local autosave file to restore
- [x] **Unsaved changes** prompt before New/Open — shown when sync is broken (reconnecting/offline/error)
- [x] **About** — `/about` route (web equivalent of the desktop About message box)

---

## Tools (canvas tool modes — `MapView::Tool`)

- [x] **Select** (default)
- [x] **Place part** — click-from-PartsBrowser (desktop model: single click activates + places at view centre with selection-anchor snap); drag-from-PartsBrowser also supported. Dedicated "place" tool mode removed.
- [x] **PaintArea** — auto-creates Area layer
- [x] **EraseArea**
- [x] **DrawLinearRuler**
- [x] **DrawCircularRuler**
- [x] **DrawVenueOutline** — `venueOutline` tool; click-to-add vertices, dashed preview, Enter/Esc commit/cancel
- [x] **DrawVenueObstacle** — `venueObstacle` tool; same click-polygon flow; appends obstacle to existing venue

(Web extras `drag` / `rotate` / `delete` tools have no desktop equivalent — they're keyboard verbs in desktop.)

---

## Rendering features (`src/rendering/SceneBuilder*.cpp`)

- [x] Layer-ordered draw, per-layer transparency, per-layer visibility
- [x] Brick sprite from part GIF; pxPerStud-aware scaling for hi-DPI imports
- [x] **Connection-point dots** (free vs linked colour, gold for active CP); always rendered (dimmed when unselected, full-bright on selection)
- [x] **Hull / outline polygon** — `<hull>` pixel-space polygon parsed from XML into `PartMetadata.hullPts` + `PartWire.hullPts`; rendered as a closed `<Line>` polygon in `BrickLayer.tsx` when ≥3 points available; falls back to sprite bounding rect for parts without a `<hull>` element (184 parts ship explicit hulls)
- [x] **Elevation badge** labels (per `view/brickElevation` + per-layer `displayBrickElevation`; non-zero altitude only)
- [x] **Electric circuit** overlay — `ElectricCircuitLayer.tsx`: port of `SceneBuilderElectric.cpp`; BFS polarity propagation across connected bricks; OrangeRed / Cyan parallel rail lines offset 2px perpendicular to circuit centreline; orange diamond shortcut markers; gated by `showElectricCircuits` toggle; rendered above bricks (z=500)
- [x] Grid + sub-grid line drawing
- [x] **Sidecar background-image** painted under everything — `BackgroundImageLayer` in `EditorPage.tsx` renders sidecar `backgroundImage` as a `KonvaImage` below all canvas layers
- [x] **Selection halo** — gold / green-when-snap-active polygon outline
- [x] **Linear-ruler endpoint handles** drawn when one ruler selected; draggable to reshape
- [x] **Foreground scale-bar HUD** — bottom-right overlay, auto-picks round stud count, labels in mm/cm/m
- [x] **Module name label** (gated by `view/moduleNames` → `cld:showModuleNames`; `ModuleOverlay.tsx`)
- [x] **Module frame outline** (gated by `view/moduleFrameThickness` → `cld:showModuleFrames`; dashed blue rect over member-brick AABB; thickness from `cld:moduleFrameThickness`)
- [x] **Anchored labels** — World [x], Brick [x], Group [x], Module [x] anchors all render; Group/Module show dashed leader-line from AABB centre to label; add/edit/delete mutations [x]; minZoom gate [x]
- [x] **Venue outline + obstacles + edge labels** — Wall/Door/Open kinds with desktop pen styles, walkway buffer band on non-Wall edges, ft/in distance labels
- [x] **Watermark** — Konva `Text` layer bottom-right: `"author / lug / event"`, semi-transparent, gated by `showExportWatermark`; appears in `stage.toDataURL()` exports
- [x] Live drag/place ghost item
- [x] **Snap ring** overlay at the live snap point (green ring) during single-brick drag
- [x] Live area cell rendering
- [x] Live text-cell rendering with rotation
- [x] Live ruler rendering — line / circle + distance label with desktop unit list (studs / LDU / track / module / m / ft)
- [x] Connection-point markers gated by `view/connectionPoints` toggle (Map menu → Show Connection Points)

---

## Status bar widgets (`MainWindow.cpp:861-1014`)

- [x] Transient status messages (`editorStore.showStatusMessage` → `StatusBar` auto-clears after 3 s)
- [x] Permanent dimension label: "W × H studs (W m × H m when ≥100 studs)" — status bar centre-left
- [x] Permanent selection count
- [x] Permanent zoom % indicator
- [x] Permanent mouse-position-in-studs indicator
- [x] Permanent current-tool indicator
- [x] Permanent venue-validator status — status bar right side shows "Venue: <name>" in green when a venue is defined and enabled, "Venue: disabled" in grey otherwise; hidden when no venue; orange "⚠ N in walkway" badge when bricks overlap the min-walkway AABB buffer around non-Wall edges
- [x] Permanent budget status — status bar shows "Budget: OK" (green) or "Budget: N over" (red) when a budget is loaded; hidden when no budget file is open
- [x] Dirty `*` indicator — appended to tool name in status bar when connection is reconnecting or in error state

---

## Undo-stack commands (one user-action per class — `src/edit/`)

**Bricks** (`EditCommands.cpp`): MoveBricksCommand [x], RotateBricksCommand [x], DeleteBricksCommand [x], AddBrickCommand [x] (placeBrick), AddBricksCommand [x] (insertBricks), ReorderBricksCommand [x] (reorderBricks), EditBrickCommand [x], GroupBricksCommand [x], UngroupBricksCommand [x]

**Layers** (`LayerCommands.cpp`): AddLayerCommand [x] (brick / area / text / ruler), DeleteLayerCommand [x], MoveLayerCommand [x], RenameLayerCommand [x], SetLayerTransparencyCommand [x], SetLayerVisibilityCommand [x], ChangeBackgroundColorCommand [x], ChangeGeneralInfoCommand [x], SetLayerHullPropertiesCommand [x] (`setLayerHullProperties`), SetDisplayBrickElevationCommand [x] (`setLayerDisplayBrickElevation`)

**Text** (`TextCommands.cpp`): AddTextCellCommand [x], DeleteTextCellCommand [x], EditTextCellTextCommand [x]

**Anchored labels** (`LabelCommands.cpp`): AddAnchoredLabelCommand [x] (`addAnchoredLabel`), DeleteAnchoredLabelCommand [x] (`deleteAnchoredLabel`), EditAnchoredLabelTextCommand [x] (`editAnchoredLabel`), MoveAnchoredLabelCommand [x] (`moveAnchoredLabel`) — sidecar-cache mutations (last-write-wins at sidecar level)

**Rulers** (`RulerCommands.cpp`): AddRulerItemCommand [x] (linear + circular via `addLinearRuler`/`addCircularRuler`), DeleteRulerItemCommand [x] (`deleteRulerItem`), MoveRulerItemCommand [x] (`moveRulerItem`), MoveRulerEndpointCommand [x] (`moveRulerEndpoint`), AttachRulerCommand [x] (`attachRulerEndpoint`), EditRulerItemCommand [x] (`editRulerItem`)

**Areas** (`AreaCommands.cpp`): PaintAreaCellsCommand [x]

**Modules** (`ModuleCommands.cpp`): CreateModuleCommand [x] (SaveModuleDialog), DeleteModuleCommand [x] (`deleteSidecarModule`), MoveModuleCommand [x] (`moveModuleBricks`), RotateModuleCommand [x] (`rotateModuleBricks`), RenameModuleCommand [x] (`renameSidecarModule`), CloneModuleCommand [x] (`cloneModuleBricks`), FlattenModuleCommand [x] (`flattenSidecarModule`), RescanModuleCommand [x] (`rescanModuleFromBricks`), ImportBbmAsModuleCommand [x] (ImportBbmDialog)

**Venue** (`VenueCommands.cpp`): SetVenueCommand [x] (`setVenue` — replaces/clears sidecar venue, Yjs-undoable)

---

## File-format features

- [x] `.bbm` reader/writer (Grid / Brick / Text / Area / Ruler layers all round-trip)
- [x] Sidecar `.bbm.cld` (anchored labels, modules, venue, sha256) — round-trip OK; anchored labels [x], modules [x], venue [x] all render
- [x] `.cld-venue` standalone files — JSON serialisation of the sidecar `Venue` object; save (download) and load (file picker) both wired in Map menu
- [x] `.set.xml` write — `SaveAsSetDialog.tsx`; Map menu → "Save Selection as Set…"
- [x] Vendored parts library
- [n/a] User library paths + `imports/` subfolder — superseded by server-side part library manager
- [x] BlueBrick `.bbb` budget read/write — `BudgetDialog.tsx` parses `<Budget><BudgetEntry><PartNumber><Limit>` XML on Open and writes same format on Save

---

## Persistence (QSettings keys → web equivalents)

The desktop persists per-user via QSettings. The web port should use a
mix of: server-side (per-user, sync across devices) and `localStorage`
(per-tab UI state).

- [n/a] `recent/lastFile`, `recent/list` — layout list page serves this purpose
- [x] `editing/snapStepStuds` — persisted to `localStorage` keyed `cld:snapStepStuds`
- [x] `editing/rotationStepDegrees` — persisted to `localStorage` keyed `cld:rotationStepDegrees`
- [x] `editing/paintColor` — persisted to `localStorage` keyed `cld:paintColor`
- [x] `LibraryPaths/UserPaths` — superseded by server-side `part_libraries` table; org-admin enable/disable per org; platform-admin installs from zip URL or upload
- [x] `modules/libraryPath` → superseded by server-side Module Library panel (ModuleLibraryPanel.tsx); `venue/libraryPath` deferred with venue tools
- [x] `view/connectionPoints` → `cld:showConnectionPoints`; `appearance/showGrid` → `cld:showGrid`
- [x] `view/brickHulls` → `cld:showBrickHulls`; `view/brickElevation` → `cld:showBrickElevation`; `view/rulerAttachPoints` → `cld:showRulerAttachPoints`
- [x] `view/moduleNames` → `cld:showModuleNames`; `view/moduleFrameThickness` → `cld:moduleFrameThickness` + `cld:showModuleFrames`
- [x] `view/electricCircuits` → `cld:showElectricCircuits`; `appearance/exportWatermark` → `cld:showExportWatermark`; `view/moduleLabelPercent` → `cld:moduleLabelPercent` — all persisted and wired in Preferences → Appearance tab (no underlying render data yet for circuits)
- [x] `appearance/alwaysShowConnections` → `cld:alwaysShowConnections`; when true, connection-point dots render at full brightness on all bricks (not just selected)
- [x] `appearance/selectionTint` → `cld:selectionTint`; RRGGBB hex, colour picker in Preferences → Appearance tab; drives selection halo colour (default FFD700 gold)
- [x] `appearance/exportWatermark` → `cld:showExportWatermark`; `venue/labelPx` → `cld:venueLabelPx` (default 28, Preferences → Appearance → "Venue label size (px)")
- [x] `general/wheelZoomFactor` → `cld:wheelZoomFactor`; slider in Preferences → General tab (0.2× – 3×); clamped 0.1–10
- [x] `general/undoStackDepth` → `cld:undoStackDepth`; number input in Preferences → General tab (0 = unlimited); pruned in `useUndoManager` on `stack-item-added`
- [x] `general/reopenLastFile` → `cld:reopenLastFile`; checkbox in Preferences → General; LibraryPage mount effect navigates to `cld:lastLayoutId` if set; layout mount records `cld:lastLayoutId`
- [n/a] `general/showSplash` — no splash screen in web model (layout list is the landing page)
- [n/a] `general/newMapTemplate` — new layout uses server-side default seed; no local template path
- [n/a] `general/language` — no i18n system; web UI is English-only
- [n/a] `import/ldrawLibraryPath`, `import/studioLibraryPath`, `import/lddInstallPath` — LDraw/Studio/LDD import not planned for web
- [x] `export/transparent` → `ExportImageDialog` transparent checkbox; `export/pixelRatio` → 1×/2×/4× selector; `export/watermark` → `cld:showExportWatermark` (Preferences → Appearance). `export/path`, `export/width`, `export/height`, `export/keepAspect`, `export/antialias` [n/a — no persistent export path in web model]
- [n/a] `budget/lastFile` — web model uses file-picker per session; no persistent last-file path (browser security model forbids remembering arbitrary file paths)
- [x] `ui/geometry`, `ui/state` — dock left/right/hidden + column widths + panel heights persisted per user via `localStorage` (`dockLayout.ts`); window geometry is browser-managed

---

## Background / lifecycle features

- [x] **Autosave** — desktop autosaves to `<AppData>/autosave.bbm` every 60 s + 5-s throttled. Web equivalent: Yjs continuous sync (every keystroke persisted to server); no local file to recover.
- [n/a] **Restore-autosave** prompt on startup — Yjs provides continuous sync; no local autosave file to restore
- [x] **Window/dock geometry** restore — dock left/right/hidden arrays + column widths + panel heights persisted to `localStorage` per user; restored on load (`dockLayout.ts`)
- [x] Connection graph rebuilt on load + undo/redo
- [x] Selection preserved by guid across scene rebuilds

---

## Drag-and-drop integrations

- [x] Custom MIME drag (parts) `kPartMimeType` — drop on canvas places brick (with connection-snap) (`PartsBrowser.cpp:42-55`)
- [x] Custom MIME drag (modules) `application/x-cld-module` — drop on canvas imports bricks into active layer
- [x] Drop a `.bbm` file onto the window — opens it (`main.tsx` `GlobalBbmDrop`, `EditorPage.tsx` status-bar feedback)
- [x] Drag selection out of viewport → cursor flips to `not-allowed`, release deletes

---

## Web-only features (no desktop equivalent — keep as-is)

- [x] Real-time multi-user collab via Yjs (live cursors, awareness)
- [x] Layout sharing (collaborator + invite + roles)
- [x] Organisations + layout/module ownership transfer
- [x] Audit log
- [x] Demo accounts with TTL
- [x] Per-resource backup worker
- [x] Custom-parts upload (per-user / per-org)
- [x] Saved-modules upload (per-user / per-org)
- [x] **Part library manager** — platform admin installs named zip libraries (URL or upload); org admins enable/disable per-org; parts in installed libraries appear in catalog under their library slug category

---

## Implementation tiers (suggested order)

1. **Visible bugs / data fidelity**
   - Live connection-snap during drag (matches desktop magnetism)
   - Connection-point markers (red/gold dots)
   - Drag-out-to-delete
   - Render anchored labels, modules, venue (sidecar data we already preserve)
2. **Core editing verbs**
   - Cut / Copy / Paste / via clipboard (cross-tab)
   - Bring-to-front / Send-to-back
   - Group / Ungroup
   - Edit-Brick dialog (per-brick properties)
3. **New tool modes**
   - Paint-area / Erase-area + colour picker
   - Add-text + Edit-text dialog
   - Linear-ruler / Circular-ruler draw + render + edit dialog
4. **Side-panel parity (with moveable + persisted layout)**
   - Layers panel + Layer Options dialog
   - Modules panel + Module Library panel
   - Used Parts panel
   - Moveable / dockable panel infrastructure (drag, resize, undock, persist per user)
5. **Dialogs**
   - General Info, Background Color, Background Image, Preferences
   - Find & Replace
   - Library Paths
   - Export-as-Image / PDF / Print
6. **Venue + Budget**
   - Venue tools (outline / obstacle / dimensions / edit / save / load)
   - Budget editor + Used Parts indicator
7. **Polish / status bar**
   - Status bar with mouse-stud HUD, selection count, dimensions
   - Scale-bar HUD on canvas
   - Per-tool cursor swap
   - View-menu render toggles + their state persistence
8. **Imports**
   - LDraw / Studio / LDD importers (browser-side parsers)
   - Download Center
9. **Recent files / Open Recent submenu** (already covered by layout list)

---

_End of inventory. Update this document as items ship — change `[ ]` to `[x]` and (optionally) cite the web file:line that implements it._
