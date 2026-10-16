'use client';

import { useEffect, useState } from 'react';
import { Room, RoomEvent } from 'livekit-client';
import { AnimatePresence, motion } from 'motion/react';
import { C, Canvas, type CanvasPayload } from '@/components/nova/canvas';

/**
 * Live view of a phone call.
 *
 * Open this in a browser, place an outbound call, and watch it happen: who is
 * speaking, the transcript as it lands, and any code or flowcharts Nova pushes
 * to the student. Nothing is published from here — it is a window, not a seat
 * at the table.
 *
 * It polls until a call appears, so you can leave it open and start recording
 * before you dial.
 */

type Line = { id: string; who: 'nova' | 'caller'; text: string; at: number };

const STATUS: Record<string, { te: string; en: string; tint: string }> = {
  listening: { te: 'వింటుంది', en: 'listening to caller', tint: C.sage },
  thinking: { te: 'ఆలోచిస్తుంది', en: 'thinking', tint: C.amber },
  speaking: { te: 'నోవా మాట్లాడుతుంది', en: 'nova is speaking', tint: C.sky },
  idle: { te: 'వేచి ఉంది', en: 'idle', tint: C.inkSoft },
};

export default function MonitorPage() {
  const [phase, setPhase] = useState<'waiting' | 'live' | 'ended'>('waiting');
  const [roomName, setRoomName] = useState('');
  const [phone, setPhone] = useState('');
  const [agentState, setAgentState] = useState('idle');
  const [lines, setLines] = useState<Line[]>([]);
  const [canvas, setCanvas] = useState<CanvasPayload[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(id);
  }, [startedAt]);

  useEffect(() => {
    let room: Room | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      if (stopped) return;
      try {
        const res = await fetch('/api/monitor', { cache: 'no-store' });
        const data = await res.json();

        if (data.waiting || !data.participantToken) {
          timer = setTimeout(poll, 1500);
          return;
        }

        room = new Room();

        room.on(RoomEvent.ParticipantAttributesChanged, () => {
          const agent = [...room!.remoteParticipants.values()].find(
            (p) => p.attributes?.['lk.agent.state']
          );
          if (agent) setAgentState(agent.attributes['lk.agent.state'] ?? 'idle');
        });

        room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
          const fromNova = participant?.identity?.startsWith('phone-') === false;
          setLines((prev) => {
            const next = [...prev];
            for (const s of segments) {
              if (!s.text?.trim()) continue;
              const key = `${fromNova ? 'nova' : 'caller'}:${s.text.trim()}`;
              if (next.some((l) => `${l.who}:${l.text.trim()}` === key)) continue;
              next.push({
                id: s.id,
                who: fromNova ? 'nova' : 'caller',
                text: s.text,
                at: s.firstReceivedTime ?? Date.now(),
              });
            }
            return next.sort((a, b) => a.at - b.at);
          });
        });

        room.on(RoomEvent.DataReceived, (payload, _p, _k, topic) => {
          if (topic !== 'nova-canvas') return;
          try {
            const item = JSON.parse(new TextDecoder().decode(payload)) as CanvasPayload;
            setCanvas((prev) => (item.kind === 'clear' ? [] : [...prev, item]));
          } catch {
            /* ignore malformed frames */
          }
        });

        room.on(RoomEvent.ParticipantConnected, (p) => {
          if (p.identity.startsWith('phone-')) setPhone(p.identity.replace('phone-', ''));
        });

        room.on(RoomEvent.Disconnected, () => setPhase('ended'));

        await room.connect(data.serverUrl, data.participantToken);
        // Note who is on the phone. Tracks auto-subscribe, and we never play
        // them — this is a silent window onto the call.
        room.remoteParticipants.forEach((p) => {
          if (p.identity.startsWith('phone-')) setPhone(p.identity.replace('phone-', ''));
        });

        setRoomName(data.roomName);
        setStartedAt(Date.now());
        setPhase('live');
      } catch {
        timer = setTimeout(poll, 2000);
      }
    }

    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      room?.disconnect();
    };
  }, []);

  const status = STATUS[agentState] ?? STATUS.idle;
  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;

  return (
    <div className="flex h-svh w-full flex-col lg:flex-row" style={{ background: C.paper }}>
      <aside
        className="flex w-full shrink-0 flex-col px-6 py-6 lg:h-svh lg:w-[400px]"
        style={{ borderRight: `1px solid ${C.line}`, background: C.card }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex size-10 items-center justify-center rounded-xl font-mono text-sm font-semibold"
            style={{ background: `${C.clay}1A`, color: C.clay }}
          >
            {'{ }'}
          </div>
          <div className="flex-1">
            <p className="text-[16px] font-bold" style={{ color: C.ink }}>
              నోవా · phone call
            </p>
            <p
              className="font-mono text-[10px] tracking-[0.16em] uppercase"
              style={{ color: C.inkSoft }}
            >
              live monitor
            </p>
          </div>
          {phase === 'live' && (
            <span className="font-mono text-[13px] font-semibold" style={{ color: C.ink }}>
              {mmss}
            </span>
          )}
        </div>

        {phase === 'waiting' && (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <div className="mb-5 flex gap-2">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="size-2 rounded-full"
                  style={{ background: C.clay }}
                  animate={{ opacity: [0.2, 1, 0.2] }}
                  transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                />
              ))}
            </div>
            <p className="text-[16px] font-semibold" style={{ color: C.ink }}>
              కాల్ కోసం చూస్తున్నా
            </p>
            <p className="mt-2 max-w-[16rem] text-[13px]" style={{ color: C.inkSoft }}>
              Waiting for an outbound call. Start one and it appears here.
            </p>
          </div>
        )}

        {phase !== 'waiting' && (
          <>
            <div
              className="mt-5 rounded-2xl px-4 py-3"
              style={{ background: C.paper, border: `1px solid ${C.line}` }}
            >
              <p
                className="font-mono text-[10px] tracking-[0.16em] uppercase"
                style={{ color: C.inkSoft }}
              >
                calling
              </p>
              <p className="mt-1 font-mono text-[17px] font-bold" style={{ color: C.ink }}>
                {phone || '—'}
              </p>
              <p className="mt-1 font-mono text-[10px]" style={{ color: C.inkSoft }}>
                {roomName}
              </p>
            </div>

            <div className="mt-4 flex flex-col items-center">
              <div
                className="flex items-center gap-2.5 rounded-full px-4 py-2"
                style={{ background: `${status.tint}18` }}
              >
                <motion.span
                  className="size-2 rounded-full"
                  style={{ background: status.tint }}
                  animate={{ opacity: [1, 0.25, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
                <span className="text-[14px] font-semibold" style={{ color: status.tint }}>
                  {phase === 'ended' ? 'కాల్ అయిపోయింది' : status.te}
                </span>
              </div>
              <p
                className="mt-2 font-mono text-[10px] tracking-[0.18em] uppercase"
                style={{ color: C.inkSoft }}
              >
                {phase === 'ended' ? 'call ended' : status.en}
              </p>
            </div>

            <div
              className="mt-4 min-h-0 flex-1 overflow-y-auto rounded-2xl p-3.5"
              style={{ background: C.paper, border: `1px solid ${C.line}` }}
            >
              {lines.length === 0 ? (
                <p className="pt-10 text-center text-[13px]" style={{ color: C.inkSoft }}>
                  transcript appears here
                </p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  <AnimatePresence initial={false}>
                    {lines.map((l) => (
                      <motion.div
                        key={l.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={l.who === 'caller' ? 'text-right' : 'text-left'}
                      >
                        <span
                          className="mb-1 block font-mono text-[9px] tracking-[0.14em] uppercase"
                          style={{ color: C.inkSoft }}
                        >
                          {l.who === 'caller' ? 'caller' : 'నోవా'}
                        </span>
                        <span
                          className="inline-block max-w-[88%] rounded-xl px-3 py-1.5 text-[14px] leading-relaxed"
                          style={
                            l.who === 'caller'
                              ? { background: '#EFE7DA', color: C.ink }
                              : { background: `${C.sky}1A`, color: C.ink }
                          }
                        >
                          {l.text}
                        </span>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </>
        )}
      </aside>

      <section className="min-h-0 flex-1">
        <Canvas items={canvas} />
      </section>
    </div>
  );
}
