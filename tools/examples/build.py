#!/usr/bin/env python3
# LionFoundry — Copyright (C) 2026 LionFoundry Team.
# Created and conceived by Daniel Michelon De Carli.
# Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
"""Builds the two example typefaces shipped with LionFoundry, as UFO 3 sources.

    python3 tools/examples/build.py            → examples/LionFoundryExampleSans.ufo           (two weights: Regular and Bold)
                                                 examples/LionFoundryExampleSerif-Regular.ufo

Both fonts come from the same parametric skeleton: every glyph is assembled from a few
primitives (stems, bars, diagonals, rings and arcs) that are merged with boolean operations.
The sans is monoline; the serif has contrast (thin horizontals, thick verticals) and hairline
serifs. They are deliberately basic: their job is to give the app something real to open,
with components, anchors, kerning groups and features.

The fonts themselves are released under the SIL Open Font License 1.1 (examples/OFL.txt).
Requires: fonttools, skia-pathops.
"""
import math
import os
import plistlib
import tempfile
from fontTools.misc.filenames import userNameToFileName
import shutil
import sys

from fontTools.pens.pointPen import SegmentToPointPen
from fontTools.pens.recordingPen import RecordingPointPen
from fontTools.pens.roundingPen import RoundingPen
from fontTools.ufoLib import UFOWriter
from pathops import Path, PathOp, op

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'examples')

UPM, CAP, XH, ASC, DESC = 1000, 700, 500, 740, -220
OV = 10          # overshoot of round shapes
K = 0.5522847498  # cubic approximation of a quarter circle


# ---------------------------------------------------------------- primitives
def poly(pts):
    p = Path()
    p.moveTo(*pts[0])
    for x, y in pts[1:]:
        p.lineTo(x, y)
    p.close()
    return p


def rect(x0, y0, x1, y1):
    return poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)])


def ellipse(cx, cy, rx, ry):
    p = Path()
    p.moveTo(cx + rx, cy)
    p.cubicTo(cx + rx, cy + ry * K, cx + rx * K, cy + ry, cx, cy + ry)
    p.cubicTo(cx - rx * K, cy + ry, cx - rx, cy + ry * K, cx - rx, cy)
    p.cubicTo(cx - rx, cy - ry * K, cx - rx * K, cy - ry, cx, cy - ry)
    p.cubicTo(cx + rx * K, cy - ry, cx + rx, cy - ry * K, cx + rx, cy)
    p.close()
    return p


def union(*paths):
    out = Path()
    for p in paths:
        if p is None:
            continue
        out = op(out, p, PathOp.UNION, fix_winding=True)
    return out


def minus(a, b):
    return op(a, b, PathOp.DIFFERENCE, fix_winding=True)


def inter(a, b):
    return op(a, b, PathOp.INTERSECTION, fix_winding=True)


def sector(cx, cy, a0, a1, r=4000):
    """Pie slice from angle a0 to a1 (degrees, counter-clockwise), used to cut arcs out of rings."""
    pts = [(cx, cy)]
    steps = max(2, int(abs(a1 - a0) / 10) + 1)
    for i in range(steps + 1):
        a = math.radians(a0 + (a1 - a0) * i / steps)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return poly(pts)


def moved(path, dx, dy=0):
    return path.transform(1, 0, 0, 1, dx, dy)


def flipped(path, cx, cy):
    """Rotates 180° around (cx, cy)."""
    return path.transform(-1, 0, 0, -1, 2 * cx, 2 * cy)


def mirrored(path, cx):
    return op(path.transform(-1, 0, 0, 1, 2 * cx, 0), Path(), PathOp.UNION, fix_winding=True)


