import { describe, expect, it } from 'vitest';
import { clampRect, clampSize, nearestEdge } from './panelGeometry';

const screen = { x: 0, y: 0, w: 1000, h: 600 };

describe('nearestEdge', () => {
  it('snaps to the edge the pointer is next to', () => {
    expect(nearestEdge({ x: 10, y: 300 }, screen)).toBe('left');
    expect(nearestEdge({ x: 990, y: 300 }, screen)).toBe('right');
    expect(nearestEdge({ x: 500, y: 20 }, screen)).toBe('top');
    expect(nearestEdge({ x: 500, y: 590 }, screen)).toBe('bottom');
  });
  it('does not snap in the middle or just outside the threshold', () => {
    expect(nearestEdge({ x: 500, y: 300 }, screen)).toBeNull();
    expect(nearestEdge({ x: 57, y: 300 }, screen)).toBeNull();
    expect(nearestEdge({ x: 56, y: 300 }, screen)).toBe('left');
  });
  it('picks the nearer edge in a corner', () => {
    expect(nearestEdge({ x: 30, y: 10 }, screen)).toBe('top');
    expect(nearestEdge({ x: 10, y: 30 }, screen)).toBe('left');
  });
  it('respects bounds that do not start at the origin', () => {
    const b = { x: 100, y: 50, w: 800, h: 500 };
    expect(nearestEdge({ x: 110, y: 300 }, b)).toBe('left');
    expect(nearestEdge({ x: 50, y: 300 }, b)).toBe('left');
  });
});

describe('clampRect', () => {
  it('moves a rectangle back inside the bounds', () => {
    expect(clampRect({ x: -50, y: 580, w: 300, h: 200 }, screen)).toEqual({ x: 0, y: 400, w: 300, h: 200 });
    expect(clampRect({ x: 900, y: 10, w: 300, h: 200 }, screen)).toEqual({ x: 700, y: 10, w: 300, h: 200 });
  });
  it('shrinks one that is too big and grows one that is too small', () => {
    expect(clampRect({ x: 0, y: 0, w: 5000, h: 5000 }, screen)).toEqual({ x: 0, y: 0, w: 1000, h: 600 });
    expect(clampRect({ x: 0, y: 0, w: 10, h: 10 }, screen)).toEqual({ x: 0, y: 0, w: 200, h: 140 });
  });
});

describe('clampSize', () => {
  it('keeps a docked thickness between the minimum and 70% of the space', () => {
    expect(clampSize(50, 1000)).toBe(200);
    expect(clampSize(900, 1000)).toBe(700);
    expect(clampSize(400, 1000)).toBe(400);
  });
  it('never goes below the minimum even in a tiny window', () => {
    expect(clampSize(300, 100)).toBe(200);
  });
});
