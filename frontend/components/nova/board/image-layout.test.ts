import { describe, expect, it } from 'vitest';
import { visibleImageSteps, type ImageEntry } from './image-layout';
import type { Step } from './types';
import { layoutBoard } from './layout';

const overview: ImageEntry = {
  element: { id: 'overview', kind: 'media', media: 'image', image_role: 'primary' },
};

describe('background image placement', () => {
  it('places generated images on the left without moving the lesson vertically', () => {
    const steps: Step[] = [
      { id: 'first', elements: [{ id: 'explanation', kind: 'text', text: 'First concept' }] },
      { id: 'second', elements: [{ id: 'next', kind: 'text', text: 'Next concept' }] },
    ];
    const baseline = layoutBoard(steps, 2, 1, undefined, undefined, false, undefined, undefined, 1400);
    const visible = visibleImageSteps(steps, 2, [{ ...overview, after: 'explanation' }]);
    const withImage = layoutBoard(visible, visible.length, 1, undefined, undefined, false, undefined, undefined, 1400);
    const image = withImage.els.find((placed) => placed.el.id === 'overview')!;
    for (const original of baseline.els) {
      const placed = withImage.els.find((candidate) => candidate.el.id === original.el.id)!;
      expect(placed.y).toBe(original.y);
      expect(placed.w).toBe(original.w);
      expect(placed.h).toBe(original.h);
      expect(image.x + image.w).toBeLessThan(placed.x);
    }
    expect(withImage.steps.find((step) => step.step.id === 'image-overview')?.companionSlot).toBeUndefined();
  });

  it('keeps generated images stacked on narrow screens', () => {
    const visible = visibleImageSteps([{ id: 'lesson', elements: [{ id: 'text', kind: 'text', text: 'Lesson' }] }], 1, [overview]);
    for (const width of [390, 900]) {
      const layout = layoutBoard(visible, visible.length, 1, undefined, undefined, false, undefined, undefined, width);
      const image = layout.els.find((placed) => placed.el.id === 'overview')!;
      const text = layout.els.find((placed) => placed.el.id === 'text')!;
      expect(image.y).toBeGreaterThan(text.y + text.h);
    }
  });

  it('shows an early image without exposing planned lesson steps', () => {
    const planned: Step[] = [{ id: 'hidden', title: 'Quiz answer', elements: [] }];
    const visible = visibleImageSteps(planned, 0, [overview]);
    expect(visible.map((step) => step.id)).toEqual(['image-overview']);
    expect(planned.map((step) => step.id)).toEqual(['hidden']);
    expect(visibleImageSteps(planned, 1, [overview]).map((step) => step.id))
      .toEqual(['hidden', 'image-overview']);
  });

  it('places an image after its diagram while keeping future lesson content hidden', () => {
    const steps: Step[] = [
      { id: 'current', title: '', elements: [{ id: 'diagram', kind: 'text', text: 'Current concept' }] },
      { id: 'future', title: 'Next step', elements: [] },
    ];
    const visible = visibleImageSteps(steps, 1, [{ ...overview, after: 'diagram#node' }]);
    expect(visible.map((step) => step.id)).toEqual(['current', 'image-overview']);
    expect(steps).toHaveLength(2);
  });
});
