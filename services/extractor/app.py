"""UCS Marker — PDF extractor service.

Endpoints:
  GET  /health          Liveness check
  POST /clip-scripts    Clip question regions from student script PDFs
  POST /ocr             Transcribe handwriting via Gemini Vision
  POST /render          Render a PDF page to PNG (for CoordinatePicker admin UI)
"""
from __future__ import annotations

import base64
import logging
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from pipeline.storage import storage
from pipeline.student_clipper import clip_question, render_page

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="marker-extractor", version="0.1.0")


# ---------------------------------------------------------------------------
# Request/response models
# ---------------------------------------------------------------------------

class ScriptInput(BaseModel):
    id: str
    student_number: str
    pdf_url: str


class QuestionInput(BaseModel):
    id: str
    clip_coordinates: list[dict[str, Any]]
    ms_clip_coordinates: list[dict[str, Any]] | None = None
    name_zones: list[dict[str, Any]] | None = None


class ClipScriptsRequest(BaseModel):
    scripts: list[ScriptInput]
    questions: list[QuestionInput]


class ClipResult(BaseModel):
    script_id: str
    question_id: str
    clip_image_url: str


class ClipScriptsResponse(BaseModel):
    clips: list[ClipResult]


class MsQuestionInput(BaseModel):
    id: str
    ms_clip_coordinates: list[dict[str, Any]] | None = None


class ClipMarkSchemeRequest(BaseModel):
    ms_pdf_url: str
    questions: list[MsQuestionInput]


class MsClipResult(BaseModel):
    question_id: str
    ms_clip_image_url: str


class ClipMarkSchemeResponse(BaseModel):
    clips: list[MsClipResult]


class OcrRequest(BaseModel):
    image_url: str


class OcrResponse(BaseModel):
    text: str


class RenderRequest(BaseModel):
    pdf_uri: str
    page_number: int
    max_width: int = 1200


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _localise(uri: str) -> Path:
    """Resolve a storage URI to a local path, downloading from GCS if needed."""
    return storage.localise_for_read(uri)


def _gemini_model_name() -> str:
    return os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")


def _gemini_client():
    from google import genai
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")
    return genai.Client(api_key=api_key)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok", "service": "marker-extractor", "version": "0.1.0"}


@app.post("/clip-scripts", response_model=ClipScriptsResponse)
def clip_scripts(req: ClipScriptsRequest):
    """Clip every question region from every student script PDF.

    For each script×question pair:
    1. Download/localise the PDF from storage.
    2. Call student_clipper.clip_question() which renders the clip and blacks
       out any name zones.
    3. Save the PNG to storage under a predictable key.
    4. Return the storage URI for each clip.
    """
    clips: list[ClipResult] = []

    for script in req.scripts:
        try:
            pdf_path = _localise(script.pdf_url)
        except Exception as exc:
            logger.error("Failed to localise PDF %s: %s", script.pdf_url, exc)
            raise HTTPException(status_code=422, detail=f"Cannot access PDF for script {script.id}: {exc}")

        for question in req.questions:
            coords = question.clip_coordinates
            if not coords:
                logger.warning("Question %s has no clip_coordinates — skipping", question.id)
                continue

            name_zones = question.name_zones or []

            try:
                png_bytes = clip_question(
                    pdf_path=pdf_path,
                    coords=coords,
                    name_zones=name_zones,
                    out_key=f"clips/{question.id}/{script.id}.png",
                )
            except Exception as exc:
                logger.error(
                    "clip_question failed script=%s question=%s: %s",
                    script.id, question.id, exc
                )
                raise HTTPException(
                    status_code=500,
                    detail=f"Clipping failed for script {script.id}, question {question.id}: {exc}",
                )

            key = f"clips/{question.id}/{script.id}.png"
            try:
                uri = storage.write(key, png_bytes)
            except Exception as exc:
                logger.error("Storage write failed key=%s: %s", key, exc)
                raise HTTPException(status_code=500, detail=f"Storage write failed: {exc}")

            clips.append(ClipResult(
                script_id=script.id,
                question_id=question.id,
                clip_image_url=uri,
            ))

    return ClipScriptsResponse(clips=clips)


@app.post("/clip-mark-scheme", response_model=ClipMarkSchemeResponse)
def clip_mark_scheme(req: ClipMarkSchemeRequest):
    """Clip each question's mark-scheme region from the exam's mark scheme PDF.

    One MS clip per question (not per script). No name zones — mark schemes
    contain no student identifiers.
    """
    try:
        pdf_path = _localise(req.ms_pdf_url)
    except Exception as exc:
        logger.error("Failed to localise mark scheme %s: %s", req.ms_pdf_url, exc)
        raise HTTPException(status_code=422, detail=f"Cannot access mark scheme PDF: {exc}")

    clips: list[MsClipResult] = []
    for question in req.questions:
        coords = question.ms_clip_coordinates
        if not coords:
            continue

        try:
            png_bytes = clip_question(
                pdf_path=pdf_path,
                coords=coords,
                name_zones=[],
                out_key=f"ms-clips/{question.id}.png",
            )
        except Exception as exc:
            logger.error("MS clip failed question=%s: %s", question.id, exc)
            raise HTTPException(status_code=500, detail=f"MS clipping failed for question {question.id}: {exc}")

        key = f"ms-clips/{question.id}.png"
        try:
            uri = storage.write(key, png_bytes)
        except Exception as exc:
            logger.error("Storage write failed key=%s: %s", key, exc)
            raise HTTPException(status_code=500, detail=f"Storage write failed: {exc}")

        clips.append(MsClipResult(question_id=question.id, ms_clip_image_url=uri))

    return ClipMarkSchemeResponse(clips=clips)


@app.post("/ocr", response_model=OcrResponse)
def ocr(req: OcrRequest):
    """Transcribe handwriting from a clip image using Gemini Vision."""
    try:
        image_path = _localise(req.image_url)
        image_bytes = image_path.read_bytes()
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Cannot access image: {exc}")

    try:
        client = _gemini_client()
        from google.genai import types
        prompt = (
            "You are a handwriting transcription assistant. "
            "Transcribe exactly what is written in the image. "
            "Preserve line breaks. Do not add commentary, corrections, or formatting. "
            "If the image is blank or illegible, return an empty string."
        )
        response = client.models.generate_content(
            model=_gemini_model_name(),
            contents=[
                prompt,
                types.Part.from_bytes(data=image_bytes, mime_type="image/png"),
            ],
        )
        text = response.text.strip() if response.text else ""
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Gemini OCR failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"OCR failed: {exc}")

    return OcrResponse(text=text)


@app.post("/render")
def render(req: RenderRequest):
    """Render a PDF page to PNG for the CoordinatePicker admin UI.

    Returns raw PNG bytes (Content-Type: image/png).
    """
    try:
        pdf_path = _localise(req.pdf_uri)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Cannot access PDF: {exc}")

    try:
        png_bytes = render_page(pdf_path, req.page_number, req.max_width)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.error("render_page failed uri=%s page=%d: %s", req.pdf_uri, req.page_number, exc)
        raise HTTPException(status_code=500, detail=f"Render failed: {exc}")

    return Response(content=png_bytes, media_type="image/png")
