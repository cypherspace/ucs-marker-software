import { describe, expect, it } from 'vitest';
import { annotationOps, annotationsOf, markStamp, pickAnnotationRow, stackRegions, toPdfPoint, type MarkRow } from './scriptExport.js';

const r = (page: number, y: number, height: number, x = 50, width = 400) => ({ page, x, y, width, height });
const K = 72 / 150;

describe('stackRegions / toPdfPoint', () => {
  it('maps a point in a single region to PDF points', () => {
    const stack = stackRegions([r(2, 100, 300)]);
    const p = toPdfPoint(stack, 150, 250)!;
    expect(p.page).toBe(2);
    expect(p.x).toBeCloseTo(50 + 150 * K);
    expect(p.y).toBeCloseTo(100 + 250 * K);
  });

  it('finds the second region of a stacked clip and measures from its own top', () => {
    const stack = stackRegions([r(1, 600, 100), r(2, 40, 200)]); // 100pt = 208px high
    const firstHeightPx = Math.round(100 / K);
    const p = toPdfPoint(stack, 0, firstHeightPx + 100)!;
    expect(p.page).toBe(2);
    expect(p.y).toBeCloseTo(40 + 100 * K);
  });

  it('puts a point outside every region on the nearest one', () => {
    const stack = stackRegions([r(1, 100, 100)]);
    expect(toPdfPoint(stack, 10, 99999)!.page).toBe(1);
    expect(toPdfPoint(stack, 10, -50)!.y).toBeCloseTo(100);
    expect(toPdfPoint([], 1, 1)).toBeNull();
  });
});

describe('annotationOps', () => {
  const stack = stackRegions([r(3, 100, 300)]);
  const base = { x: 100, y: 100, color: '#16a34a' };

  it('draws a tick as one polyline anchored at the annotation', () => {
    const ops = annotationOps({ type: 'tick', ...base }, stack);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: 'polyline', page: 3, color: '#16a34a' });
  });

  it('draws a cross as two lines', () => {
    expect(annotationOps({ type: 'cross', ...base }, stack)).toHaveLength(2);
  });

  it('draws a mark tick as a filled circle, a white tick and +1', () => {
    const ops = annotationOps({ type: 'mark_tick', ...base }, stack);
    expect(ops.map((o) => o.op)).toEqual(['circle', 'polyline', 'text']);
  });

  it('draws numbered ticks with their number', () => {
    const ops = annotationOps({ type: 'numbered_tick', number: 3, ...base }, stack);
    expect(ops.find((o) => o.op === 'text')).toMatchObject({ text: '3' });
  });

  it('scales a circle radius to points', () => {
    const ops = annotationOps({ type: 'circle', radius: 50, ...base }, stack);
    expect(ops[0]).toMatchObject({ op: 'circle', r: 50 * K });
  });

  it('draws a ruler dashed and an underline solid', () => {
    const pts = [100, 100, 200, 100];
    const ruler = annotationOps({ type: 'ruler', points: pts, ...base }, stack)[0];
    const under = annotationOps({ type: 'underline', points: pts, ...base }, stack)[0];
    expect(ruler).toMatchObject({ op: 'polyline', dash: expect.any(Array) });
    expect((under as { dash?: number[] }).dash).toBeUndefined();
  });

  it('leaves out notes on the converted-handwriting page and unknown types', () => {
    expect(annotationOps({ type: 'tick', layer: 'text', ...base }, stack)).toEqual([]);
    expect(annotationOps({ type: 'mystery', ...base }, stack)).toEqual([]);
  });

  it('draws a text note', () => {
    expect(annotationOps({ type: 'text', text: 'Good', ...base }, stack)[0]).toMatchObject({ op: 'text', text: 'Good' });
    expect(annotationOps({ type: 'text', ...base }, stack)).toEqual([]);
  });
});

describe('pickAnnotationRow', () => {
  const row = (marker: string | null, status: string, at: number, source = 'human'): MarkRow => ({
    marker_id: marker, mark_source: source, status, marked_at: new Date(at).toISOString(), annotation_data: { annotations: [{ id: marker ?? 'ai' }] },
  });
  const rows = [row('a', 'marked', 1000), row('lead', 'marked', 500), row(null, 'marked', 2000, 'ai')];

  it('latest: the newest teacher mark', () => expect(pickAnnotationRow(rows, 'latest', 'lead')?.marker_id).toBe('a'));
  it('lead / average: the lead teacher, else the newest', () => {
    expect(pickAnnotationRow(rows, 'lead', 'lead')?.marker_id).toBe('lead');
    expect(pickAnnotationRow(rows, 'average', 'lead')?.marker_id).toBe('lead');
    expect(pickAnnotationRow([row('a', 'marked', 1)], 'lead', 'lead')?.marker_id).toBe('a');
  });
  it('a moderated mark wins over everything', () => {
    expect(pickAnnotationRow([...rows, row('mod', 'moderated', 1)], 'latest', 'lead')?.marker_id).toBe('mod');
  });
  it('ignores drafts and the AI', () => {
    expect(pickAnnotationRow([row('a', 'pending', 1), row(null, 'marked', 2, 'ai')], 'latest', 'lead')).toBeNull();
  });
  it('annotationsOf copes with missing data', () => {
    expect(annotationsOf(null)).toEqual([]);
    expect(annotationsOf({ ...rows[0], annotation_data: null })).toEqual([]);
    expect(annotationsOf(rows[0])).toHaveLength(1);
  });
});

describe('markStamp', () => {
  it('is a box and a label above the region, kept on the page', () => {
    const ops = markStamp({ page: 2, x: 30, y: 5, width: 300, height: 100 }, '1(a)(i)', '3 / 4');
    expect(ops.map((o) => o.op)).toEqual(['rect', 'text']);
    expect(ops[0]).toMatchObject({ page: 2, x: 30 });
    expect((ops[0] as { y: number }).y).toBeGreaterThanOrEqual(2);
  });
});