# ---------------------------------------------------------------- style
class Style:
    def __init__(self, serif, bold=False):
        self.is_serif = serif
        self.is_bold = bold
        if serif:
            self.sv, self.sh = 96, 42        # thick verticals, thin horizontals
            self.dt, self.dn = 96, 42        # thick / thin diagonals
            self.sl, self.shs = 62, 34       # serif length and height
            self.sb = {'S': 34, 'R': 46, 'D': 14, 'O': 28}
        else:
            self.sv = self.sh = self.dt = self.dn = 84
            self.sl = self.shs = 0
            self.sb = {'S': 74, 'R': 44, 'D': 16, 'O': 30}
        if bold:                             # the second master of the sans: same skeleton, heavier strokes
            self.sv = self.dt = 132
            self.sh = 112                     # horizontals a little lighter, so that counters stay open
            self.dn = 132
            self.sb = {'S': 56, 'R': 34, 'D': 12, 'O': 24}
        self.dot = self.sv * 0.62

    # vertical stem; serifs: None | 'b' both | 'l' | 'r'
    def stem(self, x, y0, y1, bot='b', top='b', w=None):
        w = self.sv if w is None else w
        parts = [rect(x, y0, x + w, y1)]
        if self.is_serif:
            for side, y in ((bot, y0), (top, y1 - self.shs)):
                if not side:
                    continue
                l = self.sl if side in ('b', 'l') else 0
                r = self.sl if side in ('b', 'r') else 0
                parts.append(rect(x - l, y, x + w + r, y + self.shs))
        return union(*parts)

    def bar(self, x0, x1, y, t=None):
        return rect(x0, y, x1, y + (self.sh if t is None else t))

    def tick(self, x, y0, y1):
        """Small vertical serif at the end of a horizontal bar (serif style only)."""
        return rect(x - self.sh, y0, x, y1) if self.is_serif else None

    def diag(self, xa, ya, xb, yb, t, foot=None, head=None):
        """Diagonal stroke with horizontal cuts; (xa, ya) and (xb, yb) are the centres of its ends."""
        length = math.hypot(xb - xa, yb - ya)
        w = t * length / abs(yb - ya)
        parts = [poly([(xa - w / 2, ya), (xa + w / 2, ya), (xb + w / 2, yb), (xb - w / 2, yb)])]
        if self.is_serif:
            for on, x, y in ((foot, xa, ya), (head, xb, yb)):
                if not on:
                    continue
                y0 = y if y <= min(ya, yb) + 1 else y - self.shs
                parts.append(rect(x - w / 2 - self.sl * 0.8, y0, x + w / 2 + self.sl * 0.8, y0 + self.shs))
        return union(*parts)

    def ring(self, cx, cy, rx, ry, tx=None, ty=None):
        tx = self.sv if tx is None else tx
        ty = self.sh if ty is None else ty
        return minus(ellipse(cx, cy, rx, ry), ellipse(cx, cy, rx - tx, ry - ty))

    def arc(self, cx, cy, rx, ry, a0, a1, tx=None, ty=None):
        return inter(self.ring(cx, cy, rx, ry, tx, ty), sector(cx, cy, a0, a1))

    def disc(self, cx, cy, r=None):
        r = self.dot if r is None else r
        return ellipse(cx, cy, r, r)


def at(xa, ya, xb, yb, y):
    """x of the line (xa, ya)-(xb, yb) at height y."""
    return xa + (xb - xa) * (y - ya) / (yb - ya)


