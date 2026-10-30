import { describe, expect, it } from 'vitest';
import { type DiagramGeom, layoutBoard } from './layout';
import { illustrationViewBox } from './layout';
import type { El } from './types';

const diagram: Extract<El, { kind: 'diagram' }> = {
  id: 'flow',
  kind: 'diagram',
  layout: 'flow',
  label: 'Finding the middle',
  nodes: [
    {
      id: 'low',
      label: 'Low pointer',
      description: 'Start of search space',
      bullets: ['Move right when needed'],
    },
    { id: 'high', label: 'High pointer', description: 'End of search space' },
    { id: 'mid', label: 'Mid = Low + (High − Low) / 2', description: 'The middle index' },
  ],
  edges: [
    { from: 'low', to: 'mid' },
    { from: 'high', to: 'mid' },
  ],
};

describe('Clean flowchart geometry', () => {
  it('keeps annotation cards out of connector paths at desktop and phone widths', () => {
    for (const width of [390, 1120]) {
      const layout = layoutBoard(
        [{ id: 's1', elements: [diagram] }],
        1,
        1,
        undefined,
        undefined,
        false,
        undefined,
        undefined,
        width
      );
      const flow = layout.els.find((el) => el.el.id === 'flow')!;
      const g = flow.geom as DiagramGeom;
      expect(g.cards).toBeUndefined();
      const a = g.boxes.low;
      const b = g.boxes.high;
      const c = g.boxes.mid;
      expect(a.x + a.w).toBeLessThanOrEqual(b.x);
      expect(Math.max(a.y + a.h, b.y + b.h) + 40).toBeLessThanOrEqual(c.y);
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(flow.w);
    }
  });

  it('centres a full-width saved illustration in the board', () => {
    const hero: El = {
      id: 'hero',
      kind: 'illustration',
      svg: '<svg viewBox="0 0 200 200"/>',
      placement: 'full',
      label: 'Binary search',
    };
    const layout = layoutBoard([{ id: 's1', elements: [hero] }], 1);
    const placed = layout.els[0];
    expect(placed.x + placed.w / 2).toBeCloseTo(layout.width / 2);
  });

  it('uses the actual SVG aspect ratio and origin for rendering and hit testing', () => {
    const hero: El = {
      id: 'hero',
      kind: 'illustration',
      svg: '<svg viewBox="10 20 400 280"/>',
      placement: 'full',
      parts: [{ id: 'part', label: 'Part', x: 10, y: 20, w: 100, h: 100 }],
    };
    const layout = layoutBoard([{ id: 's1', elements: [hero] }], 1);
    const placed = layout.els[0];
    expect(placed.parts.part.x).toBe(12);
    expect(placed.parts.part.y).toBe(8);
    expect(illustrationViewBox(hero.svg)).toEqual({ x: 10, y: 20, w: 400, h: 280 });
    expect(illustrationViewBox('<svg viewBox="0 0 0 0"/>').w).toBe(200);
  });
});
