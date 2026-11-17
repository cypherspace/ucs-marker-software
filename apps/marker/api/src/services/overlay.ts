import { z } from 'zod';

// A tracing-paper overlay (see OverlayData in packages/shared-types): drawn shapes laid over a candidate's answer.
// The limits keep a stored overlay small and stop a bad request filling the database.
const num = z.number().finite().min(-100000).max(100000);
const width = z.number().finite().min(0.5).max(200);

const PenShape = z.object({ type: z.literal('pen'), points: z.array(num).min(4).max(10000).refine((p) => p.length % 2 === 0, 'points come in pairs'), w: width });
const LineShape = z.object({ type: z.literal('line'), points: z.tuple([num, num, num, num]), w: width });
const CircleShape = z.object({ type: z.literal('circle'), x: num, y: num, r: z.number().finite().min(0.5).max(100000), w: width });
const TextShape = z.object({ type: z.literal('text'), x: num, y: num, text: z.string().trim().min(1).max(200), size: z.number().finite().min(4).max(400) });

export const OverlaySchema = z.object({
  width: z.number().finite().min(1).max(20000),
  height: z.number().finite().min(1).max(20000),
  shapes: z.array(z.discriminatedUnion('type', [PenShape, LineShape, CircleShape, TextShape])).min(1).max(2000),
});

export type OverlayInput = z.infer<typeof OverlaySchema>;
