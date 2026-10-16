import type { El, Rect, Step, TreeNode } from './types';
import type { CheckpointEntry } from './board-state';

/**
 * Board layout. Pure geometry, so the renderer, Nova's highlights and the
 * student's hit-testing all agree on where everything is.
 *
 * Steps flow into columns like a real whiteboard: each new step goes into the
 * shortest column. Text widths are estimated from character counts — exact
 * measurement would need a render pass per element, and a few pixels of slack
 * is invisible on a hand-drawn board.
 */

// Plain family names only: SVG presentation attributes cannot read CSS
// variables. The live board gets the real next/font faces from the
// `.nova-board` rules in globals.css; these attributes are what survives into
// the JPEG snapshot sent to Nova, where page CSS does not apply.
export const HAND = '"Kalam", "Comic Sans MS", cursive';
export const MONO = 'Consolas, ui-monospace, monospace';

const HAND_W = 0.5; // average glyph width / font size, handwriting face
const MONO_W = 0.6;

export const TITLE_FS = 27;
const TITLE_H = 42;
const EL_GAP = 14;
const STEP_PAD_BOTTOM = 16;
const LABEL_H = 24;

export type TextGeom = { lines: string[]; fs: number; lh: number };
export type CodeGeom = { fs: number; lh: number; pad: number; labelH: number };
export type CellGeom = { cellW: number; cellH: number; labelH: number; top: number };
export type ChainGeom = {
  boxes: Rect[];
  vertical: boolean;
  arrows: boolean;
  labelH: number;
  fs: number;
};
export type TreeGeom = {
  nodes: { node: TreeNode; x: number; y: number; w: number; h: number }[];
  edges: { from: string; to: string }[];
  labelH: number;
  fs: number;
};
export type TableGeom = {
  colW: number[];
  rowH: number;
  labelH: number;
  fs: number;
  headers: boolean;
};

export type PlacedEl = {
  el: El;
  step: number; // 1-based step index, 0 for loose improvisation
  conceptId: string; // Stable concept ID
  order: number; // position within its step, for the write-in stagger
  x: number;
  y: number;
  w: number;
  h: number;
  /** Sub-target rects keyed by the part after '#', in board coordinates. */
  parts: Record<string, Rect>;
  geom:
    | TextGeom
    | CodeGeom
    | CellGeom
    | ChainGeom
    | TreeGeom
    | TableGeom
    | ListGeom
    | MediaGeom
    | IllustrationGeom
    | DiagramGeom;
};

export type PlacedStep = {
  index: number;
  step: Step;
  conceptId: string; // Stable concept ID
  x: number;
  y: number;
  w: number;
  h: number;
  companionSlot?: Rect;
};

export type BoardLayout = {
  width: number;
  height: number;
  colW: number;
  steps: PlacedStep[];
  els: PlacedEl[];
};

// ---------------------------------------------------------------------------

function wrap(text: string, maxChars: number): string[] {
  const paragraphs = text.split('\n');
  const lines: string[] = [];
  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) { lines.push(''); continue; }
    let cur = '';
    for (const w of words) {
      if (!cur) cur = w;
      else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
      else {
        lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
  }
  return lines.length ? lines : [''];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const longest = (xs: string[]) => xs.reduce((m, s) => Math.max(m, s.length), 0);

type Sized = { w: number; h: number; parts: Record<string, Rect>; geom: PlacedEl['geom'] };

function sizeText(text: string, colW: number, fs: number): Sized {
  const lh = Math.round(fs * 1.4);
  const maxChars = Math.max(8, Math.floor(colW / (fs * HAND_W)));
  const lines = wrap(text, maxChars);
  const w = Math.min(colW, longest(lines) * fs * HAND_W + 8);
  return { w, h: lines.length * lh, parts: {}, geom: { lines, fs, lh } };
}

function sizeCode(lines: string[], label: string | undefined, colW: number): Sized {
  const pad = 14;
  let fs = 15;
  const need = longest(lines) * fs * MONO_W + pad * 2;
  if (need > colW) fs = clamp((colW - pad * 2) / Math.max(1, longest(lines)) / MONO_W, 10, 15);
  const lh = Math.round(fs * 1.6);
  const labelH = label ? LABEL_H : 0;
  const w = Math.min(colW, Math.max(180, longest(lines) * fs * MONO_W + pad * 2));
  const parts: Record<string, Rect> = {};
  lines.forEach((_, i) => {
    parts[String(i)] = { x: 6, y: labelH + pad + i * lh - 2, w: w - 12, h: lh };
  });
  return { w, h: labelH + pad * 2 + lines.length * lh, parts, geom: { fs, lh, pad, labelH } };
}

function sizeArray(
  values: string[],
  hasPointers: boolean,
  label: string | undefined,
  colW: number
): Sized {
  const labelH = label ? LABEL_H : 0;
  let cellW = clamp(longest(values) * 13 + 24, 48, 96);
  if (values.length * cellW > colW) cellW = colW / Math.max(1, values.length);
  const cellH = 50;
  const parts: Record<string, Rect> = {};
  values.forEach((_, i) => {
    parts[String(i)] = { x: i * cellW, y: labelH, w: cellW, h: cellH };
  });
  const h = labelH + cellH + 20 + (hasPointers ? 40 : 0);
  return { w: values.length * cellW, h, parts, geom: { cellW, cellH, labelH, top: labelH } };
}

function sizeChain(
  values: string[],
  vertical: boolean,
  arrows: boolean,
  label: string | undefined,
  colW: number
): Sized {
  const labelH = label ? LABEL_H : 0;
  const fs = 19;
  const boxes: Rect[] = [];
  if (vertical) {
    const w = clamp(longest(values) * fs * HAND_W + 36, 96, colW);
    const bh = 44;
    const gap = arrows ? 22 : 6;
    values.forEach((_, i) => boxes.push({ x: 0, y: labelH + i * (bh + gap), w, h: bh }));
  } else {
    const widths = values.map((v) => clamp(v.length * fs * HAND_W + 30, 58, 150));
    const gap = arrows ? 38 : 10;
    const total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, values.length - 1);
    const k = total > colW ? colW / total : 1;
    let x = 0;
    widths.forEach((bw) => {
      boxes.push({ x, y: labelH, w: bw * k, h: 46 });
      x += (bw + gap) * k;
    });
  }
  const parts: Record<string, Rect> = {};
  boxes.forEach((b, i) => (parts[String(i)] = b));
  const w = boxes.reduce((m, b) => Math.max(m, b.x + b.w), 0);
  const h = boxes.reduce((m, b) => Math.max(m, b.y + b.h), labelH) + 4;
  return { w, h, parts, geom: { boxes, vertical, arrows, labelH, fs } };
}

