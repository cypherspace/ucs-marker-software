import type { MarkCombine } from './markCombine.js';

// Annotated script export: puts a teacher's ticks, crosses, notes and marks back onto the original script PDF.
//
// Annotations are stored in the pixels of the clip image (150 DPI). A clip is one or more regions of the script
// stacked vertically (see student_clipper.py), so an annotation maps back to a page and a position in PDF points
// (72 DPI) by finding the region it sits in. This file only does that geometry and the choice of which marks to draw;
// the drawing itself is done by the extractor from the list of operations built here.

export interface Region { page: number; x: number; y: number; width: number; height: number }

export type DrawOp =
  | { op: 'polyline'; page: number; points: number[]; color: string; width: number; dash?: number[] }
  | { op: 'circle'; page: number; x: number; y: number; r: number; color: string; width: number; fill?: string }
  | { op: 'text'; page: number; x: number; y: number; text: string; size: number; color: string; bold?: boolean }
  | { op: 'rect'; page: number; x: number; y: number; w: number; h: number; color: string; width: number; fill?: string };

export interface AnnotationLike {
  id?: string;
  type: string;
  layer?: string;
  x: number;
  y: number;
  color: string;
  number?: number;
  text?: string;
  points?: number[];
  radius?: number;
}

const DPI_RATIO = 72 / 150;
export const MARK_COLOR = '#4f46e5';

export interface StackedRegion { region: Region; top: number; bottom: number }

// Where each region sits in the stacked clip image (pixels at 150 DPI), as the extractor stacks them
export function stackRegions(regions: Region[]): StackedRegion[] {
  let top = 0;
  return regions.map((region) => {
    const height = Math.round(region.height / DPI_RATIO);
    const out = { region, top, bottom: top + height };
    top += height;
    return out;
  });
}

// A point in the clip image to a page and PDF points. A point outside every region (the white padding) goes to the nearest.
export function toPdfPoint(stack: StackedRegion[], x: number, y: number): { page: number; x: number; y: number } | null {
  if (stack.length === 0) return null;
  let hit = stack.find((s) => y >= s.top && y < s.bottom);
  if (!hit) hit = y < stack[0].top ? stack[0] : stack[stack.length - 1];
  return {
    page: hit.region.page,
    x: hit.region.x + x * DPI_RATIO,
    y: hit.region.y + (Math.min(Math.max(y, hit.top), hit.bottom) - hit.top) * DPI_RATIO,
  };
}

const px = (n: number) => n * DPI_RATIO;

// Shapes as the canvas draws them (AnnotationCanvas.tsx), in image pixels around (x, y)
function tickPoints(x: number, y: number, s = 20): number[] {
  return [x - s * 0.5, y, x - s * 0.1, y + s * 0.4, x + s * 0.5, y - s * 0.4];
}
function crossLines(x: number, y: number, size = 16): number[][] {
  const s = size / 2;
  return [[x - s, y - s, x + s, y + s], [x + s, y - s, x - s, y + s]];
}

function mapPoints(pts: number[], at: { page: number; x: number; y: number }, ax: number, ay: number): number[] {
  // Offsets are measured from the annotation's own anchor so a shape never straddles two regions
  const out: number[] = [];
  for (let i = 0; i < pts.length; i += 2) out.push(at.x + px(pts[i] - ax), at.y + px(pts[i + 1] - ay));
  return out;
}

