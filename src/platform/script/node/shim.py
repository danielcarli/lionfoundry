# LionFoundry — Copyright (C) 2026 LionFoundry Team. Created and conceived by Daniel Michelon De Carli.
# Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
#
# Runs a Python script against the font the app sends as JSON, and sends the changed font back.
# The names follow fontParts where they can: font["A"], font.newGlyph(), glyph.width, glyph.leftMargin,
# glyph.moveBy((dx, dy)), font.kerning[("A", "V")] = -50 …
import io, json, math, sys, traceback, contextlib


def _point(t, x, y):
    return (t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5])


class Info(object):
    def __init__(self, data): object.__setattr__(self, "_d", data)
    def __getattr__(self, k): return self._d.get(k)
    def __setattr__(self, k, v): self._d[k] = v


class Kerning(object):
    def __init__(self, data): self._d = data
    def __getitem__(self, pair): return self._d.get(pair[0], {}).get(pair[1], 0)
    def __setitem__(self, pair, value):
        value = int(round(value))
        if value: self._d.setdefault(pair[0], {})[pair[1]] = value
        else: self.__delitem__(pair)
    def __delitem__(self, pair):
        row = self._d.get(pair[0])
        if row and pair[1] in row:
            del row[pair[1]]
            if not row: del self._d[pair[0]]
    def __contains__(self, pair): return pair[1] in self._d.get(pair[0], {})
    def keys(self): return [(l, r) for l, row in self._d.items() for r in row]
    def items(self): return [((l, r), v) for l, row in self._d.items() for r, v in row.items()]
    def __len__(self): return len(self.keys())
    def scaleBy(self, factor):
        for pair, v in self.items(): self[pair] = v * factor


class Glyph(object):
    def __init__(self, font, data): self._f = font; self._d = data
    name = property(lambda s: s._d["name"])
    contours = property(lambda s: s._d["contours"])
    components = property(lambda s: s._d["components"])
    anchors = property(lambda s: s._d["anchors"])
    @property
    def width(self): return self._d["width"]
    @width.setter
    def width(self, v): self._d["width"] = max(0, int(round(v)))
    @property
    def unicodes(self): return self._d["unicodes"]
    @unicodes.setter
    def unicodes(self, v): self._d["unicodes"] = [int(x) for x in v]
    @property
    def unicode(self): return self._d["unicodes"][0] if self._d["unicodes"] else None
    @unicode.setter
    def unicode(self, v): self._d["unicodes"] = [] if v is None else [int(v)]

    def _outline(self, t=(1, 0, 0, 1, 0, 0), depth=0):
        """Points along the outline (curves are sampled), components included."""
        out = []
        for c in self._d["contours"]:
            n = len(c)
            if not n: continue
            closed = c[0][2] != "move"
            start = next((i for i, p in enumerate(c) if p[2] != "offcurve"), 0)
            cur = c[start]; handles = []
            out.append(_point(t, cur[0], cur[1]))
            for k in range(1, n + 1 if closed else n - start):
                p = c[(start + k) % n]
                if p[2] == "offcurve": handles.append(p); continue
                pts = [cur] + handles + [p]
                if len(pts) > 2:
                    if p[2] == "qcurve" and len(handles) > 1:  # implied points between handles
                        seq = [cur]
                        for i, hnd in enumerate(handles):
                            seq.append(hnd)
                            seq.append(p if i == len(handles) - 1 else [(hnd[0] + handles[i + 1][0]) / 2.0, (hnd[1] + handles[i + 1][1]) / 2.0])
                        segs = [seq[i:i + 3] for i in range(0, len(seq) - 2, 2)]
                    else:
                        segs = [pts if len(pts) <= 4 else [pts[0], pts[1], pts[-2], pts[-1]]]
                    for sg in segs:
                        for i in range(1, 17):
                            u = i / 16.0; v = 1 - u
                            if len(sg) == 3: w = (v * v, 2 * v * u, u * u)
                            else: w = (v ** 3, 3 * v * v * u, 3 * v * u * u, u ** 3)
                            out.append(_point(t, sum(a * q[0] for a, q in zip(w, sg)), sum(a * q[1] for a, q in zip(w, sg))))
                else:
                    out.append(_point(t, p[0], p[1]))
                cur = p; handles = []
        if depth < 8:
            for comp in self._d["components"]:
                base = self._f._g.get(comp["base"])
                if base is None: continue
                m = comp["transform"]
                tt = (m[0] * t[0] + m[1] * t[2], m[0] * t[1] + m[1] * t[3], m[2] * t[0] + m[3] * t[2], m[2] * t[1] + m[3] * t[3],
                      m[4] * t[0] + m[5] * t[2] + t[4], m[4] * t[1] + m[5] * t[3] + t[5])
                out.extend(Glyph(self._f, base)._outline(tt, depth + 1))
        return out

    @property
    def bounds(self):
        pts = self._outline()
        if not pts: return None
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        return (min(xs), min(ys), max(xs), max(ys))
    box = bounds
    @property
    def leftMargin(self):
        b = self.bounds
        return None if b is None else b[0]
    @leftMargin.setter
    def leftMargin(self, v):
        b = self.bounds
        if b is None: return
        dx = int(round(v - b[0])); self.moveBy((dx, 0)); self.width = self.width + dx
    @property
    def rightMargin(self):
        b = self.bounds
        return None if b is None else self.width - b[2]
    @rightMargin.setter
    def rightMargin(self, v):
        b = self.bounds
        if b is not None: self.width = b[2] + v

    def transformBy(self, t):
        for c in self._d["contours"]:
            for p in c: p[0], p[1] = [int(round(v)) for v in _point(t, p[0], p[1])]
        for a in self._d["anchors"]: a["x"], a["y"] = [int(round(v)) for v in _point(t, a["x"], a["y"])]
        for comp in self._d["components"]:
            m = comp["transform"]; e, f = _point(t, m[4], m[5])
            comp["transform"] = [m[0] * t[0] + m[1] * t[2], m[0] * t[1] + m[1] * t[3], m[2] * t[0] + m[3] * t[2], m[2] * t[1] + m[3] * t[3], int(round(e)), int(round(f))]
        return self
    def moveBy(self, d): return self.transformBy((1, 0, 0, 1, d[0], d[1]))
    def scaleBy(self, s, origin=(0, 0)):
        sx, sy = (s, s) if isinstance(s, (int, float)) else s
        return self.transformBy((sx, 0, 0, sy, origin[0] - sx * origin[0], origin[1] - sy * origin[1]))
    def rotateBy(self, degrees, origin=(0, 0)):
        a = math.radians(degrees); c, s = math.cos(a), math.sin(a); x, y = origin
        return self.transformBy((c, s, -s, c, x - c * x + s * y, y - s * x - c * y))
    def skewBy(self, degrees): return self.transformBy((1, 0, math.tan(math.radians(degrees)), 1, 0, 0))
    def round(self):
        for c in self._d["contours"]:
            for p in c: p[0] = int(round(p[0])); p[1] = int(round(p[1]))
    def clear(self): self._d["contours"] = []; self._d["components"] = []; self._d["anchors"] = []
    def appendAnchor(self, name, position): self._d["anchors"].append({"name": name, "x": int(round(position[0])), "y": int(round(position[1]))})
    def removeAnchor(self, name): self._d["anchors"] = [a for a in self._d["anchors"] if a["name"] != name]
    def appendComponent(self, base, offset=(0, 0)): self._d["components"].append({"base": base, "transform": [1, 0, 0, 1, int(round(offset[0])), int(round(offset[1]))]})
    @property
    def guidelines(self): return self._d.setdefault("guidelines", [])
    def appendGuideline(self, position, angle=0, name=None):
        """A reference line through a position: angle 0 is horizontal, 90 vertical, anything else diagonal."""
        a = angle % 180
        line = {"y": int(round(position[1]))} if a == 0 else {"x": int(round(position[0]))} if a == 90 else {"x": int(round(position[0])), "y": int(round(position[1])), "angle": a}
        if name: line["name"] = name
        self.guidelines.append(line)
    def appendContour(self, points): self._d["contours"].append([[p[0], p[1], p[2] if len(p) > 2 else "line"] for p in points])
    def __repr__(self): return "<Glyph %s>" % self.name


