/**
 * Hand-drawn strokes without a drawing library.
 *
 * Every line is drawn slightly off-true with a small overshoot, seeded from the
 * element id so a shape looks the same on every re-render instead of
 * shimmering. That wobble is most of what makes it read as a board, not a slide.
 */

function rng(seedText: string) {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) h = Math.imul(h ^ seedText.charCodeAt(i), 16777619);
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 10000) / 10000;
  };
}

const f = (n: number) => n.toFixed(1);

export function sketchLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  seed: string,
  wobble = 1.6
) {
  const r = rng(seed);
  const j = () => (r() - 0.5) * wobble * 2;
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ox = ((x2 - x1) / len) * 2.5; // overshoot past the ends, like a marker
  const oy = ((y2 - y1) / len) * 2.5;
  const mx = (x1 + x2) / 2 + j() * 1.5;
  const my = (y1 + y2) / 2 + j() * 1.5;
  return `M${f(x1 - ox + j())},${f(y1 - oy + j())} Q${f(mx)},${f(my)} ${f(x2 + ox + j())},${f(y2 + oy + j())}`;
}

export function sketchRect(x: number, y: number, w: number, h: number, seed: string) {
  return [
    sketchLine(x, y, x + w, y, seed + 't'),
    sketchLine(x + w, y, x + w, y + h, seed + 'r'),
    sketchLine(x + w, y + h, x, y + h, seed + 'b'),
    sketchLine(x, y + h, x, y, seed + 'l'),
  ].join(' ');
}

/** Rounded-ish box, for tree nodes and chain items. */
export function sketchPill(x: number, y: number, w: number, h: number, seed: string) {
  const r = rng(seed);
  const j = () => (r() - 0.5) * 2.4;
  const rad = Math.min(h / 2, 16);
  return (
    `M${f(x + rad + j())},${f(y + j())} L${f(x + w - rad + j())},${f(y + j())} ` +
    `Q${f(x + w + j())},${f(y + j())} ${f(x + w + j())},${f(y + h / 2 + j())} ` +
    `Q${f(x + w + j())},${f(y + h + j())} ${f(x + w - rad + j())},${f(y + h + j())} ` +
    `L${f(x + rad + j())},${f(y + h + j())} Q${f(x + j())},${f(y + h + j())} ${f(x + j())},${f(y + h / 2 + j())} ` +
    `Q${f(x + j())},${f(y + j())} ${f(x + rad + 3 + j())},${f(y - 1 + j())}`
  );
}

/** Loose ellipse drawn in one pass, overlapping at the end — a teacher's circle. */
export function sketchCircle(cx: number, cy: number, rx: number, ry: number, seed: string) {
  const r = rng(seed);
  const pts: string[] = [];
  const start = r() * Math.PI * 2;
  const turns = 1.12;
  const n = 28;
  for (let i = 0; i <= n; i++) {
    const t = start + (i / n) * Math.PI * 2 * turns;
    const k = 1 + (r() - 0.5) * 0.06;
    pts.push(`${f(cx + Math.cos(t) * rx * k)},${f(cy + Math.sin(t) * ry * k)}`);
  }
  return `M${pts[0]} L${pts.slice(1).join(' L')}`;
}

export function arrowHead(x: number, y: number, angle: number, size = 11) {
  const a1 = angle + Math.PI * 0.82;
  const a2 = angle - Math.PI * 0.82;
  return (
    `M${f(x + Math.cos(a1) * size)},${f(y + Math.sin(a1) * size)} L${f(x)},${f(y)} ` +
    `L${f(x + Math.cos(a2) * size)},${f(y + Math.sin(a2) * size)}`
  );
}

/** Smooth a freehand stroke through the midpoints of its samples. */
export function smoothPath(pts: [number, number][]) {
  if (pts.length === 0) return '';
  if (pts.length < 3) {
    const [a, b = a] = pts;
    return `M${f(a[0])},${f(a[1])} L${f(b[0] + 0.1)},${f(b[1] + 0.1)}`;
  }
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i];
    const [nx, ny] = pts[i + 1];
    d += ` Q${f(x)},${f(y)} ${f((x + nx) / 2)},${f((y + ny) / 2)}`;
  }
  const last = pts[pts.length - 1];
  return d + ` L${f(last[0])},${f(last[1])}`;
}
