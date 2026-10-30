import { describe, expect, it } from 'vitest';
import { layoutBoard, topicNote } from './layout';
import type { Step } from './types';

describe('roadmap topic notes', () => {
  const steps: Step[] = ['Input', 'Output'].map((label, i) => ({
    id: `step-${i}`,
    title: label,
    elements: [
      {
        id: `diagram-${i}`,
        kind: 'diagram',
        nodes: [{ id: 'n1', label, description: `${label} explanation` }],
        edges: [],
      },
    ],
  }));
  it('gives each diagram topic one summary before speech arrives', () => {
    const board = layoutBoard(steps, 2);
    expect(board.steps.every((step) => Boolean(step.companionSlot))).toBe(true);
    expect(topicNote(steps[0])).toBe('Input: Input explanation');
  });
  it('updates the same summary with live speech', () => {
    expect(topicNote(steps[0], 'Latest explanation')).toBe('Latest explanation');
  });
});
