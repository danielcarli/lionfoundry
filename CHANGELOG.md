# Changelog

LionFoundry is an experimental open-source platform for type design projects in a world of AI. Versions below 1.0 may change formats and behaviour.

## 0.11.1 — 2026-11-22

- **README rewritten** to present the app: what it is for, what makes it different, each part of the work with its screenshot, and a section on working with AI agents (the local server, the command line, scripts, what stays under your control and what is not done yet). The list of what is missing is kept, shorter.
- Screenshots redone with the current interface; new ones for Export, the fonts of an exported family, the themes, Portuguese and the shortcuts screen.
- **Publishing scripts** (`git-publish.cmd` for Windows, `git-publish.sh` for macOS and Linux) for https://github.com/danielcarli/lionfoundry: they connect the folder to the repository the first time, commit with `commit.txt`, create the tag of the version and push. They work in a folder that was just unzipped, refuse a version that was already published, ask before publishing and can be run again after a push that failed. As before, the scripts and `commit.txt` are not committed.
- No change to the app itself.

## 0.11.0 — 2026-11-22

An interface pass: nothing new to learn twice. Every function is in one place, with the name and the key it has in other font editors, and the habits of the other Lion apps.

**The words of font editors**
- **Masters** (the styles that are drawn) and **instances** (the ones calculated between them) replace "weights" and "calculated styles" everywhere. The Family view has "Masters", "Between the masters" and "Masters and instances".
- **Guides** replace "reference lines"; the magnet is **Snap** (still the M key and the magnet button).
- **Set start point**, **Correct direction**, **Fix compatibility** and **Copy from this master** replace "Start here", "Correct directions", "Follow its structure" and "Copy its drawing here".
- The Spacing view is now **Kerning**, which is what it holds.
- `[` and `]` go to the previous and next glyph.

**One place for each function**
- **Export** (side bar button or Ctrl+E) is one dialog: what — the master being edited or the whole family — and the formats; the feature code (`.fea`) and the `.designspace` are exported there too. The export buttons of the Family and Features views are gone, and so is "Export this weight": add the position as an instance and export.
- **Add glyphs for a language** is one function with one dialog, reached from the font view and from the coverage list in Check. It replaces "Build accented letters" and "Create", which overlapped.
- The master being edited is chosen in the side bar only (the Family view no longer has an "Edit" button per row).
- Glyphs that cannot be interpolated are listed once, in Check; the Family view gives the count and the link, the glyph view fixes each one.
- Kerning groups and pairs are in the Kerning view only (they were also listed, read-only, in Font info).
- "Save as" moved from the Export menu to the Project menu.
- The glyph panel lost the buttons that repeat a standard shortcut (Select all, Copy, Paste).

**As in the other Lion apps**
- The status bar has **one theme button** with a menu (it had four buttons), and no longer repeats the name of the project and the number of glyphs, which are in the title bar and the side bar.
- **Shortcuts screen**: the `?` key, or the `?` in the status bar.
- **Explanations shown once**: the paragraph under a section title has "Got it"; after that it waits behind a "?" beside the title.
- Section titles are no longer in capitals.

**Also**
- Tests: 33 unit tests and 103 end-to-end checks.

## 0.10.0 — 2026-11-22

A first version meant to carry a whole family from the first weight to the exported fonts.

**The family**
- **Italics**: "New italic from this weight" (Family view) adds an italic that starts as the weight being edited, slanted by the angle given (an oblique with the same points, to redraw). Uprights and italics are two groups: weights in between and the compatibility report work inside each. The slant is written to the exported font (italic angle, caret, style bits). Kept in `org.lionfoundry.weights` as `italic` and `angle`.
- **Calculated styles** (instances): "Add this position as a style" lists a position between two weights as a style of the family. It is calculated at every export. Kept in `lib.plist` under `org.lionfoundry.instances`.
- **The whole family**: every style, drawn or calculated, set in the same text. **Export the family** compiles all of them into a new folder created where you choose — `ttf/`, `woff2/` and a `.css` with the `@font-face` rules. Nothing that exists is replaced: a second export makes a second folder.
- **Names for style linking**: "Light Italic" is written as the Italic of "Family Light" (name IDs 1 and 2, with the full family and style in 16 and 17), so programs that only offer Regular, Italic, Bold and Bold Italic reach every style.
- A calculated style now carries its own weight class (it used to inherit the one of the lighter weight).