function sizeTree(nodes: TreeNode[], label: string | undefined, colW: number): Sized {
  const labelH = label ? LABEL_H : 0;
  const fs = 17;
  const ids = new Set(nodes.map((n) => n.id));
  const kids = new Map<string, string[]>();
  const roots: string[] = [];
  for (const n of nodes) {
    if (n.parent && ids.has(n.parent) && n.parent !== n.id) {
      kids.set(n.parent, [...(kids.get(n.parent) ?? []), n.id]);
    } else roots.push(n.id);
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const nodeW = (n: TreeNode) => clamp(n.label.length * fs * 0.55 + 26, 44, 150);
  const slot = Math.max(...nodes.map(nodeW)) + 14;

  // Leaves take successive slots; a parent sits over the middle of its children.
  const pos = new Map<string, { col: number; depth: number }>();
  let leaf = 0;
  let maxDepth = 0;
  const seen = new Set<string>();
  const place = (id: string, depth: number): number => {
    if (seen.has(id)) return pos.get(id)?.col ?? 0; // guard against cycles
    seen.add(id);
    maxDepth = Math.max(maxDepth, depth);
    const ch = kids.get(id) ?? [];
    let col: number;
    if (!ch.length) col = leaf++;
    else {
      const cols = ch.map((c) => place(c, depth + 1));
      col = (Math.min(...cols) + Math.max(...cols)) / 2;
    }
    pos.set(id, { col, depth });
    return col;
  };
  roots.forEach((r) => place(r, 0));

  const naturalW = Math.max(1, leaf) * slot;
  const k = naturalW > colW ? colW / naturalW : 1;
  const levelH = 70;
  const nh = 36;
  const placed = nodes
    .filter((n) => pos.has(n.id))
    .map((n) => {
      const p = pos.get(n.id)!;
      const w = nodeW(n) * Math.min(1, k * 1.1);
      const cx = (p.col + 0.5) * slot * k;
      return { node: n, x: cx - w / 2, y: labelH + p.depth * levelH, w, h: nh };
    });
  const edges = nodes
    .filter((n) => n.parent && byId.has(n.parent) && pos.has(n.id))
    .map((n) => ({ from: n.parent!, to: n.id }));
  const parts: Record<string, Rect> = {};
  placed.forEach((p) => (parts[p.node.id] = { x: p.x, y: p.y, w: p.w, h: p.h }));
  return {
    w: naturalW * k,
    h: labelH + maxDepth * levelH + nh + 6,
    parts,
    geom: { nodes: placed, edges, labelH, fs },
  };
}

function sizeTable(
  headers: string[] | undefined,
  rows: string[][],
  label: string | undefined,
  colW: number
): Sized {
  const labelH = label ? LABEL_H : 0;
  let fs = 16;
  const ncol = Math.max(headers?.length ?? 0, ...rows.map((r) => r.length));
  const widths = Array.from({ length: ncol }, (_, c) =>
    clamp(
      Math.max((headers?.[c] ?? '').length, ...rows.map((r) => (r[c] ?? '').length)) * fs * 0.52 +
        24,
      44,
      260
    )
  );
  const total = widths.reduce((a, b) => a + b, 0);
  const k = total > colW ? colW / total : 1;
  if (k < 1) fs = Math.max(12, fs * k);
  const colWs = widths.map((w) => w * k);
  const rowH = 36;
  const hasHead = !!headers?.length;
  const parts: Record<string, Rect> = {};
  rows.forEach((r, ri) => {
    let x = 0;
    colWs.forEach((cw, ci) => {
      parts[`${ri}.${ci}`] = { x, y: labelH + (hasHead ? rowH : 0) + ri * rowH, w: cw, h: rowH };
      x += cw;
    });
  });
  return {
    w: total * k,
    h: labelH + (rows.length + (hasHead ? 1 : 0)) * rowH + 4,
    parts,
    geom: { colW: colWs, rowH, labelH, fs, headers: hasHead },
  };
}

function sizeEl(el: El, colW: number): Sized {
  switch (el.kind) {
    case 'text':
      return sizeText(el.text, colW, 23);
    case 'note': {
      const s = sizeText(el.text, colW - 30, 21);
      return { ...s, w: s.w + 30 };
    }
    case 'code':
      return sizeCode(el.lines, el.label, colW);
    case 'array':
      return sizeArray(el.values, !!el.pointers?.length, el.label, colW);
    case 'chain':
      return sizeChain(el.values, !!el.vertical, el.arrows !== false, el.label, colW);
    case 'tree':
      return sizeTree(el.nodes, el.label, colW);
    case 'table':
      return sizeTable(el.headers, el.rows, el.label, colW);
    case 'diagram':
      return sizeDiagram(el, colW);
    case 'list':
      return sizeList(el.items, el.label, colW);
    case 'media': {
      const isVideo = el.media === 'video';
      const w = Math.min(colW, 520);
      const h = isVideo || w > 520 ? Math.round((w * 9) / 16) : Math.round(w * 0.92);
      return { w, h, parts: {}, geom: { labelH: 0, mediaW: w, mediaH: h } };
    }
    case 'illustration': {
      const isComposition = (el.parts?.length ?? 0) >= 3;
      const wantsFull = el.placement === 'full';
      const w = Math.min(wantsFull ? 640 : isComposition ? 460 : 240, colW);
      const labelH = el.label ? LABEL_H : 0;
      const illusW = Math.min(wantsFull ? 600 : isComposition ? 430 : 200, w - 24);
      const illusH = isComposition ? Math.round(illusW * 0.5) : illusW;
      const h = illusH + labelH + 16;
      const sourceW = el.parts?.length ? Math.ceil(Math.max(...el.parts.map((part) => part.x + part.w)) / 100) * 100 : 200;
      const scale = illusW / sourceW;
      const parts = Object.fromEntries((el.parts ?? []).map((part) => [part.id, {
        x: (w - illusW) / 2 + part.x * scale, y: 8 + part.y * scale,
        w: part.w * scale, h: part.h * scale,
      }]));
      return { w, h, parts, geom: { illusW, illusH, labelH } as IllustrationGeom };
    }
  }
}

export type ListGeom = {
  labelH: number;
  fs: number;
  lh: number;
  items: { lines: string[]; y: number }[];
};
export type MediaGeom = { labelH: number; mediaW: number; mediaH: number };
export type IllustrationGeom = { illusW: number; illusH: number; labelH: number };

function sizeList(items: string[], label: string | undefined, colW: number): Sized {
  const labelH = label ? LABEL_H : 0;
  const fs = 21;
  const lh = Math.round(fs * 1.35);
  const maxChars = Math.max(10, Math.floor((colW - 28) / (fs * HAND_W)));
  let y = labelH;
  const parts: Record<string, Rect> = {};
  const laid = items.map((it, i) => {
    const lines = wrap(it, maxChars);
    const row = { lines, y };
    parts[String(i)] = { x: 0, y, w: colW, h: lines.length * lh };
    y += lines.length * lh + 8;
    return row;
  });
  return { w: colW, h: y, parts, geom: { labelH, fs, lh, items: laid } };
}

export type DiagramGeom = {
  labelH: number;
  fs: number;
  layout: 'flow' | 'cycle' | 'hub' | 'timeline' | 'layers' | 'compare';
  boxes: Record<string, Rect>;
  center?: { x: number; y: number };
  axisY?: number;
  headers?: { text: string; x: number; y: number; w: number }[];
  /** Info cards for annotated diagrams: keyed by node id. */
  cards?: Record<string, { x: number; y: number; w: number; h: number; side: 'left' | 'right' }>;
  annotated?: boolean;
};

type DNode = Extract<El, { kind: 'diagram' }>['nodes'][number];

function nodeSize(n: DNode, fs: number) {
  const text = n.label.length + (n.icon ? 3 : 0);
  const noteLen = (n.note ?? '').length * 0.75;
  const w = clamp(Math.max(text * 9.5, noteLen * 8.5) + 48, 170, 270);
  return { w, h: n.note ? 64 : 50 };
}

function cardSize(n: DNode): { w: number; h: number } | null {
  if (!n.description && (!n.bullets || n.bullets.length === 0)) return null;
  const cardW = 280;
  let h = 18; // top padding
  h += 24; // numbered heading line
  if (n.description) {
    const descLines = Math.ceil(n.description.length / 32);
    h += descLines * 18 + 6;
  }
  if (n.bullets && n.bullets.length > 0) {
    h += 6; // gap before bullets
    for (const b of n.bullets) {
      const lines = Math.ceil(b.length / 30);
      h += lines * 17 + 4;
    }
  }
  h += 14; // bottom padding
  return { w: cardW, h };
}

function sizeDiagram(el: Extract<El, { kind: 'diagram' }>, colW: number): Sized {
  const labelH = el.label ? LABEL_H + 6 : 0;
  const fs = 17;
  const boxes: Record<string, Rect> = {};
  const nodes = el.nodes;
  const layout = el.layout ?? 'flow';
  const done = (h: number, extra: Partial<DiagramGeom> = {}): Sized => ({
    w: colW,
    h,
    parts: boxes,
    geom: { labelH, fs, layout, boxes, ...extra },
  });

  if (layout === 'layers') {
    // Stacked bands, full width — the OSI model, the atmosphere, a software stack.
    let y = labelH;
    nodes.forEach((n) => {
      const h = n.note ? 54 : 46;
      boxes[n.id] = { x: 0, y, w: colW, h };
      y += h + 8;
    });
    return done(y);
  }

  if (layout === 'compare') {
    const groups = Array.from(new Set(nodes.map((n) => n.group || 'A'))).slice(0, 2);
    const half = (colW - 56) / 2;
    const headers = groups.map((g, i) => ({ text: g, x: i * (half + 56), y: labelH, w: half }));
    const ys = [labelH + 44, labelH + 44];
    nodes.forEach((n) => {
      const gi = Math.max(0, groups.indexOf(n.group || 'A'));
      const col = gi > 1 ? 1 : gi;
      const h = n.note ? 58 : 44;
      boxes[n.id] = { x: col * (half + 56), y: ys[col], w: half, h };
      ys[col] += h + 10;
    });
    return done(Math.max(...ys), { headers, center: { x: colW / 2, y: labelH + 18 } });
  }

  if (layout === 'timeline') {
    const axisY = labelH + 26;
    const step = colW / Math.max(1, nodes.length);
    let bottom = axisY;
    nodes.forEach((n, i) => {
      const sz = nodeSize(n, fs);
      const w = Math.min(sz.w, step * 1.85);
      const cx = step * (i + 0.5);
      const y = axisY + 22 + (i % 2) * (sz.h + 14); // alternate rows so neighbours never collide
      boxes[n.id] = { x: clamp(cx - w / 2, 0, colW - w), y, w, h: sz.h };
      bottom = Math.max(bottom, y + sz.h);
    });
    return done(bottom + 6, { axisY });
  }

  if (layout === 'hub' && nodes.length > 2) {
    // Centre in the middle, spokes out to a row above and a row below. A ring
    // was tried first: side nodes collided with a wide centre box.
    const ring = nodes.slice(1);
    const topRow = ring.slice(0, Math.ceil(ring.length / 2));
    const botRow = ring.slice(topRow.length);
    const placeRow = (row: DNode[], y: number) => {
      const sizes = row.map((n) => nodeSize(n, fs));
      const gap = 22;
      const total = sizes.reduce((a, s) => a + s.w, 0) + gap * (row.length - 1);
      const k = total > colW ? colW / total : 1;
      let x = (colW - total * k) / 2;
      row.forEach((n, i) => {
        boxes[n.id] = { x, y, w: sizes[i].w * k, h: sizes[i].h };
        x += (sizes[i].w + gap) * k;
      });
      return Math.max(...sizes.map((s) => s.h));
    };
    const topH = placeRow(topRow, labelH);
    const c = nodeSize(nodes[0], fs + 2);
    const cy = labelH + topH + 62;
    boxes[nodes[0].id] = { x: colW / 2 - c.w / 2 - 8, y: cy, w: c.w + 16, h: c.h + 8 };
    const botY = cy + c.h + 8 + 62;
    const botH = botRow.length ? placeRow(botRow, botY) : 0;
    return done(botRow.length ? botY + botH + 6 : cy + c.h + 14, {
      center: { x: colW / 2, y: cy + c.h / 2 },
    });
  }

  if (layout === 'cycle' && nodes.length > 2) {
    const ring = nodes;
    const sizes = ring.map((n) => nodeSize(n, fs));
    const maxW = Math.max(...sizes.map((s) => s.w));
    const maxH = Math.max(...sizes.map((s) => s.h));
    const rx = Math.max(90, Math.min(colW / 2 - maxW / 2 - 4, 240));
    const ry = Math.min(165, 78 + ring.length * 15);
    const cx = colW / 2;
    const cy = labelH + ry + maxH / 2 + 4;
    ring.forEach((n, i) => {
      const a = -Math.PI / 2 + (i / ring.length) * Math.PI * 2;
      const s = sizes[i];
      boxes[n.id] = {
        x: cx + Math.cos(a) * rx - s.w / 2,
        y: cy + Math.sin(a) * ry - s.h / 2,
        w: s.w,
        h: s.h,
      };
    });
    return done(cy + ry + maxH / 2 + 8, { center: { x: cx, y: cy } });
  }

  // flow: layered top-to-bottom; a node sits one layer below the deepest node
  // pointing at it. Nodes with no edges at all get their own final row rather
  // than crowding the top.
  const annotated = nodes.some((n) => n.description || (n.bullets && n.bullets.length > 0));
  const linked = new Set(el.edges.flatMap((e) => [e.from, e.to]));
  const layer: Record<string, number> = {};
  nodes.forEach((n) => (layer[n.id] = 0));
  for (let pass = 0; pass < nodes.length; pass++) {
    let moved = false;
    for (const e of el.edges) {
      if (layer[e.from] === undefined || layer[e.to] === undefined) continue;
      if (layer[e.to] < layer[e.from] + 1 && layer[e.from] + 1 < nodes.length) {
        layer[e.to] = layer[e.from] + 1;
        moved = true;
      }
    }
    if (!moved) break;
  }
  const rows: DNode[][] = [];
  nodes.filter((n) => linked.has(n.id)).forEach((n) => (rows[layer[n.id]] ??= []).push(n));
  const compact = rows.filter(Boolean);
  const loose = nodes.filter((n) => !linked.has(n.id));
  if (loose.length) compact.push(loose);

  if (annotated) {
    // Annotated flow: nodes centered, info cards placed directly below each node
    const cards: Record<string, { x: number; y: number; w: number; h: number; side: 'left' | 'right' }> = {};
    let y = labelH;
    let cardIdx = 0;
    compact.forEach((row) => {
      const sizes = row.map((n) => nodeSize(n, fs));
      const gap = 28;
      const total = sizes.reduce((a, s) => a + s.w, 0) + gap * (row.length - 1);
      const k = total > colW ? colW / total : 1;
      let x = (colW - total * k) / 2;
      const nodeH = Math.max(...sizes.map((s) => s.h));
      row.forEach((n, i) => {
        const nw = sizes[i].w * k;
        boxes[n.id] = { x, y, w: nw, h: sizes[i].h };
        x += (nw + gap) * k;
      });
      y += nodeH + 12;

      // Place info cards for nodes in this row, below the nodes
      row.forEach((n) => {
        const cs = cardSize(n);
        if (cs) {
          const side: 'left' | 'right' = cardIdx % 2 === 0 ? 'left' : 'right';
          const cardW = Math.min(cs.w, colW);
          const nodeBox = boxes[n.id];
          const cardX = clamp(nodeBox.x + nodeBox.w / 2 - cardW / 2, 0, colW - cardW);
          cards[n.id] = { x: cardX, y, w: cardW, h: cs.h, side };
          cardIdx++;
          y += cs.h + 10;
        }
      });
      y += 46; // gap before next row's node
    });
    return done(y - 30, { cards, annotated: true });
  }

  let y = labelH;
  compact.forEach((row) => {
    const sizes = row.map((n) => nodeSize(n, fs));
    const gap = 28;
    const total = sizes.reduce((a, s) => a + s.w, 0) + gap * (row.length - 1);
    const k = total > colW ? colW / total : 1;
    let x = (colW - total * k) / 2;
    const rh = Math.max(...sizes.map((s) => s.h));
    row.forEach((n, i) => {
      boxes[n.id] = { x, y, w: sizes[i].w * k, h: sizes[i].h };
      x += (sizes[i].w + gap) * k;
    });
    y += rh + 58; // room between rows for arrow labels
  });
  return done(y - 52);
}

// ---------------------------------------------------------------------------

export function estimateCheckpointContentHeight(
  cp:
    | {
        question?: string;
        options?: Array<string | { id?: string; text?: string }>;
        hints?: string[];
        revealedHintsCount?: number;
        criteria?: string;
        answerReceived?: boolean;
        response?: { text: string; modality: string };
        evaluation?: { isCorrect?: boolean; feedback?: string; criteriaMet?: boolean; status?: string };
        status?: string;
      }
    | undefined,
  width: number
): number {
  if (!cp) return 0;
  const padX = 18;
  const contentW = Math.max(120, width - padX * 2);

  // 1. Header: Quick Check label + status badge
  let h = 26;

  // 2. Question text wrapping
  const qText = cp.question?.trim() || '';
  if (qText) {
    const charsPerLine = Math.max(16, Math.floor(contentW / 8));
    const words = qText.split(/\s+/).filter(Boolean);
    let qLines = 1;
    let curLen = 0;
    for (const w of words) {
      if (curLen + w.length + 1 > charsPerLine) {
        qLines++;
        curLen = w.length;
      } else {
        curLen += w.length + 1;
      }
    }
    h += qLines * 18 + 6;
  }

  // 3. Option chips with row wrapping
  const opts = cp.options || [];
  if (opts.length > 0) {
    let rowW = 0;
    let optRows = 1;
    const gap = 6;
    for (const opt of opts) {
      const optStr = typeof opt === 'string' ? opt : opt.text || opt.id || '';
      const chipW = optStr.length * 7.5 + 24;
      if (rowW + chipW > contentW && rowW > 0) {
        optRows++;
        rowW = chipW;
      } else {
        rowW += chipW + gap;
      }
    }
    h += optRows * 28 + 6;
  }

  // 4. Typed input row (when awaiting or interactive)
  if (cp.status === 'awaiting_response' || !cp.status || cp.status === 'pending') {
    h += 38;
  }

  // 5. Revealed hints and hint button
  const revealedCount = cp.revealedHintsCount || 0;
  if (revealedCount > 0 && cp.hints) {
    for (let i = 0; i < Math.min(revealedCount, cp.hints.length); i++) {
      const hint = cp.hints[i];
      const charsPerLine = Math.max(16, Math.floor(contentW / 7.5));
      const lines = Math.max(1, Math.ceil(hint.length / charsPerLine));
      h += lines * 18 + 12;
    }
  }
  if (cp.hints && cp.hints.length > 0) {
    h += 28; // Hint button row
  }

  // 6. Answer received display + Evaluation feedback
  if (cp.answerReceived || cp.response) {
    h += 26; // Answer: "..." via modality
    if (cp.evaluation) {
      const fb = cp.evaluation.feedback || '';
      const charsPerLine = Math.max(16, Math.floor(contentW / 7.5));
      const fbLines = Math.max(1, Math.ceil(fb.length / charsPerLine));
      h += 22 + fbLines * 18;
      if (cp.evaluation.isCorrect === false) {
        h += 28; // Retry button
      }
    }
  }

  // Padding
  h += 16;
  return Math.max(72, h);
}

export function estimateCardHeight(
  text: string,
  hasCheck: boolean,
  width: number,
  hasStructuredCheck?: boolean,
  liveCheckpoint?: CheckpointEntry
): number {
  const padX = 18;
  const contentW = Math.max(120, width - padX * 2);
  const trimmed = text.trim();
  // Telugu and Hindi scripts use wider conjuncts/glyphs (~10px vs ~8.5px Latin at 16px)
  const isIndic = /[\u0C00-\u0C7F\u0900-\u097F]/.test(trimmed);
  const charWidth = isIndic ? 10.5 : 8.5;
  const charsPerLine = Math.max(12, Math.floor(contentW / charWidth));
  const words = trimmed.split(/\s+/).filter(Boolean);
  let lines = 1;
  let curLen = 0;
  for (const w of words) {
    if (curLen + w.length + 1 > charsPerLine) {
      lines++;
      curLen = w.length;
    } else {
      curLen += w.length + 1;
    }
  }
  // 16px font with 1.65 line height is ~26.4px per line + breathing room
  const textH = Math.max(50, lines * 28);
  let checkExtraH = 0;
  if (liveCheckpoint) {
    checkExtraH = estimateCheckpointContentHeight(liveCheckpoint, width);
  } else if (hasCheck) {
    checkExtraH = hasStructuredCheck ? 136 : 68;
  }
  const totalH = 78 + textH + checkExtraH + 20;
  return Math.max(180, totalH);
}

// ---------------------------------------------------------------------------

export function layoutBoard(
  steps: Step[],
  revealed: number,
  columns = 1,
  stepNotes?: Record<string, string>,
  activeConceptId?: string,
  isSpeaking?: boolean,
  checkpoints?: Record<string, CheckpointEntry>,
  boardId?: string,
  viewportWidth?: number
): BoardLayout {
  const isMobile = Boolean(viewportWidth && viewportWidth <= 640);
  const margin = isMobile ? 16 : 40;
  const gutter = isMobile ? 16 : 48;
  const width = isMobile ? Math.max(320, viewportWidth!) : 1120;
  const activeCols = isMobile ? 1 : columns;
  const colW = (width - margin * 2 - gutter * (activeCols - 1)) / activeCols;
  const colH: number[] = Array.from({ length: activeCols }, () => margin);
  const placedSteps: PlacedStep[] = [];
  const els: PlacedEl[] = [];

  steps.slice(0, revealed).forEach((step, si) => {
    const conceptId = step.conceptId || step.id;
    const col = colH.indexOf(Math.min(...colH));
    const x = margin + col * (colW + gutter);
    const y0 = colH[col];
    let y = y0 + (step.title ? TITLE_H + 12 : 0);
    // Classify elements into visuals, companion notes, and full-width elements
    const mediaEls: { el: El; order: number }[] = [];
    const diagEls: { el: El; order: number }[] = [];
    const illusEls: { el: El; order: number }[] = [];
    const textEls: { el: El; order: number }[] = [];
    const wideEls: { el: El; order: number }[] = [];

    step.elements.forEach((el, order) => {
      if (el.kind === 'media') {
        mediaEls.push({ el, order });
      } else if (el.kind === 'diagram') {
        const d = el as Extract<El, { kind: 'diagram' }>;
        // Wide diagrams (only compare or timeline) span full width by default.
        // 'layers' (like OSI model) stacks vertically and fits cleanly in the visual column!
        if (d.layout === 'compare' || d.layout === 'timeline') {
          wideEls.push({ el, order });
        } else {
          diagEls.push({ el, order });
        }
      } else if (el.kind === 'illustration') {
        // A side/integrated visual is a companion to the diagram; a below
        // visual gets its own row so small screens never crowd the diagram.
        if (el.placement === 'below' || el.placement === 'full') wideEls.push({ el, order });
        else illusEls.push({ el, order });
      } else if (el.kind === 'note' || el.kind === 'text' || el.kind === 'list') {
        textEls.push({ el, order });
      } else {
        wideEls.push({ el, order });
      }
    });

    // Split into side-by-side columns whenever a visual element (diagram, illustration, or media) is present,
    // UNLESS on mobile/narrow screens where everything stacks in a single column (diagram -> notes -> checkpoint).
    const hasVisual = mediaEls.length > 0 || diagEls.length > 0 || illusEls.length > 0;
    const hasSplitVisual = hasVisual && !isMobile;
    let companionSlot: Rect | undefined;

    const cpKey = boardId ? `${boardId}:${conceptId}` : '';
    const liveCp =
      (cpKey && checkpoints?.[cpKey]) ||
      (checkpoints && Object.values(checkpoints).find((c) => c.conceptId === conceptId));

    const mediaCaption = mediaEls.map((m) => (m.el as Extract<El, { kind: 'media' }>).caption).find(Boolean) || '';
    const speechText = (stepNotes?.[conceptId] || step.say || mediaCaption || '').trim();
    const hasCheck = Boolean(step.check?.trim() || liveCp?.question?.trim());
    const hasStructuredCheck = Boolean(
      liveCp?.options?.length ||
      liveCp?.hints?.length ||
      liveCp?.criteria ||
      step.checkOptions?.length ||
      step.checkHints?.length ||
      step.checkCriteria
    );
    const isLive = Boolean(activeConceptId && activeConceptId === conceptId && isSpeaking);
    const hasMeaningfulContent = Boolean(speechText || hasCheck || isLive || liveCp);

    if (!hasSplitVisual) {
      if (isMobile) {
        // Mobile single-column order: diagram/visual -> explanation notes -> checkpoint/speech card -> wide elements
        const mobileOrder = [
          ...diagEls,
          ...mediaEls,
          ...illusEls,
          ...textEls,
        ];
        // If there are other elements not caught above (fallback to preserving any uncategorized)
        const categorizedSet = new Set(mobileOrder.map((m) => m.el.id));
        step.elements.forEach((el, order) => {
          if (!categorizedSet.has(el.id) && !wideEls.some((w) => w.el.id === el.id)) {
            mobileOrder.push({ el, order });
          }
        });

        mobileOrder.forEach(({ el, order }) => {
          const s = sizeEl(el, colW);
          els.push({
            el,
            step: si + 1,
            conceptId,
            order,
            x,
            y,
            w: s.w,
            h: s.h,
            parts: s.parts,
            geom: s.geom,
          });
          y += s.h + EL_GAP;
        });

        if (hasMeaningfulContent) {
          const cardW = colW;
          const cardH = estimateCardHeight(speechText, hasCheck, cardW, hasStructuredCheck, liveCp);
          companionSlot = { x, y, w: cardW, h: cardH };
          y += cardH + EL_GAP;
        }

        wideEls.forEach(({ el, order }) => {
          const s = sizeEl(el, colW);
          els.push({
            el,
            step: si + 1,
            conceptId,
            order,
            x,
            y,
            w: s.w,
            h: s.h,
            parts: s.parts,
            geom: s.geom,
          });
          y += s.h + EL_GAP;
        });
      } else {
        step.elements.forEach((el, order) => {
          const s = sizeEl(el, colW);
          const indent = el.kind === 'note' ? 0 : 0;
          els.push({
            el,
            step: si + 1,
            conceptId,
            order,
            x: x + indent,
            y,
            w: s.w,
            h: s.h,
            parts: s.parts,
            geom: s.geom,
          });
          y += s.h + EL_GAP;
        });

        if (hasMeaningfulContent) {
          const cardW = Math.min(colW, 580);
          const cardH = estimateCardHeight(speechText, hasCheck, cardW, hasStructuredCheck, liveCp);
          companionSlot = { x, y, w: cardW, h: cardH };
          y += cardH + EL_GAP;
        }
      }
    } else {
      // Step contains a visual element (diagram, doodle, or media image).
      // Constrain visual to left column (~48%), and notes/speech to right column (~50%)!
      const GAP = 28;
      const visualW = Math.round((colW - GAP) * 0.48);
      const textW = colW - GAP - visualW;
      const textX = x + visualW + GAP;

      // Determine primary visual for the left column
      const leftVisuals: { el: El; order: number }[] = [];
      if (mediaEls.length > 0) {
        leftVisuals.push(...mediaEls);
        // If there's also a diagram, let it span below
        wideEls.push(...diagEls);
      } else {
        leftVisuals.push(...diagEls);
      }
      leftVisuals.push(...illusEls);

      // Left column: visual element(s)
      let visualY = y;
      leftVisuals.forEach(({ el, order }) => {
        const s = sizeEl(el, visualW);
        els.push({
          el,
          step: si + 1,
          conceptId,
          order,
          x,
          y: visualY,
          w: s.w,
          h: s.h,
          parts: s.parts,
          geom: s.geom,
        });
        visualY += s.h + EL_GAP;
      });

      const visualBlockH = visualY - y - EL_GAP;

      // Right column: explanation text / notes
      let textY = y;
      textEls.forEach(({ el, order }) => {
        const s = sizeEl(el, textW);
        els.push({
          el,
          step: si + 1,
          conceptId,
          order,
          x: textX,
          y: textY,
          w: textW,
          h: s.h,
          parts: s.parts,
          geom: s.geom,
        });
        textY += s.h + 8;
      });

      // Provide companionSlot on the right column ONLY when there is meaningful content
      if (hasMeaningfulContent) {
        const cardY = textEls.length === 0 ? y : textY + 12;
        const neededCardH = estimateCardHeight(speechText, hasCheck, textW, hasStructuredCheck, liveCp);
        const visualRemainingH = Math.max(0, visualBlockH - (cardY - y));
        const cardH = Math.max(neededCardH, visualRemainingH);
        companionSlot = { x: textX, y: cardY, w: textW, h: cardH };
        textY = cardY + cardH;
      } else {
        companionSlot = undefined;
      }

      // Move y past whichever side is taller
      y = Math.max(visualY, textY);

      // Bottom: Flowcharts, architecture diagrams, code, tables spanning full colW
      wideEls.forEach(({ el, order }) => {
        const s = sizeEl(el, colW);
        els.push({
          el,
          step: si + 1,
          conceptId,
          order,
          x,
          y,
          w: s.w,
          h: s.h,
          parts: s.parts,
          geom: s.geom,
        });
        y += s.h + EL_GAP;
      });
    }
    const h = y - y0 + STEP_PAD_BOTTOM - EL_GAP;
    placedSteps.push({ index: si + 1, step, conceptId, x, y: y0, w: colW, h, companionSlot });
    colH[col] = y0 + h + 24;
  });

  return {
    width,
    height: Math.max(...colH) + margin,
    colW,
    steps: placedSteps,
    els,
  };
}

/** Board-space rect for a target address, or undefined if it is not drawn. */
export function targetRect(layout: BoardLayout, target: string): Rect | undefined {
  const [id, sub] = target.split('#');
  const pe = layout.els.find((e) => e.el.id === id);
  if (!pe) return undefined;
  if (sub !== undefined && pe.parts[sub]) {
    const p = pe.parts[sub];
    return { x: pe.x + p.x, y: pe.y + p.y, w: p.w, h: p.h };
  }
  return { x: pe.x, y: pe.y, w: pe.w, h: pe.h };
}

/** Board-space rect for a step or element ID, resolving to step bounds first. */
export function findStepTarget(layout: BoardLayout, stepId: string): Rect | undefined {
  const ps = layout.steps.find((s) => s.step.id === stepId || s.conceptId === stepId);
  if (ps) {
    return { x: ps.x, y: ps.y, w: ps.w, h: ps.h };
  }
  return targetRect(layout, stepId);
}

/** A few words for what a target shows — the fallback when the agent has no record of it. */
export function targetText(layout: BoardLayout, target: string): string {
  const [id, sub] = target.split('#');
  const pe = layout.els.find((e) => e.el.id === id);
  if (!pe) return target;
  const el = pe.el;
  if (sub === undefined) {
    if (el.kind === 'text' || el.kind === 'note') return el.text;
    if (el.kind === 'code') return el.lines.slice(0, 2).join(' / ');
    if (el.kind === 'array' || el.kind === 'chain') return el.values.join(', ');
    if (el.kind === 'tree') return el.nodes.map((n) => n.label).join(', ');
    if (el.kind === 'diagram') return el.nodes.map((n) => n.label).join(' -> ');
    if (el.kind === 'list') return el.items.join('; ');
    if (el.kind === 'media') return el.caption ?? el.media;
    return el.label ?? el.kind;
  }
  if (el.kind === 'code') return el.lines[+sub]?.trim() ?? '';
  if (el.kind === 'array' || el.kind === 'chain') return el.values[+sub] ?? '';
  if (el.kind === 'tree') return el.nodes.find((n) => n.id === sub)?.label ?? '';
  if (el.kind === 'diagram') return el.nodes.find((n) => n.id === sub)?.label ?? '';
  if (el.kind === 'list') return el.items[+sub] ?? '';
  if (el.kind === 'table') {
    const [r, c] = sub.split('.').map(Number);
    return el.rows[r]?.[c] ?? '';
  }
  return '';
}
