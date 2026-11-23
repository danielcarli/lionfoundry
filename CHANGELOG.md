# Changelog

LionFoundry is an experimental open-source platform for type design projects in a world of AI. Versions below 1.0 may change formats and behaviour.

## 0.17.0 — 2026-11-23

**Comfort while drawing** (second half of phase 2 of the plan to come closer to the way type designers work in the industry-standard software)
- **Background** of each glyph, in each master: **Copy to background** keeps a copy of the drawing behind it, **Swap with background** brings the background to the front to be edited (and the drawing goes behind), **Clear background** empties it; `Alt` does it in every master. A new toolbar button shows or hides it (it turns on by itself after a copy). It is saved in the project as UFO layers — `public.background` for the default layer and `<layer>.background` for the layer of another master — so other font editors read it too; the layers go away when no glyph has a background.
- **Rotate** (`R`): drag to turn the selection around its centre, or around the point set with a click (the same point the scale tool uses); `Shift` turns in steps of 15°, and the angle shows while dragging.
- **Ruler** (`L`): drag a line to see its length and angle, and the distance between each place where it crosses the outline — the thickness of every stroke it runs through (components included). It stays until another tool is taken or `Esc`; `Shift` keeps it at steps of 45°.
- **Lasso**: with the select tool, `Alt` + drag from an empty place draws a free line around the points to take. (The plan said `Shift+V`, which already makes handles vertical.)
- **Align points** (`Ctrl+Shift+A`): the selected points go on one horizontal line when they lie across, or one vertical line when they lie up and down, at their average; their handles go with them.
- `Tab` and `Shift+Tab` go to the next and previous point of the contour.
- The toolbar of the Glyph view hides the button labels until there is room for them all, and on a narrow window it breaks into two clean rows (tools above; "show" buttons and zoom below) instead of leaving two buttons alone on the second row.
- Left out of this phase for now: "open corner" and "reconnect nodes", which belong with corner components (phase 7).

**Documents and tests**
- READMEs and tutorials in the seven languages: the new tools in the Draw section and in "Where it stands"; "Measure and compare" in step 2 of the tutorial; the numbered picture of the toolbar made again (rotate 10, ruler 11, snap 12, background 18; zoom 19 and fit 20).
- New messages (27) in the seven languages, without review by native speakers for the five translated ones.
- Tests: 39 unit tests (new: the background written as UFO layers and read back, per master) and 129 end-to-end checks (ruler across a stem, rotation by 90° and undo, copy and swap with the background, `Tab`, align, lasso).

## 0.16.0 — 2026-11-23

**Operations on contours** (first half of phase 2 of the plan to come closer to the way type designers work in the industry-standard software)
- **Remove overlap** (`Ctrl+Shift+O`, and a button in the Outline section of the panel): the shapes that overlap become one outline. It works on the curves themselves — they are cut where they cross and joined again — so curves stay curves; nothing is turned into polygons. Contours that do not overlap anything are left exactly as they were, start point included; a counter (wound the other way) stays a counter.
- **Union, Subtract, Intersect**, with contours selected (a point of a contour is enough): join the selected contours, cut them out of the others like a cookie cutter, or keep only where they overlap.
- **Knife** (`E`): drag a line across shapes and they are cut into closed parts, along the line; `Shift` keeps it at steps of 45°.
- **Rectangle and ellipse** (`F`; `F` again switches between them): drag from corner to corner; `Shift` makes a square or a circle, `Alt` draws from the centre. The size shows while dragging; the new contour is drawn counter-clockwise, as an outer contour, and the ellipse has its points at the extremes.
- **Add extremes** (panel): points at the horizontal and vertical extremes of the curves, of the selected contours or of all, without changing the shape. With the add-point tool, `Shift`+click puts the point at the extreme of the curve nearest to the click.
- **Tidy up** (`Ctrl+Shift+T`, and a button): removes points that sit on the point before them, points in the middle of straight lines, and the handles of curves that are straight.
- **Points on top of each other** are marked with a red ring, and the panel says how many there are.
- `Alt` with Remove overlap, Add extremes, Tidy up and the knife does it in every master (each one on its own; the result may need Fix compatibility).
- **Export › Remove overlaps**: the exported fonts get their overlaps removed; the project keeps its contours as they are.
- If an operation cannot work out a shape cleanly (curves that only touch at one point, for example), nothing changes and a message says so — a shape is never lost.