# ---------------------------------------------------------------- glyph definitions
# Each function returns (path, left side type, right side type, width).
# Side types: S straight, R round, D diagonal, O open — they pick the side bearings.
def glyphs(s):
    g = {}
    sv, sh, dt, dn = s.sv, s.sh, s.dt, s.dn
    H, X = CAP, XH

    def add(name, path, left='S', right='S'):
        g[name] = (path, left, right)

    def stack(h, share=0.47):
        """Radii of two stacked rounds (upper, lower) of total height h whose strokes overlap in the middle."""
        total = (h + sh - 2 * OV) / 2
        return total * share, total * (1 - share)

    def away(path):
        """Keeps a diagonal from poking out on the left of the stem it grows from."""
        return inter(path, rect(sv * .3, -400, 3000, 1400))

    # ---- capitals
    def cap_A():
        w = 620
        l = s.diag(dn * .6, 0, w / 2, H, dn, foot=True)
        r = s.diag(w - dt * .6, 0, w / 2, H, dt, foot=True)
        y = 215
        return union(l, r, s.bar(at(dn * .6, 0, w / 2, H, y), at(w - dt * .6, 0, w / 2, H, y), y))
    add('A', cap_A(), 'D', 'D')

    def bowl(x, y0, y1, xr, squeeze=0.92):
        ry = (y1 - y0) / 2
        rx = min(ry * squeeze, xr - x - sv * .4)
        cx = xr - rx
        return union(s.bar(x, cx + 1, y0), s.bar(x, cx + 1, y1 - sh), s.arc(cx, y0 + ry, rx, ry, -90, 90))

    mid = H / 2
    add('B', union(s.stem(0, 0, H, 'l', 'l'), bowl(sv - 2, mid - sh / 2, H, 440), bowl(sv - 2, 0, mid + sh / 2, 480)), 'S', 'R')
    add('D', union(s.stem(0, 0, H, 'l', 'l'), bowl(sv - 2, 0, H, 600, 0.86)), 'S', 'R')
    add('P', union(s.stem(0, 0, H, 'b', 'l'), bowl(sv - 2, mid - sh - 20, H, 460)), 'S', 'R')
    add('R', union(s.stem(0, 0, H, 'b', 'l'), bowl(sv - 2, mid - sh - 20, H, 460),
                   s.diag(520 - dt * .55, 0, 250, mid - 20, dt, foot=True)), 'S', 'D')

    def round_c(w, h, a0, a1, y0=0):
        return s.arc(w / 2, y0 + h / 2, w / 2, h / 2 + OV, a0, a1)
    add('C', round_c(640, H, 38, 322), 'R', 'O')
    cg = round_c(650, H, 38, 360)
    add('G', union(cg, s.bar(345, 650, mid - sh), rect(650 - sv, 110, 650, mid)), 'R', 'S')
    add('O', s.ring(340, mid, 340, mid + OV), 'R', 'R')
    add('Q', union(s.ring(340, mid, 340, mid + OV), s.diag(600, -70, 400, 190, dt * .8)), 'R', 'R')

    def cap_E(w, bars):
        parts = [s.stem(0, 0, H, 'l', 'l')]
        for y, x1 in bars:
            parts.append(s.bar(sv - 2, x1, y))
            if s.is_serif and x1 > 300:
                parts.append(rect(x1 - sh, y - (60 if y > 300 else 0), x1, y + sh + (60 if y < 300 else 0)))
        return union(*parts)
    add('E', cap_E(480, [(0, 480), (mid - sh / 2, 400), (H - sh, 470)]), 'S', 'O')
    add('F', cap_E(460, [(mid - sh / 2 - 20, 380), (H - sh, 460)]), 'S', 'O')
    add('H', union(s.stem(0, 0, H), s.stem(560 - sv, 0, H), s.bar(sv - 2, 562 - sv, mid - sh / 2)))
    add('I', s.stem(0, 0, H))
    add('J', union(s.stem(300 - sv, 150, H, None, 'b'), s.arc(150, 150, 150, 150 + OV, 180, 360)), 'R', 'S')
    add('K', union(s.stem(0, 0, H), away(s.diag(sv * .25, 215, 520, H, dn, head=True)),
                   away(s.diag(560 - dt * .55, 0, sv * .25, 470, dt, foot=True))), 'S', 'D')
    add('L', union(s.stem(0, 0, H, 'l', 'b'), s.bar(sv - 2, 440, 0),
                   rect(440 - sh, 0, 440, 110) if s.is_serif else None), 'S', 'O')
    add('M', union(s.stem(0, 0, H, 'b', 'l', dn if s.is_serif else sv), s.stem(720 - sv, 0, H, 'b', 'r'),
                   s.diag(dt * .55, H, 360, 60, dt), s.diag(720 - dn * .55 - (sv - dn), H, 360, 60, dn)))
    add('N', union(s.stem(0, 0, H, 'b', 'l', dn if s.is_serif else sv), s.stem(600 - (dn if s.is_serif else sv), 0, H, None, 'b', dn if s.is_serif else sv),
                   s.diag(dt * .55, H, 600 - dt * .55, 0, dt)))
    ru, rl = stack(H)
    add('S', union(s.arc(250, H - ru, 232, ru + OV, 32, 270), s.arc(250, rl, 250, rl + OV, -148, 90)), 'R', 'R')
    add('T', union(s.bar(0, 560, H - sh), s.stem(280 - sv / 2, 0, H),
                   rect(0, H - 110, sh, H) if s.is_serif else None, rect(560 - sh, H - 110, 560, H) if s.is_serif else None), 'O', 'O')
    add('U', union(s.stem(0, 250, H, None, 'b'), s.stem(580 - (dn if s.is_serif else sv), 250, H, None, 'b', dn if s.is_serif else sv),
                   s.arc(290, 250, 290, 250 + OV, 180, 360)), 'S', 'S')
    add('V', union(s.diag(310, 0, dt * .6, H, dt, head=True),
                   s.diag(310, 0, 620 - dn * .6, H, dn, head=True)), 'D', 'D')
    add('W', union(s.diag(230, 0, dt * .6, H, dt, head=True), s.diag(230, 0, 440, H, dn),
                   s.diag(650, 0, 440, H, dt), s.diag(650, 0, 880 - dn * .6, H, dn, head=True)), 'D', 'D')
    add('X', union(s.diag(dt * .6, 0, 580 - dt * .6, H, dn, foot=True, head=True),
                   s.diag(580 - dt * .6, 0, dt * .6, H, dt, foot=True, head=True)), 'D', 'D')
    add('Y', union(s.diag(290, 300, dt * .6, H, dt, head=True), s.diag(290, 300, 580 - dn * .6, H, dn, head=True),
                   s.stem(290 - sv / 2, 0, 320, 'b', None)), 'D', 'D')
    add('Z', union(s.bar(20, 540, H - sh), s.bar(0, 560, 0), s.diag(dt * .7, sh, 540 - dt * .7, H - sh, dt),
                   rect(20, H - 100, 20 + sh, H) if s.is_serif else None, rect(560 - sh, 0, 560, 100) if s.is_serif else None), 'O', 'O')

    # ---- lowercase
    xm = X / 2
    rb = 235  # bowl radius
    bowl_o = lambda cx: s.ring(cx, xm, rb, xm + OV)
    add('o', s.ring(250, xm, 250, xm + OV), 'R', 'R')
    add('a', union(bowl_o(rb), s.stem(2 * rb - sv, 0, X, 'r', None)), 'R', 'S')
    add('b', union(s.stem(0, 0, ASC, None, 'l'), bowl_o(rb)), 'S', 'R')
    add('d', union(bowl_o(rb), s.stem(2 * rb - sv, 0, ASC, 'r', 'l')), 'R', 'S')
    add('p', union(s.stem(0, DESC, X, 'b', 'l'), bowl_o(rb)), 'S', 'R')
    add('q', union(bowl_o(rb), s.stem(2 * rb - sv, DESC, X, 'b', None)), 'R', 'S')
    add('g', union(bowl_o(rb), s.stem(2 * rb - sv, -70, X, None, None), s.arc(rb, -70, rb, 150 + OV, 200, 360)), 'R', 'S')
    add('c', s.arc(240, xm, 240, xm + OV, 40, 320), 'R', 'O')
    add('e', union(s.arc(250, xm, 250, xm + OV, 0, 322), s.bar(sv * .5, 500 - sv * .5, xm - sh * .1)), 'R', 'R')

    def arch(x0, w, ytop, a0=0, a1=180, ry=190):
        return s.arc(x0 + w / 2, ytop - ry, w / 2, ry + OV, a0, a1)
    nw = 480
    add('n', union(s.stem(0, 0, X, 'b', 'l'), arch(0, nw, X), s.stem(nw - sv, 0, X - 188, 'b', None)))
    add('h', union(s.stem(0, 0, ASC, 'b', 'l'), arch(0, nw, X), s.stem(nw - sv, 0, X - 188, 'b', None)))
    add('m', union(s.stem(0, 0, X, 'b', 'l'), arch(0, 430, X), s.stem(430 - sv, 0, X - 188, 'b', None),
                   arch(430 - sv, 430, X), s.stem(860 - 2 * sv, 0, X - 188, 'b', None)))
    add('u', union(s.stem(0, 188, X, None, 'l'), s.arc(nw / 2, 190, nw / 2, 190 + OV, 180, 360), s.stem(nw - sv, 0, X, 'r', 'l')))
    add('r', union(s.stem(0, 0, X, 'b', 'l'), arch(0, 440, X, 38, 180)), 'S', 'O')
    add('dotlessi', s.stem(0, 0, X, 'b', 'l'))
    add('i', union(s.stem(0, 0, X, 'b', 'l'), s.disc(sv / 2, X + 150)))
    add('j', union(s.stem(140, -80, X, None, 'l'), s.arc(140 + sv - 150, -80, 150, 140 + OV, 270, 360),
                   s.disc(140 + sv / 2, X + 150)), 'O', 'S')
    add('l', s.stem(0, 0, ASC, 'b', 'l'))
    add('k', union(s.stem(0, 0, ASC, 'b', 'l'), away(s.diag(sv * .25, 135, 420, X, dn, head=True)),
                   away(s.diag(470 - dt * .55, 0, sv * .25, 355, dt, foot=True))), 'S', 'D')
    add('f', union(s.stem(90, 0, ASC - 150, 'b', None), s.arc(90 + 160, ASC - 150, 160, 150 + OV, 80, 180),
                   s.bar(0, 300, X - sh)), 'O', 'O')
    add('t', union(s.stem(90, 140, X + 150, None, None), s.arc(90 + 150, 140, 150, 140 + OV, 180, 285),
                   s.bar(0, 300, X - sh)), 'O', 'O')
    ru, rl = stack(X)
    add('s', union(s.arc(200, X - ru, 186, ru + OV, 30, 270, sv * .92), s.arc(200, rl, 200, rl + OV, -150, 90, sv * .92)), 'R', 'R')
    add('v', union(s.diag(250, 0, dt * .6, X, dt, head=True), s.diag(250, 0, 500 - dn * .6, X, dn, head=True)), 'D', 'D')
    add('w', union(s.diag(190, 0, dt * .6, X, dt, head=True), s.diag(190, 0, 370, X, dn),
                   s.diag(550, 0, 370, X, dt), s.diag(550, 0, 740 - dn * .6, X, dn, head=True)), 'D', 'D')
    add('x', union(s.diag(dt * .6, 0, 470 - dt * .6, X, dn, foot=True, head=True),
                   s.diag(470 - dt * .6, 0, dt * .6, X, dt, foot=True, head=True)), 'D', 'D')
    yx = at(500 - dn * .6, X, 150, DESC, 20)
    add('y', union(s.diag(yx, 20, dt * .6, X, dt, head=True), s.diag(150, DESC, 500 - dn * .6, X, dn, head=True)), 'D', 'D')
    add('z', union(s.bar(15, 420, X - sh), s.bar(0, 440, 0), s.diag(dt * .7, sh, 420 - dt * .7, X - sh, dt)), 'O', 'O')

    # ---- figures (tabular, 560 wide)
    add('zero', s.ring(250, mid, 250, mid + OV), 'R', 'R')
    add('one', union(s.stem(210, 0, H, 'b', None), s.diag(60, H - 190, 210 + dn * .5, H, dn)), 'D', 'S')
    p2 = (250 + (235 - sv / 2) * math.cos(math.radians(-30)), (H - 200) + (200 - sh / 2) * math.sin(math.radians(-30)))
    add('two', union(s.arc(250, H - 200, 235, 200 + OV, -30, 168), s.diag(dt * .7, sh, p2[0], p2[1], dt), s.bar(0, 500, 0),
                     rect(500 - sh, 0, 500, 100) if s.is_serif else None), 'O', 'O')
    ru, rl = stack(H)
    add('three', union(s.arc(240, H - ru, 215, ru + OV, -90, 150), s.arc(240, rl, 240, rl + OV, -150, 90)), 'R', 'R')
    add('four', union(s.stem(350, 0, H, 'b', None), s.bar(0, 520, 190), s.diag(dn * .7, 190 + sh, 350 + dn * .3, H, dn)), 'D', 'O')
    add('five', union(s.bar(80, 450, H - sh), rect(80, 360, 80 + (dn if s.is_serif else sv), H),
                      s.arc(240, 225, 245, 225 + OV, -150, 128)), 'R', 'R')
    six = union(s.ring(250, 220, 245, 220 + OV), s.arc(280, mid, 280, mid + OV, 55, 190))
    add('six', six, 'R', 'R')
    add('seven', union(s.bar(0, 500, H - sh), s.diag(190, 0, 500 - dt * .7, H - sh, dt),
                       rect(0, H - 100, sh, H) if s.is_serif else None), 'O', 'D')
    add('eight', union(s.ring(245, H - ru, 205, ru + OV), s.ring(245, rl, 245, rl + OV)), 'R', 'R')
    add('nine', flipped(six, 250, mid), 'R', 'R')

    # ---- punctuation
    d = s.dot
    add('period', s.disc(d, d), 'R', 'R')
    add('comma', union(s.disc(d, d), poly([(d * 2, d), (d * .8, -150), (d * .1, -150), (d, d * .3)])), 'R', 'R')
    add('colon', union(s.disc(d, d), s.disc(d, X - d)), 'R', 'R')
    add('semicolon', union(s.disc(d, X - d), s.disc(d, d), poly([(d * 2, d), (d * .8, -150), (d * .1, -150), (d, d * .3)])), 'R', 'R')
    add('exclam', union(rect(d - sv / 2, 230, d + sv / 2, H), s.disc(d, d)), 'R', 'R')
    add('question', union(s.arc(200, H - 180, 200, 180 + OV, -90, 165), rect(200 - sv * .45, 235, 200 + sv * .45, H - 360 + sh),
                          s.disc(200, d)), 'R', 'R')
    add('hyphen', rect(0, 235, 280, 235 + max(sh, 60)), 'O', 'O')
    add('underscore', rect(0, -130, 500, -80), 'O', 'O')
    add('quotesingle', rect(0, H - 250, sv * .8, H), 'O', 'O')
    add('quotedbl', union(rect(0, H - 250, sv * .8, H), rect(sv * 1.9, H - 250, sv * 2.7, H)), 'O', 'O')
    paren = inter(s.ring(430, 260, 430, 640, sv * .85, sv * .85), rect(-10, -190, 215, 730))
    add('parenleft', paren, 'R', 'O')
    add('parenright', mirrored(paren, 100), 'O', 'R')
    add('slash', s.diag(dn * .6, -120, 360, H + 40, max(dn, 60)), 'D', 'D')
    pt = max(sh, 60)
    add('plus', union(rect(0, 300 - pt / 2, 440, 300 + pt / 2), rect(220 - pt / 2, 80, 220 + pt / 2, 520)), 'O', 'O')
    add('equal', union(rect(0, 360, 440, 360 + pt), rect(0, 190, 440, 190 + pt)), 'O', 'O')

    # ---- marks (drawn for lowercase; the composites raise them for capitals)
    mt = max(sh, 58)
    add('acute', s.diag(20, X + 70, 170, X + 240, sv * .7), 'O', 'O')
    add('grave', s.diag(170, X + 70, 20, X + 240, sv * .7), 'O', 'O')
    add('circumflex', union(s.diag(mt * .6, X + 70, 150, X + 230, mt), s.diag(300 - mt * .6, X + 70, 150, X + 230, mt)), 'O', 'O')
    add('tilde', union(s.arc(95, X + 140, 95, 62, 0, 180, mt, mt), s.arc(285 - mt, X + 148, 95, 62, 180, 360, mt, mt)), 'O', 'O')
    add('dieresis', union(s.disc(d * .85, X + 150, d * .85), s.disc(d * .85 + 190, X + 150, d * .85)), 'O', 'O')
    add('cedilla', union(rect(70, -70, 70 + mt * .8, 10), s.arc(70, -110, 75, 62, -170, 80, mt * .9, mt * .9)), 'O', 'O')
    add('.notdef', minus(rect(0, 0, 500, H), rect(50, 50, 450, H - 50)), 'S', 'S')
    return g


