"""Draw annotations onto a script PDF (vector shapes over the original scan)."""
from __future__ import annotations

from pathlib import Path
from typing import Any

import fitz  # PyMuPDF


def _rgb(hex_colour: str | None) -> tuple[float, float, float] | None:
    if not hex_colour:
        return None
    h = hex_colour.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))  # type: ignore[return-value]


def _latin1(text: str) -> str:
    # The built-in PDF fonts only cover Latin-1
    return "".join(c if (0x20 <= ord(c) <= 0x7E or 0xA0 <= ord(c) <= 0xFF) else "?" for c in text)


def _pt(page: fitz.Page, x: float, y: float) -> fitz.Point:
    """A point as seen on the page (what the clipper and the browser use) to the page's own, unrotated, coordinates."""
    return fitz.Point(x, y) * page.derotation_matrix


def _rect(page: fitz.Page, x0: float, y0: float, x1: float, y1: float) -> fitz.Rect:
    return (fitz.Rect(x0, y0, x1, y1) * page.derotation_matrix).normalize()


def _draw(page: fitz.Page, op: dict[str, Any]) -> None:
    kind = op.get("op")
    colour = _rgb(op.get("color"))
    if kind == "polyline":
        pts = op["points"]
        points = [_pt(page, pts[i], pts[i + 1]) for i in range(0, len(pts) - 1, 2)]
        if len(points) < 2:
            return
        dash = op.get("dash")
        page.draw_polyline(
            points, color=colour, width=op.get("width", 1), lineCap=1, lineJoin=1,
            dashes=f"[{' '.join(str(round(d, 2)) for d in dash)}] 0" if dash else None,
        )
    elif kind == "circle":
        page.draw_circle(
            _pt(page, op["x"], op["y"]), op["r"], color=colour, fill=_rgb(op.get("fill")), width=op.get("width", 1),
        )
    elif kind == "rect":
        page.draw_rect(
            _rect(page, op["x"], op["y"], op["x"] + op["w"], op["y"] + op["h"]),
            color=colour, fill=_rgb(op.get("fill")), width=op.get("width", 1),
        )
    elif kind == "text":
        page.insert_text(
            _pt(page, op["x"], op["y"]), _latin1(str(op.get("text", ""))), fontsize=op.get("size", 11),
            fontname="hebo" if op.get("bold") else "helv", color=colour or (0, 0, 0), rotate=page.rotation,
        )


# DejaVu Sans covers the symbols that turn up in science answers (degrees, mu, multiplication sign, arrows); the built-in
# PDF fonts only cover Latin-1. It is installed in the container; without it the text falls back to Latin-1.
_FONTS = {
    False: ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "DejaVuSans.ttf", "C:/Windows/Fonts/arial.ttf"],
    True: ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "DejaVuSans-Bold.ttf", "C:/Windows/Fonts/arialbd.ttf"],
}


def _font_file(bold: bool) -> str | None:
    for path in _FONTS[bold]:
        if Path(path).exists():
            return path
    return None


class _Text:
    """Writes wrapped text onto new pages of a document, starting a new page when one is full."""

    MARGIN = 56.0

    def __init__(self, doc: fitz.Document, width: float, height: float) -> None:
        self.doc, self.w, self.h = doc, width, height
        self.page: fitz.Page | None = None
        self.y = 0.0
        self.fonts = {b: _font_file(b) for b in (False, True)}
        self.measure = {b: (fitz.Font(fontfile=f) if f else fitz.Font("helv" if not b else "hebo")) for b, f in self.fonts.items()}

    def _fix(self, text: str, bold: bool) -> str:
        return text if self.fonts[bold] else _latin1(text)

    def _new_page(self) -> None:
        self.page = self.doc.new_page(width=self.w, height=self.h)
        self.y = self.MARGIN

    def _wrap(self, text: str, size: float, bold: bool) -> list[str]:
        font, width = self.measure[bold], self.w - 2 * self.MARGIN
        lines: list[str] = []
        for para in text.split("\n"):
            words, cur = para.split(" "), ""
            for word in words:
                trial = f"{cur} {word}" if cur else word
                if font.text_length(trial, fontsize=size) <= width or not cur:
                    cur = trial
                else:
                    lines.append(cur)
                    cur = word
            lines.append(cur)
        return lines

    def line(self, text: str, size: float = 11, bold: bool = False, gap: float = 0.0, colour: tuple[float, float, float] = (0.15, 0.15, 0.15)) -> None:
        text = self._fix(text, bold)
        leading = size * 1.35
        self.y += gap
        for piece in self._wrap(text, size, bold):
            if self.page is None or self.y + leading > self.h - self.MARGIN:
                self._new_page()
            kwargs: dict[str, Any] = {"fontsize": size, "color": colour}
            font_file = self.fonts[bold]
            if font_file:
                kwargs.update(fontname="djb" if bold else "dj", fontfile=font_file)
            else:
                kwargs.update(fontname="hebo" if bold else "helv")
            self.page.insert_text(fitz.Point(self.MARGIN, self.y + size), piece, **kwargs)
            self.y += leading


