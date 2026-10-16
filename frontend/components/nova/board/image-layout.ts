import type { El, Step } from './types';

export type ImageEntry = {
  element: Extract<El, { kind: 'media' }>;
  after?: string;
};

/** Images arrive independently and must never reveal an upcoming lesson step. */
export function visibleImageSteps(steps: Step[], revealed: number, images: ImageEntry[]): Step[] {
  const visible = steps.slice(0, revealed);
  for (const image of images) {
    const anchor = image.after?.split('#')[0];
    const index = anchor
      ? visible.findIndex((step) => step.elements.some((element) => element.id === anchor))
      : -1;
    const parentConcept = index >= 0 ? visible[index].conceptId || visible[index].id : undefined;
    const parentSay = index >= 0 ? visible[index].say : undefined;
    const imageStep: Step = {
      id: `image-${image.element.id}`,
      title: '',
      elements: [image.element],
      conceptId: parentConcept || `image-${image.element.id}`,
      say: image.element.caption || (index >= 0 ? parentSay : undefined),
    };
    if (index >= 0) visible.splice(index + 1, 0, imageStep);
    else visible.push(imageStep);
  }
  return visible;
}