UNICODES = {
    'space': 0x20, 'exclam': 0x21, 'quotedbl': 0x22, 'quotesingle': 0x27, 'parenleft': 0x28, 'parenright': 0x29,
    'plus': 0x2B, 'comma': 0x2C, 'hyphen': 0x2D, 'period': 0x2E, 'slash': 0x2F, 'colon': 0x3A, 'semicolon': 0x3B,
    'equal': 0x3D, 'question': 0x3F, 'underscore': 0x5F, 'grave': 0x60, 'dieresis': 0xA8, 'acute': 0xB4,
    'cedilla': 0xB8, 'dotlessi': 0x131, 'circumflex': 0x2C6, 'tilde': 0x2DC,
    'zero': 0x30, 'one': 0x31, 'two': 0x32, 'three': 0x33, 'four': 0x34, 'five': 0x35, 'six': 0x36, 'seven': 0x37,
    'eight': 0x38, 'nine': 0x39,
}
for c in 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz':
    UNICODES[c] = ord(c)

# name: (base, mark, unicode)
COMPOSITES = {
    'Aacute': ('A', 'acute', 0xC1), 'Agrave': ('A', 'grave', 0xC0), 'Acircumflex': ('A', 'circumflex', 0xC2),
    'Atilde': ('A', 'tilde', 0xC3), 'Ccedilla': ('C', 'cedilla', 0xC7), 'Eacute': ('E', 'acute', 0xC9),
    'Ecircumflex': ('E', 'circumflex', 0xCA), 'Iacute': ('I', 'acute', 0xCD), 'Ntilde': ('N', 'tilde', 0xD1),
    'Oacute': ('O', 'acute', 0xD3), 'Ocircumflex': ('O', 'circumflex', 0xD4), 'Otilde': ('O', 'tilde', 0xD5),
    'Uacute': ('U', 'acute', 0xDA), 'Udieresis': ('U', 'dieresis', 0xDC),
    'aacute': ('a', 'acute', 0xE1), 'agrave': ('a', 'grave', 0xE0), 'acircumflex': ('a', 'circumflex', 0xE2),
    'atilde': ('a', 'tilde', 0xE3), 'ccedilla': ('c', 'cedilla', 0xE7), 'eacute': ('e', 'acute', 0xE9),
    'ecircumflex': ('e', 'circumflex', 0xEA), 'iacute': ('dotlessi', 'acute', 0xED), 'ntilde': ('n', 'tilde', 0xF1),
    'oacute': ('o', 'acute', 0xF3), 'ocircumflex': ('o', 'circumflex', 0xF4), 'otilde': ('o', 'tilde', 0xF5),
    'uacute': ('u', 'acute', 0xFA), 'udieresis': ('u', 'dieresis', 0xFC),
}
ORDER = (['.notdef', 'space'] + list('ABCDEFGHIJKLMNOPQRSTUVWXYZ') + list('abcdefghijklmnopqrstuvwxyz') + ['dotlessi']
         + ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
         + ['period', 'comma', 'colon', 'semicolon', 'exclam', 'question', 'hyphen', 'underscore', 'quotesingle',
            'quotedbl', 'parenleft', 'parenright', 'slash', 'plus', 'equal']
         + ['acute', 'grave', 'circumflex', 'tilde', 'dieresis', 'cedilla'] + list(COMPOSITES))
