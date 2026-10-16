'use client';

import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { C } from '@/components/nova/canvas';

/**
 * The teacher's desk.
 *
 * Everything Nova could not handle itself, most urgent first. Deliberately
 * plain: someone glancing at this between classes needs to see who needs help
 * and how badly, not a dashboard.
 */

type Request = {
  ref: string;
  student: string | null;
  reason: string;
  urgency: 'low' | 'medium' | 'high' | 'emergency';
  summary: string;
  already_tried: string | null;
  language: string | null;
  follow_up: string | null;
  status: 'open' | 'in_progress' | 'resolved';
  created_at: string;
};

const URGENCY: Record<string, { label: string; tint: string }> = {
  emergency: { label: 'EMERGENCY', tint: '#B5695F' },
  high: { label: 'HIGH', tint: '#C4704F' },
  medium: { label: 'MEDIUM', tint: '#C89B4A' },
  low: { label: 'LOW', tint: '#6F9E82' },
};

const REASON: Record<string, string> = {
  wellbeing: 'student wellbeing',
  teacher: 'needs a teacher',
};

const NEXT: Record<string, Request['status']> = {
  open: 'in_progress',
  in_progress: 'resolved',
  resolved: 'open',
};

export default function DeskPage() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/desk', { cache: 'no-store' });
      const data = await res.json();
      setRequests(data.requests ?? []);
    } catch {
      /* keep whatever we had */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 4000); // new requests appear while you watch
    return () => clearInterval(id);
  }, [load]);

  async function advance(r: Request) {
    await fetch('/api/desk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: r.ref, status: NEXT[r.status] }),
    });
    load();
  }

  const open = requests.filter((r) => r.status !== 'resolved').length;

  return (
    <div className="min-h-svh w-full px-5 py-10" style={{ background: C.paper }}>
      <div className="mx-auto max-w-3xl">
        <div className="mb-7 flex items-end justify-between">
          <div>
            <h1 className="text-[26px] font-bold" style={{ color: C.ink }}>
              Teacher&apos;s desk
            </h1>
            <p className="mt-1 text-[14px]" style={{ color: C.inkSoft }}>
              Students Nova handed over. Most urgent first.
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-[26px] font-bold" style={{ color: C.clay }}>
              {open}
            </p>
            <p
              className="font-mono text-[10px] tracking-[0.18em] uppercase"
              style={{ color: C.inkSoft }}
            >
              waiting
            </p>
          </div>
        </div>

        {loaded && requests.length === 0 && (
          <div
            className="rounded-2xl px-6 py-16 text-center"
            style={{ background: C.card, border: `1px solid ${C.line}` }}
          >
            <p className="text-[16px] font-semibold" style={{ color: C.ink }}>
              Nothing waiting
            </p>
            <p className="mt-2 text-[14px]" style={{ color: C.inkSoft }}>
              Nova has not needed a human yet. Requests appear here the moment a student agrees to
              send one.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-3">
          <AnimatePresence initial={false}>
            {requests.map((r) => {
              const u = URGENCY[r.urgency] ?? URGENCY.medium;
              const done = r.status === 'resolved';
              return (
                <motion.div
                  key={r.ref}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: done ? 0.55 : 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="rounded-2xl p-5"
                  style={{
                    background: C.card,
                    border: `1px solid ${C.line}`,
                    borderLeft: `4px solid ${u.tint}`,
                  }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2.5">
                        <span
                          className="rounded-md px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider"
                          style={{ background: `${u.tint}1F`, color: u.tint }}
                        >
                          {u.label}
                        </span>
                        <span className="text-[13px]" style={{ color: C.inkSoft }}>
                          {REASON[r.reason] ?? r.reason}
                        </span>
                      </div>
                      <p className="mt-2.5 text-[16px] font-semibold" style={{ color: C.ink }}>
                        {r.student ?? 'Unnamed student'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-[15px] font-bold" style={{ color: C.ink }}>
                        {r.ref}
                      </p>
                      <p className="mt-0.5 text-[11px]" style={{ color: C.inkSoft }}>
                        {new Date(r.created_at).toLocaleString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </div>

                  <p className="mt-3 text-[15px] leading-relaxed" style={{ color: C.ink }}>
                    {r.summary}
                  </p>

                  {r.already_tried && (
                    <div className="mt-3 rounded-xl px-3.5 py-2.5" style={{ background: C.paper }}>
                      <p
                        className="font-mono text-[9px] tracking-[0.16em] uppercase"
                        style={{ color: C.inkSoft }}
                      >
                        Nova already tried
                      </p>
                      <p className="mt-1 text-[14px]" style={{ color: C.ink }}>
                        {r.already_tried}
                      </p>
                    </div>
                  )}

                  <div className="mt-4 flex items-center justify-between">
                    <p className="text-[12px]" style={{ color: C.inkSoft }}>
                      {r.language && `speaks ${r.language}`}
                      {r.follow_up ? ` · prefers ${r.follow_up}` : ''}
                    </p>
                    <button
                      onClick={() => advance(r)}
                      className="rounded-xl px-4 py-2 text-[13px] font-semibold transition hover:brightness-[0.97]"
                      style={
                        done
                          ? { background: C.paper, border: `1px solid ${C.line}`, color: C.inkSoft }
                          : { background: C.clay, color: 'white' }
                      }
                    >
                      {r.status === 'open'
                        ? 'Pick this up'
                        : r.status === 'in_progress'
                          ? 'Mark resolved'
                          : 'Reopen'}
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
