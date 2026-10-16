import { describe, expect, it } from 'vitest';
import { visibleImageSteps, type ImageEntry } from './image-layout';
import type { Step } from './types';

const overview: ImageEntry = {
  element: { id: 'overview', kind: 'media', media: 'image', image_role: 'primary' },
};

describe('background image placement', () => {
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