FIGURES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']


class Glyph:
    def __init__(self):
        self.width = 0
        self.unicodes = []
        self.anchors = []
        self.lib = {}


def draw_clean(path, pen):
    """Draws a path into a point pen without what the boolean operations leave behind:
    slivers (contours with almost no area) and points repeated on the same spot."""
    rec = RecordingPointPen()
    path.draw(RoundingPen(SegmentToPointPen(rec)))
    contours, cur = [], None
    for method, args, kwargs in rec.value:
        if method == 'beginPath':
            cur = []
        elif method == 'addPoint':
            cur.append((args[0], args[1] if len(args) > 1 else kwargs.get('segmentType'), args[2] if len(args) > 2 else kwargs.get('smooth', False)))
        elif method == 'endPath':
            contours.append(cur)
    for points in contours:
        on = [pt for pt, kind, _ in points if kind is not None]
        area = abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(on, on[1:] + on[:1]))) / 2
        if area < 400:
            continue
        kept = []
        for pt, kind, smooth in points:
            # a line that goes nowhere: the same spot as the on-curve point just before it
            if kind == 'line' and kept and kept[-1][1] is not None and kept[-1][0] == pt:
                continue
            kept.append((pt, kind, smooth))
        if len(kept) > 1 and kept[0][1] == 'line' and kept[-1][1] is not None and kept[-1][0] == kept[0][0]:
            kept.pop(0)
        pen.beginPath()
        for pt, kind, smooth in kept:
            pen.addPoint(pt, kind, smooth)
        pen.endPath()


