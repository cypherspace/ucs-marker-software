"""Typeset a transcription as a plain page image.

The converted-handwriting view shows this image, and teachers annotate it, so the output must be
deterministic: a fixed width, a fixed font and a fixed layout. The API stores the PNG once and
never asks for it again for the same clip.
"""
from __future__ import annotations

import io
from functools import lru_cache

from PIL import Image, ImageDraw, ImageFont

PAGE_WIDTH = 1200
MARGIN = 60
FONT_SIZE = 30
LINE_HEIGHT = int(FONT_SIZE * 1.55)
MIN_HEIGHT = 500
MAX_HEIGHT = 20000

# DejaVu Sans covers the symbols that turn up in science answers (degrees, mu, Delta, superscripts,
# arrows). It is installed in the container; the others let the service run on a developer machine.
_FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "DejaVuSans.ttf",
    "C:/Windows/Fonts/segoeui.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
]


@lru_cache(maxsize=1)
def _font() -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in _FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, FONT_SIZE)
        except OSError:
            continue
    return ImageFont.load_default(FONT_SIZE)


def _wrap(paragraph: str, font, max_width: int) -> list[str]:
    """Break one paragraph into lines no wider than max_width, splitting over-long words."""
    if not paragraph.strip():
        return [""]
    lines: list[str] = []
    line = ""
    for word in paragraph.split(" "):
        candidate = word if not line else f"{line} {word}"
        if font.getlength(candidate) <= max_width:
            line = candidate
            continue
        if line:
            lines.append(line)
            line = ""
        # A single word wider than the page: break it by characters
        while font.getlength(word) > max_width:
            cut = len(word)
            while cut > 1 and font.getlength(word[:cut]) > max_width:
                cut -= 1
            lines.append(word[:cut])
            word = word[cut:]
        line = word
    lines.append(line)
    return lines


def render_text_page(text: str, width: int = PAGE_WIDTH) -> bytes:
    """Return a PNG of `text` on a white page, wrapped to `width`."""
    font = _font()
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n").replace("\t", "    ")
    blank = not text.strip()
    shown = "(nothing readable)" if blank else text

    lines: list[str] = []
    for paragraph in shown.split("\n"):
        lines.extend(_wrap(paragraph, font, width - 2 * MARGIN))

    height = min(MAX_HEIGHT, max(MIN_HEIGHT, 2 * MARGIN + len(lines) * LINE_HEIGHT))
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    colour = (120, 120, 120) if blank else (20, 20, 20)
    y = MARGIN
    for line in lines:
        if y + LINE_HEIGHT > height - MARGIN // 2:
            break
        draw.text((MARGIN, y), line, font=font, fill=colour)
        y += LINE_HEIGHT

    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()
