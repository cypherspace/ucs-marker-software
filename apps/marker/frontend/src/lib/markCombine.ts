import type { MarkCombine } from '@marker/shared-types';

export const COMBINE_LABELS: Record<MarkCombine, string> = {
  latest: 'The latest teacher mark',
  average: 'The average of the teachers\' marks',
  lead: 'The lead teacher\'s mark (else the average)',
};

export const COMBINE_HELP: Record<MarkCombine, string> = {
  latest: 'Whoever marked a clip last decides. This is how marks have always been combined.',
  average: 'The mean of every teacher\'s mark for the clip, rounded half up (1 and 2 give 2).',
  lead: 'The lead teacher\'s own mark when they have marked the clip, otherwise the average.',
};

export const COMBINES = Object.keys(COMBINE_LABELS) as MarkCombine[];
