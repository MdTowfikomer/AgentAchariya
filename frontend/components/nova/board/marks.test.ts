import { describe, it, expect } from 'vitest';
import { bboxOf, shapeOf, hitTest, type Pt } from './marks';
import type { BoardLayout } from './layout';

describe('Marks hit testing and shape detection', () => {
  it('correctly detects bounding box of points', () => {
    const pts: Pt[] = [
      [10, 20],
      [100, 250],
      [5, 80],
    ];
    const box = bboxOf(pts);
    expect(box.x).toBe(5);
    expect(box.y).toBe(20);
    expect(box.w).toBe(95);
    expect(box.h).toBe(230);
  });

  it('classifies strokes into circle, underline, or scribble', () => {
    // Underline
    const underlinePts: Pt[] = [
      [10, 50],
      [80, 52],
    ];
    const underBox = bboxOf(underlinePts);
    expect(shapeOf(underlinePts, underBox)).toBe('underline');

    // Circle (starts and ends close together)
    const circlePts: Pt[] = [
      [50, 50],
      [100, 50],
      [100, 100],
      [50, 100],
      [52, 51],
    ];
    const circleBox = bboxOf(circlePts);
    expect(shapeOf(circlePts, circleBox)).toBe('circle');
  });

  it('hits targets on board layout', () => {
    const mockLayout: BoardLayout = {
      width: 800,
      height: 600,
      colW: 800,
      steps: [],
      els: [
        {
          el: { id: 'arr1', kind: 'array', values: ['10', '20', '30'] },
          step: 1,
          conceptId: 'step-1',
          order: 0,
          x: 100,
          y: 100,
          w: 240,
          h: 60,
          parts: {
            '0': { x: 0, y: 0, w: 80, h: 60 },
            '1': { x: 80, y: 0, w: 80, h: 60 },
            '2': { x: 160, y: 0, w: 80, h: 60 },
          },
          geom: { cellW: 80, cellH: 60, labelH: 0, top: 0 },
        },
      ],
    };

    // Circle around the second cell
    const box = { x: 175, y: 95, w: 90, h: 70 };
    const hits = hitTest(mockLayout, box, 'circle');
    expect(hits).toContain('arr1#1');
  });
});