def build(serif, bold=False, out=None):
    s = Style(serif, bold)
    style = 'Bold' if bold else 'Regular'
    family = 'LionFoundry Example Serif' if serif else 'LionFoundry Example Sans'
    path = os.path.join(out or OUT, family.replace(' ', '') + '-' + style + '.ufo')
    if os.path.exists(path):
        shutil.rmtree(path)

    outlines, widths, anchors = {}, {'space': 250}, {}
    for name, (p, left, right) in glyphs(s).items():
        p.simplify(fix_winding=True, keep_starting_points=False, clockwise=False)
        x0, _, x1, _ = p.bounds
        lsb, rsb = s.sb[left], s.sb[right]
        if name in FIGURES:           # tabular figures: centred in a fixed width
            width = 580
            lsb = (width - (x1 - x0)) / 2
        elif name == '.notdef':
            width = x1 - x0 + 100
            lsb = 50
        else:
            width = x1 - x0 + lsb + rsb
        outlines[name] = moved(p, round(lsb - x0))
        widths[name] = round(width)
        bx0, _, bx1, _ = outlines[name].bounds
        cx = round((bx0 + bx1) / 2)
        if name in ('acute', 'grave', 'circumflex', 'tilde', 'dieresis'):
            anchors[name] = [{'name': '_top', 'x': cx, 'y': XH}]
        elif name == 'cedilla':
            anchors[name] = [{'name': '_bottom', 'x': cx, 'y': 0}]
        elif len(name) == 1 or name == 'dotlessi':
            top = CAP if name.isupper() else (ASC if name in 'bdfhkl' else XH)
            if name == 'i' or name == 'j':
                top = XH
            anchors[name] = [{'name': 'top', 'x': cx, 'y': top}, {'name': 'bottom', 'x': cx, 'y': 0}]

    w = UFOWriter(path, formatVersion=3, fileCreator='org.lionfoundry.examples')
    gs = w.getGlyphSet()

    def write(name, draw, width, unicodes, glyph_anchors):
        gl = Glyph()
        gl.width = width
        gl.unicodes = unicodes
        gl.anchors = glyph_anchors
        gs.writeGlyph(name, gl, draw, formatVersion=2)

    for name in ORDER:
        if name == 'space':
            write(name, lambda pen: None, widths[name], [0x20], [])
        elif name in COMPOSITES:
            base, mark, code = COMPOSITES[name]
            kind = '_bottom' if mark == 'cedilla' else '_top'
            b = next(a for a in anchors[base] if a['name'] == kind[1:])
            m = anchors[mark][0]
            dx, dy = b['x'] - m['x'], b['y'] - m['y']

            def draw(pen, base=base, mark=mark, dx=dx, dy=dy):
                pen.addComponent(base, (1, 0, 0, 1, 0, 0))
                pen.addComponent(mark, (1, 0, 0, 1, dx, dy))
            write(name, draw, widths[base], [code], [])
        else:
            def draw(pen, name=name):
                draw_clean(outlines[name], pen)
            write(name, draw, widths[name], [UNICODES[name]] if name in UNICODES else [], anchors.get(name, []))
    gs.writeContents()
    w.writeLayerContents(['public.default'])

    class Info:
        pass
    info = Info()
    info.familyName = family
    info.styleName = style
    info.openTypeOS2WeightClass = 700 if bold else 400
    info.styleMapFamilyName = family
    info.styleMapStyleName = 'bold' if bold else 'regular'
    info.versionMajor, info.versionMinor = 1, 0
    info.unitsPerEm = UPM
    info.ascender, info.descender, info.xHeight, info.capHeight = ASC, DESC, XH, CAP
    info.italicAngle = 0
    info.copyright = 'Copyright 2026 The LionFoundry Project Authors (https://github.com/danielcarli/lionfoundry)'
    info.openTypeNameDesigner = 'LionFoundry Team'
    info.openTypeNameLicense = 'This Font Software is licensed under the SIL Open Font License, Version 1.1. This license is available with a FAQ at: https://openfontlicense.org'
    info.openTypeNameLicenseURL = 'https://openfontlicense.org'
    info.openTypeNameDescription = ('Basic example typeface shipped with LionFoundry. Built by tools/examples/build.py from a parametric skeleton; '
                                    + ('contrast and hairline serifs.' if serif else 'monoline, no serifs.'))
    info.openTypeOS2TypoAscender, info.openTypeOS2TypoDescender, info.openTypeOS2TypoLineGap = 940, -260, 0
    info.openTypeHheaAscender, info.openTypeHheaDescender, info.openTypeHheaLineGap = 940, -260, 0
    info.openTypeOS2WinAscent, info.openTypeOS2WinDescent = 940, 260
    info.postscriptFontName = family.replace(' ', '') + '-' + style
    info.postscriptFullName = family + ' ' + style
    w.writeInfo(info)

    acc = lambda base: [base] + [n for n, (b, _, _) in COMPOSITES.items() if b == base]
    groups = {
        'public.kern1.A': acc('A'), 'public.kern2.A': acc('A'),
        'public.kern1.T': ['T'], 'public.kern2.T': ['T'],
        'public.kern1.V': ['V', 'W', 'Y'], 'public.kern2.V': ['V', 'W', 'Y'],
        'public.kern1.L': ['L'],
        'public.kern2.o': sorted(set(acc('o') + acc('c') + acc('e') + acc('a') + ['d', 'q', 'g'])),
        'public.kern1.o': sorted(set(acc('o') + acc('e') + ['b', 'p'])),
    }
    k = 0.8 if serif else 1
    kerning = {
        ('public.kern1.A', 'public.kern2.V'): round(-70 * k), ('public.kern1.V', 'public.kern2.A'): round(-70 * k),
        ('public.kern1.A', 'public.kern2.T'): round(-60 * k), ('public.kern1.T', 'public.kern2.A'): round(-60 * k),
        ('public.kern1.T', 'public.kern2.o'): round(-80 * k), ('public.kern1.V', 'public.kern2.o'): round(-45 * k),
        ('public.kern1.L', 'public.kern2.T'): round(-80 * k), ('public.kern1.L', 'public.kern2.V'): round(-70 * k),
        ('public.kern1.o', 'public.kern2.V'): round(-30 * k), ('public.kern1.o', 'public.kern2.T'): round(-60 * k),
        ('F', 'public.kern2.A'): round(-50 * k), ('P', 'public.kern2.A'): round(-60 * k),
        ('r', 'period'): -40, ('r', 'comma'): -40,
    }
    w.writeGroups(groups)
    w.writeKerning(kerning)
    w.writeFeatures('# ' + family + ' — OpenType features\n'
                    'languagesystem DFLT dflt;\nlanguagesystem latn dflt;\nlanguagesystem latn PTB;\n\n'
                    '# Kerning comes from kerning.plist and groups.plist: LionFoundry builds the kern feature from them\n'
                    '# (and mark from the anchors of combining accents) when the font is shown or exported.\n')
    w.writeLib({'public.glyphOrder': ORDER})
    w.close()
    print(f'{family} {style}: {len(ORDER)} glyphs → {os.path.relpath(path, ROOT)}')
    return path