// The drawing operations for one annotation. Annotations on the converted-handwriting page (layer 'text') are not
// on the script, so they are left out.
export function annotationOps(a: AnnotationLike, stack: StackedRegion[]): DrawOp[] {
  if (a.layer === 'text') return [];
  const at = toPdfPoint(stack, a.x, a.y);
  if (!at) return [];
  const page = at.page;
  const line = (points: number[], color: string, width: number, dash?: number[]): DrawOp =>
    ({ op: 'polyline', page, points, color, width: px(width), ...(dash ? { dash: dash.map(px) } : {}) });
  const label = (text: string): DrawOp =>
    ({ op: 'text', page, x: at.x + px(14), y: at.y - px(20) + px(12), text, size: px(12) * 1.4, color: a.color, bold: true });

  switch (a.type) {
    case 'mark_tick': {
      return [
        { op: 'circle', page, x: at.x, y: at.y, r: px(13), color: '#ffffff', width: px(2), fill: MARK_COLOR },
        line(mapPoints([a.x - 6, a.y, a.x - 2, a.y + 5, a.x + 7, a.y - 5], at, a.x, a.y), '#ffffff', 3),
        { op: 'text', page, x: at.x + px(15), y: at.y - px(9) + px(14), text: '+1', size: px(14) * 1.3, color: MARK_COLOR, bold: true },
      ];
    }
    case 'tick':
      return [line(mapPoints(tickPoints(a.x, a.y), at, a.x, a.y), a.color, 3)];
    case 'cross':
      return crossLines(a.x, a.y).map((l) => line(mapPoints(l, at, a.x, a.y), a.color, 3));
    case 'numbered_tick':
      return [line(mapPoints(tickPoints(a.x, a.y), at, a.x, a.y), a.color, 3), label(String(a.number ?? ''))];
    case 'numbered_cross':
      return [...crossLines(a.x, a.y).map((l) => line(mapPoints(l, at, a.x, a.y), a.color, 3)), label(String(a.number ?? ''))];
    case 'circle':
      return [{ op: 'circle', page, x: at.x, y: at.y, r: px(a.radius ?? 20), color: a.color, width: px(2.5) }];
    case 'underline':
    case 'ruler': {
      if (!a.points || a.points.length < 4) return [];
      const end = toPdfPoint(stack, a.points[2], a.points[3]);
      if (!end || end.page !== page) return [];
      return [line([at.x, at.y, end.x, end.y], a.color, a.type === 'ruler' ? 1.5 : 3, a.type === 'ruler' ? [6, 3] : undefined)];
    }
    case 'text':
      return a.text ? [{ op: 'text', page, x: at.x, y: at.y + px(14), text: a.text, size: px(14) * 1.3, color: a.color }] : [];
    default:
      return [];
  }
}

export interface MarkRow {
  marker_id: string | null;
  mark_source: string;
  status: string;
  marked_at: string | Date | null;
  annotation_data: unknown;
}

const time = (r: MarkRow) => (r.marked_at ? new Date(r.marked_at).getTime() : 0);

// Whose annotations go on the script: the ones belonging to the mark that counts. A moderated mark first, then (for
// the lead's mark) the lead teacher's own, otherwise the newest teacher's mark. `average` has no single mark, so it
// uses the lead's, else the newest.
export function pickAnnotationRow(rows: MarkRow[], combine: MarkCombine, leadTeacherId: string): MarkRow | null {
  const real = rows.filter((r) => r.status !== 'pending');
  const moderated = real.filter((r) => r.status === 'moderated').sort((a, b) => time(b) - time(a))[0];
  if (moderated) return moderated;
  const human = real.filter((r) => r.mark_source === 'human').sort((a, b) => time(b) - time(a));
  if (human.length === 0) return null;
  if (combine === 'latest') return human[0];
  return human.find((r) => r.marker_id === leadTeacherId) ?? human[0];
}

export function annotationsOf(row: MarkRow | null): AnnotationLike[] {
  const data = row?.annotation_data as { annotations?: unknown } | null | undefined;
  return data && Array.isArray(data.annotations) ? (data.annotations as AnnotationLike[]) : [];
}

// Latin-1 only: the PDF's built-in font cannot show other characters
export const pdfSafeText = (s: string): string => s.replace(/[^ -~ -ÿ]/g, '?');

// A small label beside the first region of an answer: "1(a)(i)  3 / 4", on a white box so it reads over the scan
export function markStamp(first: Region, label: string, text: string): DrawOp[] {
  const size = 11;
  const full = pdfSafeText(`${label}   ${text}`);
  const w = full.length * size * 0.56 + 8;
  const h = size + 6;
  const x = Math.max(4, first.x);
  const y = Math.max(2, first.y - h - 2);
  return [
    { op: 'rect', page: first.page, x, y, w, h, color: '#dc2626', width: 0.8, fill: '#ffffff' },
    { op: 'text', page: first.page, x: x + 4, y: y + size + 1, text: full, size, color: '#dc2626', bold: true },
  ];
}

export const safeFilePart = (s: string): string => s.replace(/[^\w .()-]+/g, '').trim().slice(0, 80) || 'script';