class Font(object):
    def __init__(self, data, selection):
        self._d = data; self._g = data["glyphs"]
        self.info = Info(data["info"]); self.kerning = Kerning(data["kerning"]); self.groups = data["groups"]
        self.lib = data.setdefault("lib", {}); self.selection = [n for n in selection if n in self._g]
    @property
    def features(self): return self._d.get("features", "")
    @features.setter
    def features(self, text): self._d["features"] = str(text)
    @property
    def glyphOrder(self): return list(self._d["glyphOrder"])
    def keys(self): return list(self._d["glyphOrder"])
    def __contains__(self, name): return name in self._g
    def __getitem__(self, name): return Glyph(self, self._g[name])
    def __iter__(self): return iter([Glyph(self, self._g[n]) for n in self._d["glyphOrder"]])
    def __len__(self): return len(self._d["glyphOrder"])
    @property
    def selectedGlyphs(self): return [self[n] for n in self.selection]
    def newGlyph(self, name, unicodes=(), width=600):
        if name not in self._g:
            self._g[name] = {"name": name, "width": width, "unicodes": list(unicodes), "contours": [], "components": [], "anchors": []}
            self._d["glyphOrder"].append(name)
        return self[name]
    def removeGlyph(self, name):
        if name not in self._g: return
        del self._g[name]; self._d["glyphOrder"].remove(name)
        for g in self._g.values(): g["components"] = [c for c in g["components"] if c["base"] != name]
        for k, members in list(self.groups.items()):
            if isinstance(members, list): self.groups[k] = [m for m in members if m != name]
        self._d["kerning"].pop(name, None)
        for row in self._d["kerning"].values(): row.pop(name, None)


def main():
    request = json.load(sys.stdin)
    font = Font(request["font"], request.get("selection", []))
    out = io.StringIO(); error = None
    with contextlib.redirect_stdout(out):
        try:
            exec(compile(request["code"], "<script>", "exec"), {"font": font, "CurrentFont": lambda: font, "__name__": "__main__"})
        except Exception:
            error = traceback.format_exc(limit=-1)
    json.dump({"font": request["font"], "output": out.getvalue()[:200000], "error": error}, sys.__stdout__)


if __name__ == "__main__":
    main()
