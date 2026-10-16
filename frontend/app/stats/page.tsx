'use client';

import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { C } from '@/components/nova/canvas';

/**
 * Call analytics.
 *
 * Success here means the student left with something concrete: a concept on
 * screen, a problem to attempt, or a human found for them. Anything else is a
 * failure, and failures are broken down by cause rather than hidden.
 *
 * Refreshes every three seconds, so a call ending is visible without a reload.
 */

type Totals = {
  total: string;
  successful: string;
  failed: string;
  in_progress: string;
  concepts_taught: string;
  problems_given: string;
  escalations: string;
  avg_duration_s: string;
};

type Call = {
  id: string;
  channel: string;
  language: string | null;
  started_at: string;
  duration_s: number | null;
  outcome: string | null;
  failure_type: string | null;
  concepts_taught: number;
  problems_given: number;
  escalations: number;
  turns: number;
};

const FAILURE_LABEL: Record<string, string> = {
  no_engagement: 'joined but never spoke',
  incomplete: 'talked, never got to a concept',
  tool_failure: 'a tool broke mid-call',
};

const n = (v: string | number | null | undefined) => Number(v ?? 0);

function Stat({
  label,
  value,
  tint,
  sub,
}: {
  label: string;
  value: string | number;
  tint: string;
  sub?: string;
}) {
  return (
    <div
      className="flex-1 rounded-2xl px-5 py-5"
      style={{ background: C.card, border: `1px solid ${C.line}` }}
    >
      <p className="font-mono text-[10px] tracking-[0.18em] uppercase" style={{ color: C.inkSoft }}>
        {label}
      </p>
      <p className="mt-2 font-mono text-[38px] leading-none font-bold" style={{ color: tint }}>
        {value}
      </p>
      {sub && (
        <p className="mt-2 text-[12px]" style={{ color: C.inkSoft }}>
          {sub}
        </p>
      )}
    </div>
  );
}