**Drawing for more than one weight**
- **Other weights** toggle in the glyph view: the same glyph of the other weights of the group is drawn behind the one being edited.
- **In the other weights** (glyph panel): for each weight, whether the glyph can be interpolated and why not. **Follow its structure** reorders the contours, turns them and moves their start points to agree with that weight; the shape does not change. It also catches glyphs whose points agree but in another order, which would twist on the way. **Copy its drawing here** replaces the glyph with the one of that weight.
- **Start here** makes the selected point the first of its contour; **Correct directions** winds outer shapes and counters the way fonts expect.
- **Copy, cut and paste** (Ctrl+C, Ctrl+X, Ctrl+V): contours with something selected, selected components and anchors, or the whole glyph when nothing is selected — between glyphs, weights and projects. In the font view, Ctrl+C and Ctrl+V work on the selected glyph.

**Spacing**
- New **Spacing view** (Ctrl+9): kerning groups for the first and the second glyph of the pair — create, add glyphs by typing characters or names, take out, remove (with the typed code; its pairs go in every weight) — and the list of kerning pairs of the weight being edited, with search, typed values and "New pair".

**Characters and export**
- **Create** in the Check view gives the font a glyph for every character a language lacks: accented letters are built from base and accent where the font has both, the rest start empty with their code and a width. Every weight gets them.
- Glyphs whose shapes are drawn over one another are marked as overlapping in the exported font (simple and composite), so rasterizers fill them without holes. The drawing is not changed.

**Agents and command line**
- `export-family <project> <new-folder>` and the `export_family` tool: every style of the family, as the app exports it. `info` says which weights are italic.

**Also**
- The sans example lists two calculated styles, Medium and SemiBold.
- Tests: 33 unit tests and 99 end-to-end checks. A family with italics and calculated styles exported by this version was read with fontTools, set with FreeType and shaped with HarfBuzz.

## 0.9.0 — 2026-11-21

**Several weights in one project**
- A project can hold several weights of the typeface. "New weight" (Family view) starts one as a copy of the weight being edited; "Bring a weight from another project" copies the drawing and kerning of another UFO in. The weight switch in the side bar chooses which one every view shows and edits; the title and the status bar name it.
- Each weight has its own outlines, widths, anchors, components, reference lines and kerning values. Names, metrics, kerning groups, features, colours and the list of glyphs are shared: creating, duplicating, renaming or deleting a glyph, and building accented letters, happen in every weight.
- The Family view interpolates between the weights, reports what cannot be interpolated (also listed in the Check view), exports any weight in between and a `.designspace` that points to the layers. "Export" exports the weight being edited, with its own style name and weight class.
- On disk the first weight is the default layer of the UFO and each other weight is one more glyph layer, listed with its position and kerning in `lib.plist` (`org.lionfoundry.weights`). Removing a weight removes its layer on the next save.
- Undo and redo go back to the weight a change was made in. Removing a weight asks for the typed code.
- Command line and server for agents: `--weight <name>` / `weight` works on one weight; `info` lists them.
- The sans example is now one project, `LionFoundryExampleSans.ufo`, with Regular and Bold. Linking other projects as masters (0.8) gave way to this; a project that used it says so in the Family view.

**Points and handles**
- **Add point** tool (`+`): a click on the outline adds a point there without changing the shape (lines, cubic curves and simple quadratic curves).
- **Remove point** tool (`−`): a click on a point removes it and joins the curve around it, keeping the outer handles' directions. The Delete key now removes points the same way (it used to leave a distorted curve).
- **Handle direction**: Shift while dragging a handle keeps it horizontal, vertical or at 45° from its point (also while pulling handles with the pen); Shift+H, Shift+V, Shift+D turn the selected handles — or the handles of the selected points — horizontal, vertical or to the nearest 45°; Shift+A asks for an angle, and the panel has buttons and an angle field. The handle on the other side of a smooth point follows.
- Zoom moved to Ctrl + plus, Ctrl + minus and Ctrl+0 in the glyph view (the wheel is unchanged), so that `+` and `−` pick the tools.

**Also**
- The application menu of Electron is no longer installed on Windows and Linux, so none of its shortcuts can get in the way of the app's own.
- Tests: 31 unit tests and 88 end-to-end checks.

## 0.8.1 — 2026-11-21

- **Reference lines per glyph**: horizontal, vertical and diagonal lines, added from the panel of the glyph view, dragged with the select tool, nudged with the arrows, edited by position, angle and name, deleted with Delete. They are the guidelines of the UFO format, so they are saved in the project and read by other editors. A "Guides" toggle shows or hides them; the reference lines of the whole font, when a project has them, are shown too.
- **Magnet** (button in the toolbar, or M): what is dragged or drawn is pulled onto the metric lines, the advance width and the reference lines within 8 pixels — onto a corner when two lines are near, and onto the nearest spot of a diagonal. The lines that hold the point light up. Alt lets go for one move. The magnet only acts while something moves: switching it off or back on leaves every point and drawing where it is. Only lines that are on screen attract.
- A new left side bearing carries the reference lines along with the drawing; scaling, rotating or mirroring the outline leaves them in place.
- Scripts: `glyph.guidelines` and `glyph.appendGuideline` in JavaScript and Python.
- What is selected is now drawn in the text colour with an accent rim (it was a translucent tint, hard to see).
- The toolbar of the glyph view keeps inside the window: on narrow windows the "show" toggles keep only their icons.
- Tests: 28 unit tests and 78 end-to-end checks.

