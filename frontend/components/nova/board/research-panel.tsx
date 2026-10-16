'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useT } from '../i18n';
import { INK } from './elements';

/**
 * The curated "latest findings" list beside the board.
 *
 * When a concept touches the real world as it is now, the teacher researches it
 * live (SerpApi + Google Search). The student sees the search happening, then
 * every finding with the source it came from — newest query on top, so the
 * panel becomes a running reading list for the whole class.
 */

export type Finding = { point: string; source: string; url: string };
export type ResearchItem = {
  id: string;
  query: string;
  status: 'searching' | 'done' | 'failed';
  findings: Finding[];
  error?: string;
  at: number;
};

export type ResearchOp =
  | { op: 'research_start'; id: string; query: string }
  | { op: 'research'; id: string; query: string; findings: Finding[] }
  | { op: 'research_fail'; id: string; query: string; reason?: string };

export function reduceResearch(
  items: ResearchItem[],
  op: ResearchOp | { op: 'restore'; items: ResearchItem[] }
): ResearchItem[] {
  if (op.op === 'restore') return op.items;
  const rest = items.filter((i) => i.id !== op.id);
  const prev = items.find((i) => i.id === op.id);
  const at = prev?.at ?? Date.now();
  if (op.op === 'research_start')
    return [{ id: op.id, query: op.query, status: 'searching', findings: [], at }, ...rest];
  if (op.op === 'research')
    return [{ id: op.id, query: op.query, status: 'done', findings: op.findings, at }, ...rest];
  return [{ id: op.id, query: op.query, status: 'failed', findings: [], error: op.reason, at }, ...rest];
}

const host = (url: string, source: string) => {
  if (source) return source;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'web';
  }
};

export function ResearchPanel({ items }: { items: ResearchItem[] }) {
  const t = useT();
  return (
    <aside
      className="flex h-full w-full flex-col"
      style={{ background: '#FFFFFF', borderLeft: `1px solid ${INK.grid}` }}
    >
      <div className="px-4 pt-4 pb-3" style={{ borderBottom: `1px solid ${INK.grid}` }}>
        <p className="font-mono text-[10px] tracking-[0.2em] uppercase" style={{ color: INK.soft }}>
          {t.researchTitle}
        </p>
        <p className="mt-0.5 text-[13px]" style={{ color: INK.soft }}>
          {t.researchSub}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <AnimatePresence initial={false}>
          {items.map((it) => (
            <motion.section
              key={it.id}
              layout
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-5"
            >
              <div className="mb-2 flex items-start gap-2">
                {it.status === 'searching' ? (
                  <motion.span
                    className="mt-1.5 size-2 shrink-0 rounded-full"
                    style={{ background: INK.teacher }}
                    animate={{ opacity: [1, 0.2, 1], scale: [1, 1.3, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                  />
                ) : (
                  <span
                    className="mt-1.5 size-2 shrink-0 rounded-full"
                    style={{ background: it.status === 'done' ? '#6F9E82' : INK.soft }}
                  />
                )}
                <div className="min-w-0">
                  <p className="text-[14px] leading-snug font-semibold" style={{ color: INK.ink }}>
                    {it.query}
                  </p>
                  <p className="font-mono text-[10px] tracking-wider" style={{ color: INK.soft }}>
                    {it.status === 'searching'
                      ? t.researching
                      : it.status === 'failed'
                        ? it.error ?? 'could not reach sources'
                        : `${it.findings.length} findings · ${new Date(it.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                  </p>
                </div>
              </div>

              {it.status === 'searching' && (
                <div className="flex flex-col gap-2 pl-4">
                  {[0.9, 0.75, 0.6].map((w, i) => (
                    <motion.div
                      key={i}
                      className="h-3 rounded"
                      style={{ width: `${w * 100}%`, background: INK.grid }}
                      animate={{ opacity: [0.4, 1, 0.4] }}
                      transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.15 }}
                    />
                  ))}
                </div>
              )}

              <ol className="flex flex-col gap-2.5 pl-4">
                {it.findings.map((f, i) => (
                  <motion.li
                    key={i}
                    initial={{ opacity: 0, x: 6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.08 }}
                    className="text-[13px] leading-relaxed"
                    style={{ color: INK.ink }}
                  >
                    {f.point}
                    {f.url ? (
                      <a
                        href={f.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-1.5 inline-block rounded-md px-1.5 py-0.5 align-middle font-mono text-[10px] hover:brightness-95"
                        style={{ background: `${INK.teacher}14`, color: INK.teacher }}
                      >
                        {host(f.url, f.source)} ↗
                      </a>
                    ) : null}
                  </motion.li>
                ))}
              </ol>
            </motion.section>
          ))}
        </AnimatePresence>
      </div>
    </aside>
  );
}
