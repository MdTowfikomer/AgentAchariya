'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { codeToHtml } from 'shiki';

/**
 * The thing the student LOOKS at while Nova talks.
 *
 * Code and diagrams are unspeakable — reading a for-loop aloud is useless. The
 * agent pushes them over a LiveKit data channel (topic "nova-canvas") and they
 * render here, beside the conversation, while the agent keeps talking normally.
 */

export type CanvasPayload =
  | { kind: 'code'; title: string; language: string; code: string }
  | { kind: 'flow'; title: string; steps: string[] }
  | {
      kind: 'problem';
      title: string;
      rating: number | null;
      tags: string[];
      url: string;
      source: string;
      freshness: string;
    }
  | {
      kind: 'agent';
      id: string;
      name: string;
      role: string;
      tint: string;
      lang: string;
      from?: string;
      reason?: string;
    }
  | { kind: 'clear' };

export const C = {
  paper: '#F6F1E9',
  card: '#FFFDFA',
  ink: '#4A4038',
  inkSoft: '#8C8177',
  line: '#E8DFD2',
  clay: '#C4704F',
  sage: '#6F9E82',
  sky: '#5B7FA6',
  amber: '#C89B4A',
  rose: '#B5695F',
};

// ---------------------------------------------------------------------------
// Code
// ---------------------------------------------------------------------------

function CodeCard({ title, language, code }: { title: string; language: string; code: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    codeToHtml(code, { lang: language || 'text', theme: 'catppuccin-latte' })
      .then((h) => alive && setHtml(h))
      .catch(() => alive && setHtml(null)); // unknown language -> plain text
    return () => {
      alive = false;
    };
  }, [code, language]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full overflow-hidden rounded-2xl"
      style={{ background: C.card, border: `1px solid ${C.line}` }}
    >
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ borderBottom: `1px solid ${C.line}`, background: C.paper }}
      >
        <span className="text-[15px] font-semibold" style={{ color: C.ink }}>
          {title}
        </span>
        <span
          className="rounded-md px-2 py-0.5 font-mono text-[10px] tracking-wider uppercase"
          style={{ background: `${C.clay}1A`, color: C.clay }}
        >
          {language}
        </span>
      </div>
      <div className="max-h-[52vh] overflow-auto p-4 text-[13.5px] leading-[1.7]">
        {html ? (
          <div className="[&_pre]:!bg-transparent" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <pre className="font-mono whitespace-pre-wrap" style={{ color: C.ink }}>
            {code}
          </pre>
        )}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Flowchart — boxes animate in one at a time, like drawing on a whiteboard
// ---------------------------------------------------------------------------

function FlowCard({ title, steps }: { title: string; steps: string[] }) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    setShown(0);
    const id = setInterval(() => {
      setShown((n) => {
        if (n >= steps.length) {
          clearInterval(id);
          return n;
        }
        return n + 1;
      });
    }, 650);
    return () => clearInterval(id);
  }, [steps]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full overflow-hidden rounded-2xl"
      style={{ background: C.card, border: `1px solid ${C.line}` }}
    >
      <div
        className="px-4 py-2.5"
        style={{ borderBottom: `1px solid ${C.line}`, background: C.paper }}
      >
        <span className="text-[15px] font-semibold" style={{ color: C.ink }}>
          {title}
        </span>
      </div>

      <div className="flex max-h-[52vh] flex-col items-center gap-0 overflow-auto px-4 py-6">
        {steps.slice(0, shown).map((step, i) => {
          const decision = step.trim().endsWith('?');
          const first = i === 0;
          const last = i === steps.length - 1;
          const tint = decision ? C.amber : first ? C.sage : last ? C.clay : C.sky;

          return (
            <div key={i} className="flex w-full flex-col items-center">
              {i > 0 && (
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: 26 }}
                  transition={{ duration: 0.22 }}
                  className="w-[2px]"
                  style={{ background: C.line }}
                />
              )}
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 22 }}
                className="w-full max-w-[22rem] px-5 py-3 text-center text-[14.5px] font-medium"
                style={{
                  color: C.ink,
                  background: `${tint}14`,
                  border: `1.5px solid ${tint}66`,
                  borderRadius: decision ? '999px' : '14px',
                }}
              >
                {step}
              </motion.div>
            </div>
          );
        })}

        {shown < steps.length && (
          <motion.div
            className="mt-4 font-mono text-[10px] tracking-[0.2em] uppercase"
            style={{ color: C.inkSoft }}
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.2, repeat: Infinity }}
          >
            drawing…
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Practice problem — real, fetched live from Codeforces
// ---------------------------------------------------------------------------