export default function StatsPage() {
  const [totals, setTotals] = useState<Totals | null>(null);
  const [failures, setFailures] = useState<{ failure_type: string; n: string }[]>([]);
  const [channels, setChannels] = useState<{ channel: string; n: string; successful: string }[]>(
    []
  );
  const [recent, setRecent] = useState<Call[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/stats', { cache: 'no-store' });
      const d = await res.json();
      if (d.totals) setTotals(d.totals);
      setFailures(d.failures ?? []);
      setChannels(d.channels ?? []);
      setRecent(d.recent ?? []);
    } catch {
      /* keep the last good numbers */
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 3000); // a finished call shows up on its own
    return () => clearInterval(id);
  }, [load]);

  const total = n(totals?.total);
  const ok = n(totals?.successful);
  const bad = n(totals?.failed);
  const finished = ok + bad;
  const rate = finished > 0 ? Math.round((ok / finished) * 100) : 0;

  return (
    <div className="min-h-svh w-full px-5 py-10" style={{ background: C.paper }}>
      <div className="mx-auto max-w-4xl">
        <div className="mb-2 flex items-center gap-3">
          <div
            className="flex size-9 items-center justify-center rounded-xl font-mono text-[13px] font-semibold"
            style={{ background: `${C.clay}1A`, color: C.clay }}
          >
            {'{ }'}
          </div>
          <h1 className="text-[26px] font-bold" style={{ color: C.ink }}>
            Nova · call analytics
          </h1>
        </div>
        <p className="mb-7 text-[14px]" style={{ color: C.inkSoft }}>
          A call succeeds when the student leaves with something concrete — a concept on screen, a
          problem to attempt, or a human found for them.
        </p>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Stat label="total calls" value={total} tint={C.ink} />
          <Stat label="successful" value={ok} tint={C.sage} sub={`${rate}% of finished calls`} />
          <Stat label="failed" value={bad} tint={C.rose} sub="did not reach the goal" />
        </div>

        {/* what students actually walked away with */}
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <Stat label="concepts taught" value={n(totals?.concepts_taught)} tint={C.sky} />
          <Stat label="problems given" value={n(totals?.problems_given)} tint={C.amber} />
          <Stat label="humans fetched" value={n(totals?.escalations)} tint={C.clay} />
          <Stat label="avg length" value={`${n(totals?.avg_duration_s)}s`} tint={C.ink} />
        </div>

        {failures.length > 0 && (
          <div
            className="mt-3 rounded-2xl px-5 py-5"
            style={{ background: C.card, border: `1px solid ${C.line}` }}
          >
            <p
              className="mb-3 font-mono text-[10px] tracking-[0.18em] uppercase"
              style={{ color: C.inkSoft }}
            >
              why calls failed
            </p>
            <div className="flex flex-col gap-2">
              {failures.map((f) => {
                const pct = bad > 0 ? Math.round((n(f.n) / bad) * 100) : 0;
                return (
                  <div key={f.failure_type} className="flex items-center gap-3">
                    <span className="w-56 shrink-0 text-[14px]" style={{ color: C.ink }}>
                      {FAILURE_LABEL[f.failure_type] ?? f.failure_type}
                    </span>
                    <div
                      className="h-2.5 flex-1 overflow-hidden rounded-full"
                      style={{ background: C.paper }}
                    >
                      <motion.div
                        className="h-full rounded-full"
                        style={{ background: C.rose }}
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                      />
                    </div>
                    <span
                      className="w-10 text-right font-mono text-[13px]"
                      style={{ color: C.inkSoft }}
                    >
                      {f.n}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {channels.length > 0 && (
          <div className="mt-3 flex gap-3">
            {channels.map((ch) => (
              <div
                key={ch.channel}
                className="flex-1 rounded-2xl px-5 py-4"
                style={{ background: C.card, border: `1px solid ${C.line}` }}
              >
                <p
                  className="font-mono text-[10px] tracking-[0.18em] uppercase"
                  style={{ color: C.inkSoft }}
                >
                  {ch.channel === 'phone' ? 'phone (SIP)' : 'browser'}
                </p>
                <p className="mt-1.5 font-mono text-[22px] font-bold" style={{ color: C.ink }}>
                  {ch.n}
                  <span className="ml-2 text-[13px] font-normal" style={{ color: C.sage }}>
                    {ch.successful} ok
                  </span>
                </p>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6">
          <p
            className="mb-3 font-mono text-[10px] tracking-[0.18em] uppercase"
            style={{ color: C.inkSoft }}
          >
            recent calls
          </p>

          {recent.length === 0 ? (
            <div
              className="rounded-2xl px-6 py-14 text-center"
              style={{ background: C.card, border: `1px solid ${C.line}` }}
            >
              <p className="text-[15px] font-semibold" style={{ color: C.ink }}>
                No calls yet
              </p>
              <p className="mt-2 text-[13px]" style={{ color: C.inkSoft }}>
                Start a conversation and it appears here the moment it ends.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <AnimatePresence initial={false}>
                {recent.map((c) => {
                  const live = c.outcome === null;
                  const good = c.outcome === 'success';
                  const tint = live ? C.amber : good ? C.sage : C.rose;
                  return (
                    <motion.div
                      key={c.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center gap-4 rounded-xl px-4 py-3"
                      style={{
                        background: C.card,
                        border: `1px solid ${C.line}`,
                        borderLeft: `4px solid ${tint}`,
                      }}
                    >
                      <span
                        className="w-20 shrink-0 font-mono text-[11px] font-bold uppercase"
                        style={{ color: tint }}
                      >
                        {live ? 'live' : good ? 'success' : 'failed'}
                      </span>
                      <span className="w-16 shrink-0 text-[12px]" style={{ color: C.inkSoft }}>
                        {c.channel}
                      </span>
                      <span className="w-12 shrink-0 text-[12px]" style={{ color: C.inkSoft }}>
                        {c.language ?? '—'}
                      </span>
                      <span
                        className="w-14 shrink-0 font-mono text-[12px]"
                        style={{ color: C.inkSoft }}
                      >
                        {c.duration_s ? `${c.duration_s}s` : '—'}
                      </span>
                      <span className="flex-1 text-[12.5px]" style={{ color: C.ink }}>
                        {c.concepts_taught > 0 && `${c.concepts_taught} taught `}
                        {c.problems_given > 0 && `${c.problems_given} problem `}
                        {c.escalations > 0 && `${c.escalations} escalated `}
                        {!good && c.failure_type && (
                          <span style={{ color: C.inkSoft }}>
                            {FAILURE_LABEL[c.failure_type] ?? c.failure_type}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-[11px]" style={{ color: C.inkSoft }}>
                        {new Date(c.started_at).toLocaleTimeString('en-IN', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-[11px]" style={{ color: C.inkSoft }}>
          Counters and timings only. No transcripts, no phone numbers, no student content.
        </p>
      </div>
    </div>
  );
}