## 0.8.0 — 2026-11-21

A first, basic form of every stage of the roadmap from 0.2 to 0.8, in one step. Each stage is deliberately shallow; the README lists what each one still leaves out.

**Draw and edit (0.2)**
- Glyph view: Select tool (click, box, drag, arrows, Delete, corner/smooth) and Pen tool (straight and curve points, closing a contour); the panel edits advance width and side bearings, moves, scales, rotates, slants and mirrors, reverses contours, adds components and anchors.
- Font view: new glyph (name suggested from the character), duplicate, rename (references follow), delete (with the typed confirmation code), accented letters built from anchors, transformation of all the glyphs shown.
- Undo and redo for every change; the window asks before closing with unsaved changes.
- Projects: save UFO 3 (only what changed is rewritten; what LionFoundry does not edit is kept), “save as”, new project, import of TrueType fonts. The first save of a session keeps a copy of the project as it was.
- Export of TrueType (`.ttf`) and WOFF2 by a compiler written for LionFoundry (glyf with cubic-to-quadratic conversion, cmap, name, OS/2, post, GDEF, GSUB, GPOS, COLR/CPAL).

**Space (0.3)**
- Side bearings, width and the kerning pair that applies are edited in the proof, on the letter that was clicked.

**OpenType (0.4)**
- Features from three sources: automatic (glyph names, kerning, anchors), rules, and feature code (single and ligature substitutions and pair adjustments; other lines are kept and reported).
- The proof shapes text with the font's features (substitutions, ligatures, kerning, mark attachment), each feature can be switched on and off, and every step is listed. “Compiled font” shows the exported font through the system's text engine.

**Families (0.5)**
- Masters on one axis, a slider for any weight in between, a compatibility report, export of one weight and of a `.designspace` file. The sans example gained a Bold master.

**Check and produce (0.6)**
- Project guide, language coverage, problems list; printable specimen as PDF.

**Colour (0.7)**
- Colour palette and colour layers per glyph, exported as COLR/CPAL version 0.

**Scripting and agents (0.8)**
- Scripts in JavaScript and Python with one object model; a script is one undoable step.
- `tools/cli.js` (info, glyphs, glyph, validate, features, shape, export, convert, run) and `tools/mcp-server.js`, a local Model Context Protocol server. Neither changes an existing project or file.

**Also**
- Eight views (Ctrl+1 … 8); font info is editable.
- The example typefaces were regenerated without slivers and repeated points left by boolean operations.
- Tests: 26 unit tests and an end-to-end test of 70 checks that draws with the mouse and verifies the files written to disk.

Not included: OTF (CFF), FontForge SFD, variable font export, hinting, contextual lookups, HarfBuzz inside the app, installers. Only run on Linux so far.

## 0.1.0 — 2026-11-21

First version: the foundation of the app, read-only.

- Application skeleton in the architecture of the Lion family (Electron, `base` → `platform` → `workbench`, sandboxed renderer, `preload` bridge, strict Content Security Policy).
- Opens UFO projects (versions 2 and 3) with a reader written for LionFoundry (XML, property lists, GLIF 1 and 2). The project is never changed; problems in it are reported instead of stopping the reading.
- Font view: glyph grid with thumbnails drawn on demand, search by name, character or code point, categories in the side bar.
- Glyph view: outline, points and handles, metric lines, components, anchors, zoom and pan, measurements panel.
- Proof view: text set from the glyph outlines with advance widths and kerning (UFO 3 group rules), with kerning on or off.
- Font info: names, metrics, contents, kerning groups and pairs, feature code, warnings.
- Two example typefaces (sans and serif, 114 glyphs each, SIL OFL 1.1), generated by `tools/examples/build.py`.
- Four themes: "Mapa de Daca" (default) and "Mapa de Amsterdã", plus the classic Dark and Light; interface in English and Português (Brasil).
- Version indicator in the bottom-right corner; the version check runs only when asked.
- `tools/inspect.js`: describes a project as JSON from the command line, the first piece of the integration with scripts and AI agents.
- Tests: unit tests (`npm test`) and an end-to-end test of the whole interface (`npm run test:e2e`).