def add_weight(project, other, name, location):
    """Puts the drawing and the kerning of another UFO into `project` as one more weight: a glyph layer,
    listed in the lib (see src/base/common/weights.js). The sans example has two weights in one project."""
    folder = userNameToFileName(name, prefix='glyphs.')   # the UFO convention for folder names
    shutil.copytree(os.path.join(other, 'glyphs'), os.path.join(project, folder))
    with open(os.path.join(project, 'layercontents.plist'), 'wb') as f:
        plistlib.dump([['public.default', 'glyphs'], [name, folder]], f)
    with open(os.path.join(other, 'kerning.plist'), 'rb') as f:
        kerning = plistlib.load(f)
    lib_path = os.path.join(project, 'lib.plist')
    with open(lib_path, 'rb') as f:
        lib = plistlib.load(f)
    lib['org.lionfoundry.weights'] = [{'id': 'regular', 'name': 'Regular', 'location': 400},
                                      {'id': name.lower(), 'name': name, 'location': location, 'layer': name, 'kerning': kerning}]
    # two styles that are not drawn but calculated between the weights when the family is exported
    lib['org.lionfoundry.instances'] = [{'name': 'Medium', 'location': 500}, {'name': 'SemiBold', 'location': 600}]
    with open(lib_path, 'wb') as f:
        plistlib.dump(lib, f, sort_keys=False)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    sans = build(False)
    with tempfile.TemporaryDirectory() as tmp:
        # the Bold is drawn from the same skeleton with heavier strokes, then kept inside the sans project
        add_weight(sans, build(False, bold=True, out=tmp), 'Bold', 700)
    # one project, two weights: the folder is named after the family alone
    project = os.path.join(OUT, 'LionFoundryExampleSans.ufo')
    for old in (project, os.path.join(OUT, 'LionFoundryExampleSans-Bold.ufo')):
        if os.path.exists(old):
            shutil.rmtree(old)
    os.rename(sans, project)
    build(True)
