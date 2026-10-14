#!/usr/bin/env python3
"""Builds assets/fonts/web/Ionicons-subset.ttf: the Ionicons font cut down to
the icons this app uses, for the web build only.

Why: the full Ionicons font is about 390 KB (200 KB compressed) and every web
visitor downloaded it before the first icon showed, on the same slow
connection the earthquake list needs. The app uses about 140 of its 1,357
icons. iOS and Android keep the full font (it is on the device).

Which icons: every quoted string in src/ and app/ (tests excluded) that is an
Ionicons name, plus its "-outline"/"-sharp" variants and base name. Run this
again after adding an icon the font does not have yet; the Jest test
src/lib/__tests__/web-icon-font.test.ts says when.

Usage (needs fonttools; any virtualenv will do):

    pip install fonttools
    python3 scripts/build-web-icon-font.py

Ionicons is MIT licensed (node_modules/@expo/vector-icons, Ionic).
"""
import json
import pathlib
import re

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
VENDOR = ROOT / "node_modules" / "@expo" / "vector-icons" / "build" / "vendor" / "react-native-vector-icons"
SOURCE_FONT = VENDOR / "Fonts" / "Ionicons.ttf"
GLYPH_MAP = VENDOR / "glyphmaps" / "Ionicons.json"
OUT_DIR = ROOT / "assets" / "fonts" / "web"
OUT_FONT = OUT_DIR / "Ionicons-subset.ttf"
OUT_NAMES = OUT_DIR / "Ionicons-subset.json"

# Same pattern as the Jest test: a quoted lowercase name.
LITERAL = re.compile(r"""["'`]([a-z0-9-]+)["'`]""")


def used_names(glyph_map: dict) -> list:
    found = set()
    for folder in ("src", "app"):
        for path in (ROOT / folder).rglob("*"):
            if path.suffix not in (".ts", ".tsx") or "__tests__" in path.parts:
                continue
            for match in LITERAL.finditer(path.read_text(encoding="utf-8")):
                name = match.group(1)
                if name in glyph_map:
                    found.add(name)
    # Cheap insurance for names put together in code: the filled, outline
    # and sharp versions of every icon found.
    extra = set()
    for name in found:
        base = re.sub(r"-(outline|sharp)$", "", name)
        for variant in (base, base + "-outline", base + "-sharp"):
            if variant in glyph_map:
                extra.add(variant)
    return sorted(found | extra)


def main() -> None:
    glyph_map = json.loads(GLYPH_MAP.read_text(encoding="utf-8"))
    names = used_names(glyph_map)
    options = subset.Options()
    options.notdef_outline = True
    options.name_IDs = ["*"]
    options.glyph_names = False
    font = TTFont(str(SOURCE_FONT))
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=[glyph_map[name] for name in names])
    subsetter.subset(font)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    font.save(str(OUT_FONT))
    OUT_NAMES.write_text(json.dumps(names, indent=0) + "\n", encoding="utf-8")
    print(f"{len(names)} icons, {OUT_FONT.stat().st_size // 1024} KB -> {OUT_FONT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