function difficultyTint(rating: number | null) {
  if (rating === null) return C.sky;
  if (rating <= 1000) return C.sage;
  if (rating <= 1600) return C.amber;
  return C.rose;
}

function ProblemCard({
  title,
  rating,
  tags,
  url,
  source,
  freshness,
}: {
  title: string;
  rating: number | null;
  tags: string[];
  url: string;
  source: string;
  freshness: string;
}) {
  const tint = difficultyTint(rating);
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full overflow-hidden rounded-2xl"
      style={{ background: C.card, border: `1px solid ${C.line}` }}
    >
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ borderBottom: `1px solid ${C.line}`, background: C.paper }}
      >
        <span
          className="font-mono text-[10px] tracking-[0.18em] uppercase"
          style={{ color: C.inkSoft }}
        >
          practice problem
        </span>
        {rating !== null && (
          <span
            className="rounded-md px-2 py-0.5 font-mono text-[11px] font-bold"
            style={{ background: `${tint}1F`, color: tint }}
          >
            {rating}
          </span>
        )}
      </div>

      <div className="p-5">
        <h3 className="text-[20px] leading-snug font-bold" style={{ color: C.ink }}>
          {title}
        </h3>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span
              key={t}
              className="rounded-full px-2.5 py-1 text-[12px]"
              style={{ background: C.paper, color: C.inkSoft, border: `1px solid ${C.line}` }}
            >
              {t}
            </span>
          ))}
        </div>

        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 block w-full rounded-xl py-3 text-center text-[15px] font-semibold text-white transition hover:brightness-[1.06]"
          style={{ background: C.clay }}
        >
          ఇక్కడ solve చెయ్యి
        </a>

        {/* Provenance: which source, and how old the data is. */}
        <p className="mt-3 text-center text-[11px]" style={{ color: C.inkSoft }}>
          {source} · {freshness}
        </p>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyCanvas() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <div
        className="mb-5 flex size-16 items-center justify-center rounded-2xl font-mono text-xl"
        style={{ background: `${C.clay}14`, color: C.clay }}
      >
        {'</>'}
      </div>
      <p className="text-[16px] font-semibold" style={{ color: C.ink }}>
        ఇక్కడ code కనిపిస్తుంది
      </p>
      <p className="mt-2 max-w-[18rem] text-[14px] leading-relaxed" style={{ color: C.inkSoft }}>
        ఏదైనా program అడుగు — నోవా ఇక్కడ రాసి చూపిస్తుంది, flowchart కూడా గీస్తుంది.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function Canvas({ items }: { items: CanvasPayload[] }) {
  const cards = items.filter((i) => i.kind !== 'clear' && i.kind !== 'agent');

  if (cards.length === 0) {
    return (
      <div className="h-full w-full overflow-auto p-5">
        <EmptyCanvas />
      </div>
    );
  }

  // Newest first, and everything stays. A flowchart and the code that
  // implements it belong on screen together — replacing one with the other is
  // what forced the agent to read code aloud instead of pointing at it.
  return (
    <div className="h-full w-full overflow-auto p-5">
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <AnimatePresence initial={false}>
          {cards
            .map((item, i) => ({ item, i }))
            .reverse()
            .map(({ item, i }) =>
              item.kind === 'code' ? (
                <CodeCard
                  key={`code-${i}-${item.title}`}
                  title={item.title}
                  language={item.language}
                  code={item.code}
                />
              ) : item.kind === 'problem' ? (
                <ProblemCard
                  key={`problem-${i}-${item.url}`}
                  title={item.title}
                  rating={item.rating}
                  tags={item.tags}
                  url={item.url}
                  source={item.source}
                  freshness={item.freshness}
                />
              ) : (
                <FlowCard key={`flow-${i}-${item.title}`} title={item.title} steps={item.steps} />
              )
            )}
        </AnimatePresence>
      </div>
    </div>
  );
}