def _subset(doc: fitz.Document) -> None:
    """Keep only the glyphs used from the embedded font, so a text page does not carry the whole font (hundreds of KB)."""
    try:
        doc.subset_fonts()
    except Exception:  # an older PyMuPDF, or a font that cannot be subset: the file is just larger
        pass


def write_blocks(doc: fitz.Document, title: str, blocks: list[dict[str, Any]], width: float, height: float) -> None:
    """Add pages with a title and blocks of {heading, paragraphs: [{label, text}]}."""
    t = _Text(doc, width, height)
    t.line(title, size=18, bold=True, colour=(0.1, 0.1, 0.1))
    for block in blocks:
        t.line(str(block.get("heading", "")), size=13, bold=True, gap=14)
        for para in block.get("paragraphs", []):
            label = para.get("label")
            if label:
                t.line(str(label), size=10, bold=True, gap=6, colour=(0.35, 0.35, 0.35))
            t.line(str(para.get("text", "")), size=11)


def text_document(title: str, blocks: list[dict[str, Any]]) -> bytes:
    """A standalone A4 PDF of the same blocks (no source script)."""
    doc = fitz.open()
    try:
        a4 = fitz.paper_rect("a4")
        write_blocks(doc, title, blocks, a4.width, a4.height)
        if len(doc) == 0:
            doc.new_page(width=a4.width, height=a4.height)
        _subset(doc)
        return doc.tobytes(garbage=3, deflate=True)
    finally:
        doc.close()


def annotate_pdf(
    pdf_path: Path,
    ops: list[dict[str, Any]],
    redact_zones: list[dict[str, Any]],
    cover_title: str | None,
    cover_lines: list[str],
    appendix_title: str | None = None,
    appendix_blocks: list[dict[str, Any]] | None = None,
) -> bytes:
    doc = fitz.open(str(pdf_path))
    try:
        # Redact first, so what is drawn afterwards is never touched. Pixels under a zone are really removed.
        touched: set[int] = set()
        for z in redact_zones:
            n = int(z["page"]) - 1
            if 0 <= n < len(doc):
                doc[n].add_redact_annot(_rect(doc[n], z["x"], z["y"], z["x"] + z["width"], z["y"] + z["height"]), fill=(0, 0, 0))
                touched.add(n)
        for n in touched:
            doc[n].apply_redactions(images=fitz.PDF_REDACT_IMAGE_PIXELS)

        for op in ops:
            n = int(op["page"]) - 1
            if 0 <= n < len(doc):
                _draw(doc[n], op)

        if cover_title:
            first = doc[0].rect if len(doc) else fitz.paper_rect("a4")
            cover = doc.new_page(pno=0, width=first.width, height=first.height)
            y = 72.0
            cover.insert_text(fitz.Point(60, y), _latin1(cover_title), fontsize=20, fontname="hebo", color=(0.1, 0.1, 0.1))
            y += 34
            for line in cover_lines:
                if y > first.height - 60:
                    break
                bold = line.startswith("**")
                cover.insert_text(
                    fitz.Point(60, y), _latin1(line.lstrip("*")), fontsize=12 if bold else 11,
                    fontname="hebo" if bold else "helv", color=(0.15, 0.15, 0.15),
                )
                y += 18

        # Extra pages at the end (for example the AI's comments), the size of the script's first page
        if appendix_blocks:
            first = doc[0].rect if len(doc) else fitz.paper_rect("a4")
            write_blocks(doc, appendix_title or "", appendix_blocks, first.width, first.height)
            _subset(doc)

        return doc.tobytes(garbage=3, deflate=True)
    finally:
        doc.close()
