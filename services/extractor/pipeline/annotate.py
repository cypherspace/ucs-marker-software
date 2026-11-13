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


def annotate_pdf(
    pdf_path: Path,
    ops: list[dict[str, Any]],
    redact_zones: list[dict[str, Any]],
    cover_title: str | None,
    cover_lines: list[str],
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

        return doc.tobytes(garbage=3, deflate=True)
    finally:
        doc.close()
