"""Clip individual question regions from student script PDFs.

Unlike the CAIE extractor (which auto-detects question boundaries), this
clipper uses pre-defined coordinate regions drawn by the lead teacher in the
CoordinatePicker admin UI. Name zones are blacked out before saving so
student identifiers never reach storage or AI services.
"""
from __future__ import annotations

import io
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF
from PIL import Image


# DPI used for rasterisation. 150 DPI is a good balance of quality vs. file size
# for handwritten scripts. Match this in the Node API if computing pixel coords.
RENDER_DPI = 150
_SCALE = RENDER_DPI / 72  # PDF user-space is 72 DPI


def _rect_from_coords(coords: dict) -> fitz.Rect:
    """Convert a ClipRegion dict (PDF user-space units) to a fitz.Rect."""
    x, y, w, h = coords["x"], coords["y"], coords["width"], coords["height"]
    return fitz.Rect(x, y, x + w, y + h)


def clip_question(
    pdf_path: Path,
    coords: list[dict],
    name_zones: list[dict],
    out_key: str,
) -> bytes:
    """Render and clip one question region from a student script PDF.

    Args:
        pdf_path: Local path to the student's scanned PDF.
        coords: List of ClipRegion dicts [{page, x, y, width, height}, ...].
                Multiple entries are stacked vertically (for multi-page questions).
        name_zones: Regions to black out before saving. These are blacked out
                    on the rendered image, not the original PDF.
        out_key: Storage key (unused here; returned for the caller to store).

    Returns:
        PNG image bytes of the clipped region.
    """
    doc = fitz.open(str(pdf_path))
    images: list[Image.Image] = []

    for region in coords:
        page_num = int(region["page"]) - 1  # 0-indexed
        if page_num < 0 or page_num >= len(doc):
            continue
        page = doc[page_num]

        clip_rect = _rect_from_coords(region)
        mat = fitz.Matrix(_SCALE, _SCALE)
        pix = page.get_pixmap(matrix=mat, clip=clip_rect, alpha=False)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

        # Black out name zones that overlap this clip region on this page
        for zone in name_zones:
            if int(zone["page"]) - 1 != page_num:
                continue
            zone_rect = _rect_from_coords(zone)
            # Compute intersection with clip_rect in PDF space
            isect = clip_rect & zone_rect
            if isect.is_empty:
                continue
            # Convert intersection to pixel offsets within the clip image
            px_x0 = int((isect.x0 - clip_rect.x0) * _SCALE)
            px_y0 = int((isect.y0 - clip_rect.y0) * _SCALE)
            px_x1 = int((isect.x1 - clip_rect.x0) * _SCALE)
            px_y1 = int((isect.y1 - clip_rect.y0) * _SCALE)
            # Fill with black
            from PIL import ImageDraw
            draw = ImageDraw.Draw(img)
            draw.rectangle([px_x0, px_y0, px_x1, px_y1], fill=(0, 0, 0))

        images.append(img)

    doc.close()

    if not images:
        # Return a small placeholder if no valid regions found
        img = Image.new("RGB", (200, 100), color=(240, 240, 240))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()

    # Stack multiple clip regions vertically
    total_height = sum(im.height for im in images)
    max_width = max(im.width for im in images)
    combined = Image.new("RGB", (max_width, total_height), color=(255, 255, 255))
    y_offset = 0
    for im in images:
        combined.paste(im, (0, y_offset))
        y_offset += im.height

    buf = io.BytesIO()
    combined.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def render_page(pdf_path: Path, page_number: int, max_width: int = 1200) -> bytes:
    """Render a single PDF page to PNG for the CoordinatePicker admin UI."""
    doc = fitz.open(str(pdf_path))
    if page_number < 1 or page_number > len(doc):
        raise ValueError(f"Page {page_number} out of range (doc has {len(doc)} pages)")
    page = doc[page_number - 1]
    scale = min(1.0, max_width / page.rect.width) * (_SCALE / 1.0)
    mat = fitz.Matrix(scale, scale)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    doc.close()
    return pix.tobytes("png")