**Documents and tests**
- READMEs and tutorials in the seven languages: the tools in the Draw section and in "Where it stands"; "Building from shapes" in step 2 of the tutorial; the numbered picture of the toolbar made again (knife 8, rectangle and ellipse 9; the numbers after them moved by two).
- New messages (49) in the seven languages, without review by native speakers for the five translated ones.
- Tests: 38 unit tests (new: the operations on lines and curves, the knife, extremes, tidying, primitives and exporting without overlaps). The operations were also checked outside the suite on 700 random sets of squares and circles (2,800 operations, no failure) and on overlapping letters of the example typefaces (area kept within 0.25%). 124 end-to-end checks (rectangle by dragging, remove overlap, knife, ellipse, extremes, undo).

## 0.15.0 — 2026-11-23

**The masters side by side** (phase 4 of the plan to come closer to the way type designers work in the industry-standard software)
- **All masters** (toolbar of the Glyph view, only in a project with masters): the glyph being edited in every master, in a row under the line of text, with the name of each master under it. The master being edited is in the accent colour; a master that cannot be interpolated with it is marked `≠` in red. A double-click on one works in that master.
- **Compatibility**: the on-curve points get numbers (`2.3` is the third point of the second contour), a dashed line goes from each point to the same point in the other masters of the group, and a red ring marks a point that has no counterpart there or whose type differs.
- **Preview**: a strip under the canvas with the line of text at any position between the masters, and a slider to move along the weight axis. It starts at a style of the family between the masters; glyphs that cannot be interpolated are shown from the nearer master and counted. Kerning is interpolated too.
- **Add missing points** (panel, Master compatibility, when the number or the kind of points differs): each of the two drawings gets the points the other has, at the same place along the contour, and neither shape changes. A straight segment facing a curve becomes a curve with its handles on the line.
- **`Alt` changes every master**: with the add-point tool, the same point goes at the same place of the same segment in every master whose contour has the same segments; with the remove-point tool, the same point comes out where the contour has the same points; **Reverse direction** and **Correct direction** with `Alt` turn the contours of every master. One undo takes back the change in all of them.
- The shortcuts screen lists `Alt` for every master.

**Seven languages for now**
- Chinese (简体中文), Japanese (日本語) and Korean (한국어) were taken out of the interface and the documents. The interface, the READMEs and the tutorials are in English, Português (Brasil), Português (Portugal), Español, Français, Deutsch and Italiano. This is a decision for now and may be reviewed; the catalogs and documents removed are in version 0.14.0.
- A language chosen in an earlier version that is no longer offered falls back to the language of the system.

**Documents and tests**
- READMEs and tutorials: a paragraph on the masters side by side (with a new picture) in the family section, and in step 7 of the tutorial; "match them by hand" is gone, since the app now adds the missing points.
- New messages (13) in the seven languages, without review by native speakers for the five translated ones.
- Tests: 37 unit tests (new: points added between masters, the interpolation helpers) and 121 end-to-end checks (the row of masters and the double-click, the compatibility map, `Alt` with the add-point tool, Add missing points, the preview, undo in every master).

## 0.14.0 — 2026-11-23

