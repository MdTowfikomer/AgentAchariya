import type { BoardLayout } from './layout';
import type { Rect, StudentMark } from './types';

/**
 * Turning a student's scribble into "what they are pointing at".
 *
 * A circle means "this thing inside", an underline means "the thing just
 * above", anything else means "whatever this touches". Fine-grained parts
 * (a cell, a code line, a node) win over whole elements, because "line 3" is
 * a far better question than "the code".
 */

export type Pt = [number, number];

export function bboxOf(pts: Pt[]): Rect {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function shapeOf(pts: Pt[], box: Rect): StudentMark['shape'] {
  if (box.h < 26 && box.w > 30) return 'underline';
  // Closed if the stroke ends near where it started, relative to its size.
  const [sx, sy] = pts[0];
  const [ex, ey] = pts[pts.length - 1];
  const closeness = Math.hypot(ex - sx, ey - sy) / Math.max(20, Math.hypot(box.w, box.h));
  return closeness < 0.35 ? 'circle' : 'scribble';
}

type Hit = { target: string; rect: Rect; fine: boolean; el: string };

function allTargets(layout: BoardLayout): Hit[] {
  const out: Hit[] = [];
  for (const pe of layout.els) {
    out.push({
      target: pe.el.id,
      rect: { x: pe.x, y: pe.y, w: pe.w, h: pe.h },
      fine: false,
      el: pe.el.id,
    });
    for (const [sub, p] of Object.entries(pe.parts)) {
      out.push({
        target: `${pe.el.id}#${sub}`,
        rect: { x: pe.x + p.x, y: pe.y + p.y, w: p.w, h: p.h },
        fine: true,
        el: pe.el.id,
      });
    }
  }
  return out;
}

const inside = (px: number, py: number, r: Rect, pad = 0) =>
  px >= r.x - pad && px <= r.x + r.w + pad && py >= r.y - pad && py <= r.y + r.h + pad;

const overlapX = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));

const intersects = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export function hitTest(layout: BoardLayout, box: Rect, shape: StudentMark['shape']): string[] {
  const targets = allTargets(layout);
  let hits: Hit[] = [];

  if (shape === 'underline') {
    // The thing sitting on the line: bottom edge just above it, mostly overlapping.
    hits = targets.filter(
      (t) =>
        t.fine &&
        overlapX(t.rect, box) >= Math.min(t.rect.w, box.w) * 0.5 &&
        t.rect.y + t.rect.h >= box.y - 42 &&
        t.rect.y + t.rect.h <= box.y + box.h + 14
    );
    if (!hits.length)
      hits = targets.filter(
        (t) =>
          !t.fine &&
          overlapX(t.rect, box) > 0 &&
          t.rect.y + t.rect.h >= box.y - 42 &&
          t.rect.y <= box.y
      );
  } else {
    // Parts whose centre the mark encloses (circle) or touches (scribble).
    const pad = shape === 'circle' ? 8 : 0;
    hits = targets.filter(
      (t) => t.fine && inside(t.rect.x + t.rect.w / 2, t.rect.y + t.rect.h / 2, box, pad)
    );
    if (!hits.length) hits = targets.filter((t) => t.fine && intersects(t.rect, box));
    if (!hits.length) hits = targets.filter((t) => !t.fine && intersects(t.rect, box));
  }

  if (!hits.length) {
    // A mark in empty space near something still means that something.
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const near = targets
      .filter((t) => !t.fine)
      .map((t) => {
        const dx = Math.max(t.rect.x - cx, 0, cx - (t.rect.x + t.rect.w));
        const dy = Math.max(t.rect.y - cy, 0, cy - (t.rect.y + t.rect.h));
        return { t, d: Math.hypot(dx, dy) };
      })
      .filter((n) => n.d < 90)
      .sort((a, b) => a.d - b.d);
    if (near.length) hits = [near[0].t];
  }

  // Circling most of an element means the element, not six separate cells.
  const byEl = new Map<string, Hit[]>();
  for (const h of hits) byEl.set(h.el, [...(byEl.get(h.el) ?? []), h]);
  const out: string[] = [];
  for (const [el, hs] of byEl) {
    const fine = hs.filter((h) => h.fine);
    const pe = layout.els.find((e) => e.el.id === el);
    const partCount = pe ? Object.keys(pe.parts).length : 0;
    if (fine.length > 4 && fine.length >= partCount * 0.75) out.push(el);
    else if (fine.length) out.push(...fine.map((h) => h.target));
    else out.push(el);
  }
  return out.slice(0, 6);
}

/**
 * Render a region of the board to a JPEG, so Nova can see handwriting and
 * arrows the student drew — things no target address captures.
 */
export async function snapshotRegion(
  svg: SVGSVGElement,
  r: Rect,
  outW = 720,
  stepFilter?: number
): Promise<string | undefined> {
  try {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('viewBox', `${r.x} ${r.y} ${r.w} ${r.h}`);
    const outH = Math.round((outW * r.h) / r.w);
    clone.setAttribute('width', String(outW));
    clone.setAttribute('height', String(outH));
    clone.removeAttribute('style');
    clone.removeAttribute('class');
    clone.querySelectorAll('[data-snapshot-skip]').forEach((n) => n.remove());

    if (stepFilter !== undefined) {
      const stepStr = String(stepFilter);
      clone.querySelectorAll('[data-step]').forEach((n) => {
        if (n.getAttribute('data-step') !== stepStr) {
          n.remove();
        }
      });
    }

    // Ensure all WriteIn clip paths are fully open for clean capture
    clone.querySelectorAll('clipPath rect').forEach((cr) => {
      cr.setAttribute('width', '5000');
    });
    // Generated pictures live at blob: URLs, which an SVG rendered as an image
    // may not load. Inline their pixels, or the teacher would see an empty frame
    // exactly where the student circled.
    await Promise.all(
      Array.from(clone.querySelectorAll('image')).map(async (img) => {
        const href = img.getAttribute('href') ?? '';
        if (!href.startsWith('blob:')) return;
        const blob = await (await fetch(href)).blob();
        const dataUrl = await new Promise<string>((res) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result));
          fr.readAsDataURL(blob);
        });
        img.setAttribute('href', dataUrl);
      })
    );
    const xml = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('snapshot render failed'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#FBFAF6';
    ctx.fillRect(0, 0, outW, outH);
    ctx.drawImage(img, 0, 0, outW, outH);
    URL.revokeObjectURL(url);
    return canvas.toDataURL('image/jpeg', 0.8);
  } catch {
    return undefined; // the targets alone still carry the question
  }
}
