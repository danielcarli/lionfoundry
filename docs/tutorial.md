# From scratch to the first typeface

**English** · [Português (Brasil)](tutorial.pt-BR.md) · [Português (Portugal)](tutorial.pt-PT.md) · [Español](tutorial.es.md) · [Français](tutorial.fr.md) · [Deutsch](tutorial.de.md) · [Italiano](tutorial.it.md)

In this tutorial you start with an empty project and end with a small family ready to install: **Regular**, **Bold** and **Italic**, plus two styles LionFoundry calculates by itself between Regular and Bold.

It is not a course on drawing letters. It is the path inside the app: what to do, in which order, and where to click. The drawing is yours.

> LionFoundry is experimental: **save often** (`Ctrl+S`) and keep copies of your project.

**Before you start:** press `?` at any time to see every shortcut. The views are on `Ctrl+1` to `Ctrl+9`: Font, Glyph, Proof, Features, Family, Check, Scripts, Font info, Kerning.

## The path

| Part | What you do |
|---|---|
| [The tools](#the-tools) | Meet the pen, the selection, the scale and the panel |
| [1. The project](#1-the-project) | Create it, save it, set the heights |
| [2. The first letters](#2-the-first-letters) | Draw `n`, `o`, `H`, `O` |
| [3. The rest of the alphabet](#3-the-rest-of-the-alphabet) | Make the other letters from the first ones |
| [4. Spacing](#4-spacing) | Set the side bearings by reading the text |
| [5. Accents](#5-accents) | Build the accented letters |
| [6. Kerning](#6-kerning) | Fix the pairs that are left |
| [7. The Bold](#7-the-bold) | Add the second weight and the weights in between |
| [8. The Italic](#8-the-italic) | Add the italic from the Regular |
| [9. Check](#9-check) | Read the list of problems |
| [10. Export](#10-export) | Make all the fonts at once |

## Words you will see

| Word | What it is |
|---|---|
| **Glyph** | The drawing of one character. The letter `a` is a glyph; `á` is another. |
| **Contour** | The closed line that makes the drawing. The `o` has two: the outer one and the inner one. |
| **Point and handle** | The point sits on the line. The handles come out of it and say how the curve bends. |
| **Side bearings** | The white space on the left and on the right of each letter. |
| **Kerning** | A change of space for one pair of letters only, like `AV`. |
| **Master** | A style you draw: Regular, Bold, Italic. |
| **Instance** | A style the app calculates between two masters: Medium, SemiBold. |
| **Anchor** | A named point that says where an accent sits on a letter. |

## The tools

Almost all the drawing happens in the **Glyph** view (`Ctrl+2`). This is its toolbar:

<div align="center">
<img src="screenshots/tutorial-toolbar.png" alt="The toolbar of the Glyph view, with a number on each button" width="900">
</div>

**To draw**

| No. | Tool | Key | What it is for |
|---|---|---|---|
| 2 | **Text** | `T` | Type to put letters in the line. The letter after the cursor is the one the keys change (step 4). `Esc` goes back to drawing it. |
| 3 | **Select** | `V` | Click a point, drag a box to take several, drag to move. The arrows move by 1 unit; with `Shift`, by 10. `Delete` removes. |
| 4 | **Pen** | `P` | Draw. Click: a straight point. Click and drag: a curve point. Click the first point: the shape closes. |
| 5 | **Scale** | `S` | Make what is selected larger or smaller. Drag; `Shift` keeps the proportions. |
| 6 | **Add point** | `+` | Click on the line and a point goes there. The shape does not change. |
| 7 | **Remove point** | `−` | Click a point and it is gone. The curve stays as close as it can. |
| 8 | **Knife** | `E` | Drag a line across shapes: they are cut into closed parts. |
| 9 | **Rectangle** / **Ellipse** | `F` | Drag from corner to corner to draw a rectangle; `F` again switches to the ellipse. `Shift`: square or circle. |
| 10 | **Rotate** | `R` | Turn what is selected around its centre (click to choose another point). `Shift`: steps of 15°. |
| 11 | **Ruler** | `L` | Drag a line: it shows its length, its angle and the thickness of every stroke it crosses. |
| 12 | **Snap** (the magnet) | `M` | Pulls what you drag onto the height lines and the guides. `Alt` lets go for one move. |

**To see**

| No. | Button | What it shows or hides |
|---|---|---|
| 1 | Arrows | Previous and next glyph (also `[` and `]`) |
| 13 | Fill | The letter painted, as it will look in a text |
| 14 | Points | The points and the handles |
| 15 | Metrics | The height lines and the width of the letter |
| 16 | Anchors | The points where accents sit |
| 17 | Guides | Your own helper lines |
| 18 | Background | The copy of the drawing kept behind it, to compare with or to trace over |
| 19 | Zoom | In and out (also the mouse wheel, or `Ctrl` `+` and `Ctrl` `−`) |
| 20 | Fit | Shows the whole glyph (`Ctrl+0`). `Space` + drag moves the view. |

When the project has more than one master, one more button appears, **Other masters**: it shows the other weight behind the one you are drawing.

**The panel on the right** has the rest: the width and the side bearings (**Metrics**), what is selected, **Transform** (move, scale, rotate, slant and mirror by number), components, anchors and **Guides**.

**The scale box.** With two or more points selected, a box appears around them. Drag a corner to make the shape larger or smaller. `Shift` keeps the proportions; `Alt` grows from the centre.

<div align="center">
<img src="screenshots/tutorial-scale.png" alt="Two circles selected, with the scale box around them" width="640">
</div>

**A mistake?** `Ctrl+Z` undoes anything.

## 1. The project

1. **`Ctrl+N`** (New project…). Type the name of the family and leave **1000** units per em. The project starts with empty glyphs for A–Z, a–z and the figures.
2. **`Ctrl+Shift+S`** (Save as…) and choose where to save. The project is a `.ufo` folder.
3. In **Font info** (`Ctrl+8`), check the heights. A good start for a text face:

| Line | Value |
|---|---|
| Ascender | 740 |
| Cap height | 700 |
| x-height | 500 |
| Descender | −220 |

These lines show in every glyph, and they hold your points when **Snap** is on (the `M` key).

## 2. The first letters

Start with four letters. They decide almost everything: `n` and `o` set the lowercase, `H` and `O` the capitals.

In the **Font** view (`Ctrl+1`), double-click `n` to open it in the **Glyph** view.

<div align="center">
<img src="screenshots/glyph-daca.png" alt="The Glyph view with a letter being edited" width="820">
</div>

Take the **Pen** (`P`) and draw the shape, point by point. Then switch to **Select** (`V`) and adjust.

**Four habits that save work later**

- **Points at the extremes.** On a curve, put the points at the top, the bottom and the sides — not in the middle of the diagonal.
- **Straight handles.** Hold `Shift` while dragging a handle, or use `Shift+H` and `Shift+V`, to make it horizontal or vertical.
- **Round letters go past the line.** The `o` and the `O` go about 10 units below the baseline and above the height, or they look smaller than `n` and `H`.
- **Write down the thickness.** Measure the stem of the `n` (say, 80 units) and use the same value in the other letters.

In the panel, under **Metrics**, type the **Left side bearing** and the **Right side bearing**. Rough values will do for now: 60 for straight sides, 30 for round sides.

Need one more line? Under **Guides**, in the panel, add a horizontal, vertical or diagonal guide and drag it into place.

<div align="center">
<img src="screenshots/guides-daca.png" alt="Guides in a glyph, with points snapped to them" width="820">
</div>

**Building from shapes.** Some letters are quicker to build from pieces: a stem with the **Rectangle** (`F`), a bowl with the **Ellipse** (`F` again). Let them overlap and press **Remove overlap** (`Ctrl+Shift+O`): they become one outline, and the curves stay curves. The **Knife** (`E`) cuts a shape in two; with contours selected, **Union**, **Subtract** and **Intersect** combine them. **Add extremes** puts the points at the extremes for you, and **Tidy up** (`Ctrl+Shift+T`) removes the points that are not needed.

**Measure and compare.** The **Ruler** (`L`) shows the thickness of every stroke it crosses — a quick way to keep the stems equal. Before a big change, **Copy to background** (panel) keeps the old drawing behind the new one; **Swap with background** brings it back to the front. `Tab` goes from point to point, `Ctrl+Shift+A` puts the selected points on one line, and `Alt` + drag draws a lasso around points.

## 3. The rest of the alphabet

Do not draw every letter from nothing. Copy and adapt.

1. In the glyph you copy from, with nothing selected, **`Ctrl+C`** takes the whole drawing.
2. Open the glyph you copy to (`[` and `]` go to the previous and the next) and press **`Ctrl+V`**.
3. Change what needs changing.

| From | You get |
|---|---|
| `n` | `h`, `m`, `r` and the `u` (the `n` turned round: in the panel, under Transform, type 180 and click Rotate) |
| `o` | `c`, `e`; with a stem: `b`, `d`, `p`, `q` |
| `H` | `E`, `F`, `L`, `T`, `I` |
| `O` | `C`, `G`, `Q`, `D` |

To make a part larger or smaller, select its points and use the **scale box**.

After pasting or rotating, click **Correct direction** in the panel: it puts every contour the right way round at once.

## 4. Spacing

Spacing is set by reading, not by measuring. Open the **Proof** (`Ctrl+3`).

1. Type `nnnonnnoonoo`, then `HHHOHHHOOHOO`. The **Spacing** button has ready-made texts.
2. **Click a letter** in the text: its side bearings and width appear. Change them and watch the text follow.
3. Get `n` and `o` right first, until the rhythm is even. Then give each letter the side bearings of the shape it looks like: straight sides like `n`, round sides like `o`.

<div align="center">
<img src="screenshots/proof-daca.png" alt="The Proof, with the side bearings and kerning of the clicked letter" width="820">
</div>

**Spacing where you draw.** The same works in the **Glyph** view: type the word in its **Text** field, press `T` and put the cursor before a letter. `Alt + ← →` change its left side bearing, `Ctrl + ← →` its right one, `Ctrl+Alt + ← →` its kerning with the letter before; with `Shift`, 10 units at a time. `Esc` goes back to drawing that letter.

## 5. Accents

Accented letters are built, not drawn.

1. **Make the accents.** In the Font view, **New glyph**. Leave the character empty and type the name: `acute`, `grave`, `circumflex`, `tilde` and `cedilla`. Draw each one.
2. **Mark where they sit.** In each letter that takes an accent, in the panel, **Add anchor…** named `top`, just above the letter. In each accent, an anchor named `_top` below it. The app joins the `_top` of the accent to the `top` of the letter. For the cedilla, use `bottom` in the `c` and `_bottom` in the cedilla.
3. **Build.** In the actions menu of the Font view, **Add glyphs for a language…** and choose Portuguese (or another). The accented letters are built by themselves. What cannot be built is created empty, for you to draw.

Changed the `a`? `á`, `ã` and `â` change with it, because they use the `a` as a component.

## 6. Kerning

Kerning is for the pairs spacing cannot solve: `AV`, `To`, `LT`, `r.`. Do it **after** spacing.

1. In the **Kerning** view (`Ctrl+9`), make **groups** with **New group…**: letters that behave alike on one side share a group. For example, `O Q D` as the first glyph of the pair; `O C G Q` as the second. One pair made with the group serves them all.
2. In the **Proof**, **Kerning** button: click the second letter of a pair and change its **kerning** with the letter before it.

<div align="center">
<img src="screenshots/kerning-daca.png" alt="The Kerning view: groups for each side of the pair and the list of pairs" width="820">
</div>

A few well-chosen pairs are worth more than hundreds. If many pairs need fixing, the problem is in the spacing.

## 7. The Bold

A **master** is a style you draw. So far you have one: the Regular.

1. **Family** view (`Ctrl+5`) › **New master…**. Position **700**, name **Bold**.
2. The Bold starts as a **copy of the Regular** and becomes the master being edited. Two buttons appear in the side bar, Regular and Bold: that is where you switch from one to the other.
3. Open a letter and turn on **Other masters** in the toolbar: the Regular shows behind.
4. Make it heavier. **Move the points; do not add or remove any.** Select the points on one side of a stem and push them with the arrows; on curves, move the point and its handles follow.

<div align="center">
<img src="screenshots/weights-daca.png" alt="A glyph of the Bold with the Regular behind it, and the compatibility panel" width="820">
</div>

**Why the same points?** To calculate a weight in the middle, the app links each point of the Regular to the same point of the Bold. If one side has an extra point, it cannot. The panel shows, under **Master compatibility**, whether the glyph is right. If only the order went wrong, **Fix compatibility** puts it right without changing the shape.

If points are missing, **Add missing points** gives each master the points the other has, at the same place, without changing the shape. To see where they differ, turn on **Compatibility**: the points get numbers, a dashed line goes to the same point in the other master, and a red ring marks what has no match. **All masters** shows the letter in every master under the line, and **Preview** the word at any weight in between. Hold `Alt` while adding or removing a point to do it in every master.

In the Bold: stems of 80 become about 140; the inner spaces get smaller; the side bearings get a little smaller. Check the spacing and the kerning again in the Proof — each master has its own.

**The instances.** In the Family view, under **Between the masters**, drag the slider to **500** and click **Add this position as an instance…** (Medium). Do the same at **600** (SemiBold). They are not drawn: they are calculated again at every export, and they follow every change to the Regular and the Bold.

<div align="center">
<img src="screenshots/family-daca.png" alt="The Family view with the masters, the slider between them and every style in the same text" width="820">
</div>

## 8. The Italic

1. In the side bar, go back to the **Regular**.
2. Family view › **New italic from this master…**. Slant **10** degrees, name **Italic**.
3. The italic starts as the Regular **slanted** — an oblique, with the same points. The real work starts now.

**What to redraw**

- **The curves.** Slanting bends the round letters: the `o` gets a heavy side. Balance the points and handles again.
- **The shapes of an italic.** The one-storey `a`, a rounder `e`, an `f` that goes below the baseline, curved exits on `n`, `m`, `u`.
- **The width.** Italics are usually a little narrower. Select everything (`Ctrl+A`) and use the side handle of the scale box.
- **The spacing and the kerning**, again in the Proof.

Uprights and italics are two groups: instances are calculated inside each one only. With a single italic there are no italic instances. For a Bold Italic, repeat step 2 from the Bold.

## 9. Check

**Check** view (`Ctrl+6`).

- **Project guide**: what is done and what is missing.
- **The languages**, just below the guide: how much of each one the font already writes. **Add glyphs…** beside a language creates what is missing.
- **Problems**: each item takes you to the glyph. Fix the errors; read the warnings. Glyphs that cannot be interpolated are listed here.

<div align="center">
<img src="screenshots/check-daca.png" alt="The Check view: project guide, coverage and problems" width="820">
</div>

Check each master: switch in the side bar and look at the list again.

## 10. Export

1. **`Ctrl+E`** (or the **Export** button in the side bar).
2. Under **What**, choose **The whole family**. Tick **TrueType font (.ttf)** and **Web font (.woff2)**.
3. Choose where to create the folder.

<div align="center">
<img src="screenshots/export-daca.png" alt="The Export dialog" width="520">
</div>

You get a new folder with:

| Folder or file | What for |
|---|---|
| `ttf/` | To install on a computer: Regular, Italic, Medium, SemiBold, Bold |
| `woff2/` | To use on websites |
| `.css` | The `@font-face` rules, ready |

Install the fonts from `ttf/` and write a real text in another program. The bold and italic buttons should find the Bold and the Italic. Found a flaw? Go back to the project, fix it and export again: each export creates another folder and never writes over anything.

<div align="center">
<img src="screenshots/exported-family.png" alt="A family exported by LionFoundry, set in a text" width="640">
</div>

## What next?

- **Figures and punctuation**: the same path as the letters.
- **Ligatures**: create a glyph named `f_i` and the ligature works by itself (**Features** view).
- **Small caps and alternates**: glyphs named `a.sc` or `a.ss01` become features by their name.
- **Bold Italic**: an italic made from the Bold.

**What LionFoundry does not do for you yet:** it does not hint fonts (they are fine in print, on the web and on high-density screens; soft in small sizes on older Windows screens), does not export variable fonts, does not add the points that are missing between two masters, and does not save by itself. The full list is in the [README](../README.md#where-it-stands).