**Edit inside a line of text, as in other font editors** (phase 1 of the plan to come closer to the way type designers work in the industry-standard software)
- The Glyph view is now **a line of text**. One glyph is being edited — points, handles, anchors, the panel — and the others are shown filled, with their spacing and kerning. Kerning shows where it moved a glyph: a blue band when it brings two glyphs closer, amber when it moves them apart, with the value under it. With **Metrics** on, each glyph shows its side bearings under it.
- **A text field** above the canvas: type or paste a word, several lines too. `/name` puts a glyph that has no character (`/a.sc`); characters the font does not have yet show as empty boxes, and become the glyph as soon as it exists. **Samples…** offers the texts of the proof.
- **Text tool (`T`)**, the first of the tools: click to put the cursor, type to put glyphs at it, `Backspace` and `Delete` take them out, `Enter` starts a new line, the arrows move the cursor. The glyph after the cursor is the one being edited, everywhere in the app. `Esc` goes back to the select tool to draw it; a double-click on a glyph of the line does the same with that glyph.
- **Spacing and kerning from the keyboard**, with the text tool: `Alt + ← →` the left side bearing of the glyph after the cursor, `Ctrl + ← →` its right side bearing, `Ctrl+Alt + ← →` its kerning with the glyph before it (← closer, → apart); `Shift` for 10 units at a time. On the Mac, Cmd and Option. The same logic as in the industry-standard software — the modifier picks the side, the arrow the direction — with one set of keys for every system.
- The kerning written is the pair that applies already (glyph or group); when none does, the pair between the groups of the two glyphs. The proof follows the same rule (it is now one function, `kerningPairFor`).
- **Double-click** another glyph of the line, with any other tool, to edit it without losing the text.
- `[` `]` and now also `Home` `End` swap the glyph being edited for the previous or next glyph of the font; the rest of the line stays (for spacing tests such as `nnonn` with the alphabet in the middle). Opening a glyph from the font view, the check view or the proof starts a new line with that glyph, as before.
- The panel has a new **Kerning** section with the pair before and the pair after the glyph being edited.
- The shortcuts screen (`?`) has a group for the text tool.
- When zoomed out, the labels of the metric lines no longer pile up.
- READMEs and tutorials in the ten languages: the line of text in the spacing section, with a new picture, and a paragraph on spacing in the Glyph view in step 4 of the tutorial. The numbered picture of the toolbar was made again with the text tool (numbers 2 to 15 moved by one).
- New messages (15) in the ten languages, without review by native speakers for the eight translated ones.
- Tests: 36 unit tests (two new: the text of the line and the kerning pair rule) and 119 end-to-end checks (typing, the cursor, spacing and kerning keys with undo, double-click, `[` `]`, `/name`, characters the font lacks, samples).

## 0.13.0 — 2026-11-22

**Ten languages**
- The interface is now in **English, Português (Brasil), Português (Portugal), Español, Français, Deutsch, Italiano, 简体中文, 日本語 and 한국어** — the ten languages of the Lion apps. Every catalog has all 761 messages. Choose the language in the status bar; "automatic" follows the system.
- The system language is matched more carefully: `pt-PT` and Portuguese outside Brazil get the European catalog, `pt` and `pt-BR` the Brazilian one; a regional tag falls back to its language (`de-AT` → Deutsch, `zh-TW` → 简体中文, the only Chinese catalog).
- **The translations were written without review by native speakers.** English and Brazilian Portuguese are the reviewed texts; the European Portuguese catalog was adapted from the Brazilian one. Type terms follow the usual words of each language (for example *Dickte*, *Vorbreite* and *Nachbreite* in German, *chasse* and *approches* in French, 母版 and 字偶间距 in Chinese); feature tags, glyph names and theme names are not translated. Corrections are welcome.
- The packaged app carries the Chromium language files of the new languages.

**A README and a tutorial in every language**
- `README.<language>.md` and `docs/tutorial.<language>.md` for the eight new languages, each with a line that links the ten. The names of buttons, views and menus in the tutorials are taken from the catalogs, so they are the ones on the screen. The pictures still show the English interface; each README also shows the Glyph view in its own language.
- The translated READMEs point to the English one for the developer section, which stays in English like the code.

**Layout, found while trying the new languages**
- The tab bar keeps every view name on one line and scrolls sideways when the window is too narrow for all of them (in Japanese the names used to break in two lines). The open view is kept in sight.
- The width, left and right fields of the glyph panel stay aligned when a label needs two lines.
- The window no longer grows wider than the screen when the row of tabs does not fit.

**Windows: the icon of the installed app**
- On an installed copy, the Start menu and the task bar could show a blank icon although the installer showed the right one. The cause could not be reproduced: a Windows build made with the same tools carries the icon in `LionFoundry.exe`, with the six sizes of `build/icon.ico`. Two things changed so that it no longer depends on that alone: the icon file is shipped beside the app (`resources/icon.ico`) and the window is given it explicitly, and the release workflow now reads the packaged `LionFoundry.exe` and reports on the run page when it has no icon (`tools/check-win-icon.js`, `npm run check:win-icon -- <exe> [icon.ico]`).
- **Not tested on Windows.** If the icon is still blank after installing this version, Windows may be showing a cached icon: unpin LionFoundry from the task bar, run `ie4uinit.exe -show` (or restart Explorer, or sign out and in), and open it again from the Start menu.

**Other**
- The READMEs say what is known about each installer: the Windows one has been installed and opened on a real computer; the macOS one has not been tried.
- Tests: 34 unit tests (one new, for the languages) and 114 end-to-end checks (the app is opened in each of the eight new languages).

## 0.12.2 — 2026-11-22

- The English tutorial is now titled **"From scratch to the first typeface"**. Nothing else changed.

## 0.12.1 — 2026-11-22

- **Tutorial: "From zero to your first typeface"** (renamed in 0.12.2) (`docs/tutorial.md`, and `docs/tutorial.pt-BR.md` in Portuguese): from an empty project to a family with two weights and an italic, in plain language. It starts by showing the tools — a numbered picture of the toolbar of the Glyph view, what each tool and button is for, the panel and the scale box — and a short list of the words used. Then ten steps: the project, the first letters, the rest of the alphabet, spacing, accents, kerning, the Bold and the instances, the Italic, checking and exporting.
- Both READMEs link to it.
- No change to the app itself.

## 0.12.0 — 2026-11-22

**Scale what is selected, with the gestures of Illustrator**
- With two or more points (or anchors) selected, the select tool draws a **box around the selection** with eight handles. Drag a corner to make the shape larger or smaller both ways, a side handle to change one way only. **Shift** keeps the proportions; **Alt** scales from the centre instead of from the opposite side. The percentage is shown while dragging.
- New **Scale tool** (`S`): drag anywhere to scale the selection from its centre; a click chooses another point to scale from (shown as a small target); Shift keeps the proportions.
- **Ctrl+Shift+B** shows or hides the box, as in Illustrator.
- The handles of a selected point go with it — in the box, in the scale tool and now also in Move, Scale, Rotate, Slant and Mirror of the panel, which used to leave them behind.
- One step in Undo for each scale; points are calculated from where they started, so a long drag does not drift.
- Ctrl+B no longer reacts when Shift is held.
- The shortcuts screen lists the new keys.
- Tests: 33 unit tests and 105 end-to-end checks.

## 0.11.2 — 2026-11-22

- **Installers.** A release workflow (`.github/workflows/release.yml`) builds the installers when a version tag is pushed — which is what `git-publish` does — and publishes them as a GitHub release with `SHA256SUMS.txt` and the notes of the version: `LionFoundry-Setup.exe` and `LionFoundry-win-x64.zip` (Windows), `LionFoundry-mac-universal.dmg` (macOS), `lionfoundry_amd64.deb`, `lionfoundry.x86_64.rpm` and `LionFoundry-x86_64.AppImage` (Linux). Every installer holds the whole app. The file names do not carry the version, so the links in the README always bring the latest release.
- The AppImage and the `.deb` were built and started before this release: the packaged app opens, lists its examples, opens a project and runs a Python script. The `.rpm`, the Windows installer and the macOS image have not been tried yet.
- **README**: a Download section at the top, as in the other Lion apps, and the whole README also in Portuguese (`README.pt-BR.md`), each linking to the other.
- `tools/release-notes.js` prints the notes of a version from this file.
- No change to the app itself.

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
