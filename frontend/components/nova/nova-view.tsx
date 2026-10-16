'use client';

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ConnectionState, Track } from 'livekit-client';
import { AnimatePresence, motion, useDragControls } from 'motion/react';
import {
  useAgent,
  useDataChannel,
  useMaybeRoomContext,
  useSessionContext,
  useSessionMessages,
  useTrackToggle,
  useTrackTranscription,
} from '@livekit/components-react';
import Link from 'next/link';
import { ChartLineUpIcon, HouseIcon, MicrophoneIcon, MicrophoneSlashIcon, PlusIcon } from '@phosphor-icons/react';
import { clearArchive, loadBoard } from '@/components/nova/board/archive';
import { Board } from '@/components/nova/board/board';
import { CanvasErrorBoundary } from '@/components/nova/board/error-boundary';
import { Canvas, type CanvasPayload } from '@/components/nova/canvas';
import {
  LANGS,
  type Lang,
  LangContext,
  readLangCookie,
  useT,
  writeLangCookie,
} from '@/components/nova/i18n';

/**
 * Day 3 frontend for Nova — a Computer Science companion for Telugu-speaking
 * students.
 *
 * Five screens, one per required state:
 *
 *   ready       -> one obvious button, nothing else competing with it
 *   connecting  -> explicit "wait", because the agent takes a moment to join
 *   live        -> who is speaking, right now, unmissable
 *   ended       -> what happened + an obvious way back in
 *   mic-error   -> what went wrong and exactly how to fix it
 *
 * Visual language: warm paper background, one soft card, muted earth tones.
 * A student uses this late at night when something is already going wrong, so
 * the interface stays quiet — no hard contrast, no glow, nothing shouting.
 */

type Screen = 'ready' | 'connecting' | 'live' | 'ended' | 'mic-error';

// Comfort palette — muted, warm, low-contrast.
const C = {
  paper: '#F6F1E9',
  card: '#FFFDFA',
  ink: '#4A4038',
  inkSoft: '#8C8177',
  line: '#E8DFD2',
  clay: '#C4704F', // primary action
  sage: '#6F9E82', // listening
  sky: '#5B7FA6', // speaking
  amber: '#C89B4A', // thinking
  rose: '#B5695F', // end / error
};

/**
 * Day 9: each agent gets its own skin, not just its own accent colour.
 *
 * The paper, the card, the panel edge and the bar colours all shift together,
 * so a handoff is unmistakable even with the sound off. Every palette stays
 * inside the same warm, low-contrast family — this should feel like the same
 * product handing you to a colleague, not four different apps.
 */
type AgentTheme = {
  paper: string;
  card: string;
  edge: string;
  accent: string;
  bubble: string;
};

const THEMES: Record<string, AgentTheme> = {
  // Nova — warm terracotta on cream. The home state.
  nova: {
    paper: '#F6F1E9',
    card: '#FFFDFA',
    edge: '#E8DFD2',
    accent: '#C4704F',
    bubble: '#EFE7DA',
  },
  // Algo — cooler, bluer paper. Sharper, more technical.
  algo: {
    paper: '#EEF2F6',
    card: '#FBFDFF',
    edge: '#D8E2EC',
    accent: '#5B7FA6',
    bubble: '#DFE8F1',
  },
  // Keerthi — green, softest of the four. You are already stressed.
  keerthi: {
    paper: '#EEF4EF',
    card: '#FBFDFB',
    edge: '#D7E5DB',
    accent: '#6F9E82',
    bubble: '#DEEBE2',
  },
  // Vikram — amber, a shade more formal. Interview room.
  vikram: {
    paper: '#F7F2E6',
    card: '#FFFDF7',
    edge: '#EADFC6',
    accent: '#B98A32',
    bubble: '#F0E5CE',
  },
};

const themeFor = (id: string) => THEMES[id] ?? THEMES.nova;

const AGENT_NAME: Record<string, string> = {
  nova: 'Nova',
  algo: 'Algo',
  keerthi: 'Keerthi',
  vikram: 'Vikram',
};

// ---------------------------------------------------------------------------
// Microphone permission
// ---------------------------------------------------------------------------

type MicError = 'denied' | 'notfound' | 'other';

/** Ask for the mic BEFORE connecting, so a refusal is a clean screen and not a
 *  half-joined call the student has to figure out. */
async function requestMic(): Promise<MicError | null> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) return 'other';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop()); // LiveKit opens its own track
    return null;
  } catch (err) {
    const name = (err as DOMException)?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'notfound';
    return 'other';
  }
}

// ---------------------------------------------------------------------------
// Shared chrome
// ---------------------------------------------------------------------------

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex min-h-svh w-full items-center justify-center px-5 py-10"
      style={{ background: C.paper }}
    >
      <div
        className="w-full max-w-md rounded-3xl px-9 py-12"
        style={{
          background: C.card,
          border: `1px solid ${C.line}`,
          boxShadow: '0 1px 2px rgba(74,64,56,0.04), 0 12px 32px rgba(74,64,56,0.07)',
        }}
      >
        <div className="flex flex-col items-center">{children}</div>
      </div>
    </div>
  );
}

function Mark({ tint = C.clay, pulse = false }: { tint?: string; pulse?: boolean }) {
  return (
    <div className="relative mb-6 flex size-16 items-center justify-center">
      {pulse && (
        <motion.span
          className="absolute inset-0 rounded-full"
          style={{ background: tint, opacity: 0.16 }}
          animate={{ scale: [1, 1.35, 1], opacity: [0.18, 0.04, 0.18] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
      <div
        className="relative flex size-16 items-center justify-center rounded-full font-mono text-xl font-semibold"
        style={{ background: `${tint}1A`, color: tint }}
      >
        AA
      </div>
    </div>
  );
}

/** Soft rounded bars. Calm when idle, lively when the agent speaks. */
function Bars({ tint, active }: { tint: string; active: boolean }) {
  const heights = [16, 30, 42, 30, 16];
  return (
    <div className="flex h-14 items-center justify-center gap-2">
      {heights.map((h, i) => (
        <motion.span
          key={i}
          className="w-2.5 rounded-full"
          style={{ background: tint, opacity: active ? 0.9 : 0.28 }}
          animate={
            active ? { height: [h * 0.45, h, h * 0.55, h * 0.9, h * 0.45] } : { height: h * 0.4 }
          }
          transition={
            active
              ? { duration: 1.1, repeat: Infinity, delay: i * 0.09, ease: 'easeInOut' }
              : { duration: 0.4 }
          }
        />
      ))}
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  tint = C.clay,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tint?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-2xl py-4 text-[17px] font-semibold text-white transition hover:brightness-[1.06] active:scale-[0.985]"
      style={{ background: tint, boxShadow: `0 6px 16px ${tint}33` }}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// 1. READY
// ---------------------------------------------------------------------------

function ReadyScreen({ onStart, onOpen }: { onStart: () => void; onOpen: (c: Chat) => void }) {
  const t = useT();
  return (
    <Shell>
      <Mark />
      <p className="font-mono text-[10px] tracking-[0.22em] uppercase" style={{ color: C.inkSoft }}>
        {t.tagline}
      </p>
      <h1 className="mt-2.5 text-[32px] font-bold" style={{ color: C.ink }}>
        Agent Acharya
      </h1>
      <p
        className="mt-3 mb-9 max-w-[18rem] text-center text-[15px] leading-relaxed"
        style={{ color: C.inkSoft }}
      >
        {t.readyBody}
      </p>

      <div className="mb-4 w-full">
        <LanguagePicker />
      </div>
      <PrimaryButton onClick={onStart}>{t.start}</PrimaryButton>

      <p className="mt-4 text-[12px]" style={{ color: C.inkSoft }}>
        {t.micNote}
      </p>
      <ChatHistory onOpen={onOpen} />
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// 2. CONNECTING
// ---------------------------------------------------------------------------

function ConnectingScreen() {
  const t = useT();
  return (
    <Shell>
      <Mark pulse />
      <h2 className="text-[22px] font-bold" style={{ color: C.ink }}>
        {t.connecting}
      </h2>
      <p className="mt-2 text-center text-[15px]" style={{ color: C.inkSoft }}>
        {t.connectingBody}
      </p>
      <div className="mt-7 flex gap-2" aria-hidden>
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
      <p
        className="mt-7 font-mono text-[10px] tracking-[0.22em] uppercase"
        style={{ color: C.inkSoft }}
      >
        connecting
      </p>
    </Shell>
  );
}

type Line = { id: string; mine: boolean; text: string; at: number };

// ---------------------------------------------------------------------------
// Chat history — kept in this browser across classes
// ---------------------------------------------------------------------------

type Saved = Line & { who: string };
type Chat = { id: string; at: number; lines: Saved[] };
const CHATS_KEY = 'aa_chats';
const OLD_HISTORY_KEY = 'aa_chat_history'; // flat log from before chats existed

function loadChats(): Chat[] {
  try {
    const chats = JSON.parse(localStorage.getItem(CHATS_KEY) ?? '[]') as Chat[];
    const old = localStorage.getItem(OLD_HISTORY_KEY);
    if (old) {
      const lines = JSON.parse(old) as Saved[];
      if (lines.length) chats.push({ id: 'earlier', at: lines[0].at || 0, lines });
      localStorage.removeItem(OLD_HISTORY_KEY);
      localStorage.setItem(CHATS_KEY, JSON.stringify(chats));
    }
    return chats.sort((x, y) => y.at - x.at);
  } catch {
    return [];
  }
}

function saveChat(chat: Chat) {
  try {
    const rest = loadChats().filter((c) => c.id !== chat.id);
    localStorage.setItem(CHATS_KEY, JSON.stringify([chat, ...rest].slice(0, 30)));
  } catch {
    /* storage full or blocked: history is a convenience, not a requirement */
  }
}

function clearChats() {
  try {
    localStorage.removeItem(CHATS_KEY);
  } catch {
    /* ignore */
  }
}

/** Previous chats, newest first; click one to read it. */
function ChatHistory({ onOpen }: { onOpen: (chat: Chat) => void }) {
  const t = useT();
  const [chats, setChats] = useState<Chat[]>([]);
  useEffect(() => setChats(loadChats()), []);
  if (!chats.length) return null;
  return (
    <div className="mt-7 w-full">
      <div className="mb-2 flex items-center justify-between">
        <p
          className="font-mono text-[10px] tracking-[0.18em] uppercase"
          style={{ color: C.inkSoft }}
        >
          {t.history}
        </p>
        <button
          onClick={() => {
            clearChats();
            void clearArchive();
            setChats([]);
          }}
          className="text-[12px] underline"
          style={{ color: C.inkSoft }}
        >
          {t.clearHistory}
        </button>
      </div>
      <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
        {chats.map((c) => {
          const first = c.lines.find((l) => l.mine)?.text || c.lines[0]?.text || '…';
          return (
            <div
              key={c.id}
              className="rounded-2xl"
              style={{ background: C.paper, border: `1px solid ${C.line}` }}
            >
              <button
                onClick={() => onOpen(c)}
                className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left"
              >
                <span
                  className="min-w-0 flex-1 truncate text-[14px] font-semibold"
                  style={{ color: C.ink }}
                >
                  {first}
                </span>
                <span className="shrink-0 font-mono text-[10px]" style={{ color: C.inkSoft }}>
                  {c.at
                    ? new Date(c.at).toLocaleDateString([], { day: 'numeric', month: 'short' })
                    : ''}
                  {' · '}
                  {c.lines.length}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HistoryLine({ line, dim }: { line: Saved; dim?: boolean }) {
  return (
    <div className={line.mine ? 'text-right' : 'text-left'} style={{ opacity: dim ? 0.6 : 1 }}>
      <span
        className="mb-1 block font-mono text-[9px] tracking-[0.14em] uppercase"
        style={{ color: C.inkSoft }}
      >
        {line.who}
      </span>
      <span
        className="inline-block max-w-[88%] rounded-xl px-3 py-1.5 text-[14px] leading-relaxed"
        style={{ background: line.mine ? C.line : `${C.clay}1A`, color: C.ink }}
      >
        {line.text}
      </span>
    </div>
  );
}

/** Collapse repeats of the same speaker saying the same thing.
 *  Interim and final segments can arrive under different ids. */
function dedupe(lines: Line[]): Line[] {
  const seen = new Set<string>();
  const out: Line[] = [];
  for (const line of lines) {
    const key = `${line.mine}:${line.text.trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. LIVE — listening / thinking / speaking
// ---------------------------------------------------------------------------

const STATUS: Record<
  string,
  { key: 'listening' | 'thinking' | 'speaking'; en: string; tint: string }
> = {
  listening: { key: 'listening', en: 'listening to you', tint: C.sage },
  thinking: { key: 'thinking', en: 'thinking', tint: C.amber },
  speaking: { key: 'speaking', en: 'agent is speaking', tint: C.sky },
};

/** Square control: icon on top, a short label underneath. */
function ControlButton({
  label,
  onClick,
  edge,
  paper,
  alert = false,
  children,
}: {
  label: string;
  onClick: () => void;
  edge: string;
  paper: string;
  alert?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex h-[60px] w-[62px] shrink-0 flex-col items-center justify-center gap-1 rounded-2xl transition hover:brightness-[0.97] active:scale-[0.97]"
      style={{
        background: alert ? `${C.rose}14` : paper,
        border: `1px solid ${alert ? `${C.rose}55` : edge}`,
        color: alert ? C.rose : C.ink,
      }}
    >
      {children}
      <span className="w-full truncate px-1 text-center text-[10.5px] leading-none font-semibold">
        {label}
      </span>
    </button>
  );
}

function LiveScreen({
  chatId,
  resume,
  onHome,
  onNewChat,
  onEnd,
  canvas,
  agent: who,
  handoffs,
}: {
  chatId: string;
  resume: Chat | null;
  onHome: () => void;
  onNewChat: () => void;
  onEnd: () => void;
  canvas: CanvasPayload[];
  agent: { id: string; name: string; role: string; tint: string; lang: string };
  handoffs: { id: string; from: string; to: string; reason: string; at: number }[];
}) {
  const agent = useAgent();
  const session = useSessionContext();
  const tr = useT();

  const [activeBoard, setActiveBoard] = useState('b1');
  const [sendingAction, setSendingAction] = useState(false);
  const actionInFlight = useRef(false);
  const [actionFeedback, setActionFeedback] = useState<'sent' | 'failed' | null>(null);
  useEffect(() => {
    if (!actionFeedback) return;
    const timer = setTimeout(() => setActionFeedback(null), 5000);
    return () => clearTimeout(timer);
  }, [actionFeedback]);
  const requestLearningAction = async (action: 'simplify' | 'example' | 'check') => {
    if (!session.room || !session.isConnected || !agent.isConnected || actionInFlight.current) return;
    actionInFlight.current = true;
    setSendingAction(true);
    setActionFeedback(null);
    try {
      await session.room.localParticipant.sendText(
        JSON.stringify({ type: 'learning_action', action, board: activeBoard }),
        { topic: 'nova-board-student' }
      );
      setActionFeedback('sent');
    } catch {
      setActionFeedback('failed');
    } finally {
      actionInFlight.current = false;
      setSendingAction(false);
    }
  };

  // Transcripts come straight off the audio tracks. useSessionMessages only
  // carries typed chat, so on a voice-only call it stays empty — reading the
  // tracks is what actually produces a live transcript.
  const agentTrack = agent.isConnected ? agent.microphoneTrack : undefined;
  const localTrack = session.isConnected ? session.local.microphoneTrack : undefined;
  const { segments: agentSegments } = useTrackTranscription(agentTrack);
  const { segments: userSegments } = useTrackTranscription(localTrack);

  // Track segments are the only source. Session messages are NOT merged in:
  // with text_output enabled the agent publishes each utterance as a message
  // as well, so including both prints every line twice.
  const lines = dedupe(
    [
      ...userSegments.map((sg) => ({
        id: `u-${sg.id}`,
        mine: true,
        text: sg.text,
        at: sg.firstReceivedTime,
        final: sg.final,
      })),
      ...agentSegments.map((sg) => ({
        id: `a-${sg.id}`,
        mine: false,
        text: sg.text,
        at: sg.firstReceivedTime,
        final: sg.final,
      })),
    ]
      .filter((l) => l.text?.trim())
      .sort((a, b) => a.at - b.at)
  );
  // This class is its own chat, saved as it happens. A continued chat keeps
  // its earlier lines in front.
  const previous = useMemo(() => resume?.lines ?? [], [resume]);
  useEffect(() => {
    if (!lines.length) return;
    saveChat({
      id: chatId,
      at: previous[0]?.at || lines[0].at || Date.now(),
      lines: [...previous, ...lines.map((l) => ({ ...l, who: l.mine ? tr.you : who.name }))],
    });
  }, [lines, previous, chatId, tr.you, who.name]);

  // Continuing a chat: once the teacher is in the room, hand it the old
  // conversation and board so it can pick up where it left off.
  const handedOver = useRef(false);
  useEffect(() => {
    if (!resume || handedOver.current || !agent.isConnected || !session.room) return;
    handedOver.current = true;
    const room = session.room;
    void (async () => {
      const saved = await loadBoard<{ book: unknown }>(chatId);
      const transcript = resume.lines
        .slice(-40)
        .map((l) => `${l.mine ? 'Student' : 'Teacher'}: ${l.text}`)
        .join('\n');
      await room.localParticipant
        .sendText(JSON.stringify({ type: 'resume', transcript, book: saved?.book }), {
          topic: 'nova-board-student',
        })
        .catch(() => {});
    })();
  }, [resume, agent.isConnected, session.room, chatId]);

  const { toggle: toggleMic, enabled: micOn } = useTrackToggle({
    source: Track.Source.Microphone,
  });

  const state = agent.state === 'connecting' ? 'thinking' : agent.state;
  const status = STATUS[state] ?? STATUS.thinking;

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [lines.length]);

  const latestAgentSpeech = useMemo(
    () => lines.filter((l) => !l.mine).slice(-1)[0]?.text,
    [lines]
  );

  // The speech card starts above the dock, but a student can move it away
  // from whatever they are studying. Dragging is intentionally header-only
  // so the transcript remains selectable and scrollable.
  const speechRef = useRef<HTMLDivElement>(null);
  const speechDragControls = useDragControls();
  const [speechDragBounds, setSpeechDragBounds] = useState({ top: -800, right: 320, bottom: 0, left: -320 });
  useEffect(() => {
    const updateBounds = () => {
      const card = speechRef.current?.getBoundingClientRect();
      if (!card) return;
      setSpeechDragBounds({
        top: Math.min(0, 16 - card.top),
        right: Math.max(0, window.innerWidth - card.right - 16),
        bottom: 0, // preserve the dock's clear interaction area
        left: Math.min(0, 16 - card.left),
      });
    };
    updateBounds();
    window.addEventListener('resize', updateBounds);
    return () => window.removeEventListener('resize', updateBounds);
  }, [latestAgentSpeech]);

  const t = themeFor(who.id);
  const [needsLandscape, setNeedsLandscape] = useState(false);
  useEffect(() => {
    const portraitPhone = window.matchMedia('(max-width: 767px) and (orientation: portrait) and (pointer: coarse)');
    const updateOrientation = () => setNeedsLandscape(portraitPhone.matches);
    updateOrientation();
    portraitPhone.addEventListener('change', updateOrientation);
    return () => portraitPhone.removeEventListener('change', updateOrientation);
  }, []);

  // Handoffs sit inside the transcript, in sequence, so the student can see
  // exactly where the conversation changed hands and why.
  const feed = [
    ...lines.map((l) => ({ kind: 'line' as const, at: l.at, line: l })),
    ...handoffs.map((h) => ({ kind: 'handoff' as const, at: h.at, handoff: h })),
  ].sort((a, b) => a.at - b.at);

  return (
    <div className="nova-lesson relative flex flex-col h-svh w-full overflow-hidden" style={{ background: t.paper }}>
      {needsLandscape && (
        <div role="status" style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, textAlign: 'center', background: t.paper, color: C.ink }}>
          <span aria-hidden="true" className="text-4xl">↻</span>
          <h2 className="text-xl font-semibold">Rotate your phone to continue</h2>
          <p>Use landscape mode for a readable whiteboard and lesson controls.</p>
        </div>
      )}
      {/* Miro / Whiteboard Canvas: Allocated 100% of the viewport above the dock */}
      <main className="flex-1 min-h-0 w-full relative overflow-hidden" style={{ visibility: needsLandscape ? 'hidden' : undefined }}>
        <CanvasErrorBoundary name="Whiteboard Canvas">
          <Board
            chatId={chatId}
            restore={!!resume}
            lines={lines}
            onActiveBoardChange={setActiveBoard}
            fallback={canvas.length ? <Canvas items={canvas} /> : undefined}
            isSpeaking={agent.state === 'speaking'}
            isListening={agent.state === 'listening' || (session.local.microphoneTrack?.publication ? !session.local.microphoneTrack.publication.isMuted : false)}
            roomState={session.room?.state}
          />
        </CanvasErrorBoundary>

        {/* Live speech explanation banner - shown only in fallback canvas mode; whiteboard renders on-canvas speech */}
        <AnimatePresence>
          {latestAgentSpeech && canvas.length > 0 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 w-[92%] max-w-2xl pointer-events-none">
              <motion.div
                ref={speechRef}
                key="live-speech-card"
                initial={{ opacity: 0, y: 15, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.97 }}
                transition={{ duration: 0.25 }}
                drag
                dragControls={speechDragControls}
                dragListener={false}
                dragConstraints={speechDragBounds}
                dragElastic={0}
                dragMomentum={false}
                className="w-full pointer-events-auto"
              >
                <div
                  className="flex items-start gap-3 rounded-2xl px-5 py-3 shadow-2xl backdrop-blur-xl border"
                  style={{
                    background: 'rgba(255, 253, 250, 0.96)',
                    borderColor: '#E8DFD2',
                    boxShadow: '0 16px 36px -8px rgba(74, 64, 56, 0.16), 0 3px 10px rgba(74, 64, 56, 0.06)',
                  }}
                >
                  <div
                    className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                    style={{ background: `${who.tint}22`, color: who.tint }}
                    title="Acharya speaking"
                  >
                    AA
                  </div>
                  <div className="min-w-0 flex-1">
                    <div
                      className="mb-0.5 flex items-center justify-between cursor-grab active:cursor-grabbing touch-none select-none"
                      onPointerDown={(event) => speechDragControls.start(event)}
                      title="Drag to move this speech card"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[10px] font-bold tracking-wider uppercase text-[#8C8177]">
                          {who.name} Speaking
                        </span>
                        <span className="inline-block size-1.5 rounded-full bg-[#C4704F] animate-pulse" />
                      </div>
                    </div>
                    <p
                      className="text-[14px] leading-relaxed select-text font-medium text-[#2B3A55] max-h-24 overflow-y-auto"
                      style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}
                    >
                      {latestAgentSpeech}
                    </p>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>

      {/* Reserved Dock Viewport Footer (never overlays whiteboard canvas; respects safe areas) */}
      <footer
        className="nova-lesson-footer shrink-0 z-40 flex flex-col items-center gap-1.5 w-full px-4 pt-1.5 pb-[max(0.6rem,env(safe-area-inset-bottom))] border-t backdrop-blur-xl"
        style={{
          backgroundColor: `${t.paper}FA`,
          borderColor: t.edge,
          visibility: needsLandscape ? 'hidden' : undefined,
        }}
      >
        <div className="w-full max-w-xl">
          <div
            role="group"
            aria-label={tr.learningActions}
            className="flex flex-wrap justify-center gap-2"
          >
            {([
              ['simplify', tr.explainSimply],
              ['example', tr.giveExample],
              ['check', tr.checkUnderstanding],
            ] as const).map(([action, label]) => (
              <button
                key={action}
                type="button"
                onClick={() => void requestLearningAction(action)}
                disabled={sendingAction || !session.isConnected || !agent.isConnected || !(latestAgentSpeech || previous.some((line) => !line.mine))}
                className="min-h-9 rounded-xl border px-3 py-1.5 text-[12px] font-medium transition-colors hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: t.card, borderColor: t.edge, color: C.ink, outlineColor: C.ink }}
              >
                {label}
              </button>
            ))}
          </div>
          <p role="status" className="nova-action-feedback mt-0.5 min-h-3 text-center text-[11px]" style={{ color: C.ink }}>
            {sendingAction ? tr.sendingLearningRequest : actionFeedback === 'sent' ? tr.learningRequestSent : actionFeedback === 'failed' ? tr.learningRequestFailed : ''}
          </p>
        </div>

        {/* Dock Controls */}
        <div
          className="nova-lesson-dock flex items-center gap-2.5 px-4 py-2 rounded-full shadow-lg backdrop-blur-xl border"
          style={{
            backgroundColor: `${t.card}EE`,
            borderColor: t.edge,
            boxShadow: '0 8px 24px -4px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.04)',
          }}
        >
          {/* Teacher avatar & name */}
          <div className="flex items-center gap-2 pr-2.5 border-r" style={{ borderColor: t.edge }}>
            <div
              className="flex size-7 items-center justify-center rounded-full font-mono text-[11px] font-bold"
              style={{ background: `${who.tint}22`, color: who.tint }}
            >
              AA
            </div>
            <span className="text-[13px] font-bold hidden sm:inline" style={{ color: C.ink }}>
              {who.name}
            </span>
          </div>

          {/* Status & Audio Waveform */}
          <div
            className="flex items-center gap-2 px-3 py-1 rounded-full"
            style={{ background: `${status.tint}18` }}
          >
            <motion.span
              className="size-2 rounded-full"
              style={{ background: status.tint }}
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1.2, repeat: Infinity }}
            />
            <span className="text-[12px] font-semibold hidden md:inline" style={{ color: status.tint }}>
              {tr[status.key]}
            </span>
            <div className="nova-dock-waveform scale-75 origin-center">
              <Bars
                tint={state === 'thinking' ? t.accent : status.tint}
                active={state === 'speaking' || state === 'listening'}
              />
            </div>
          </div>

          {/* Mic Toggle */}
          <button
            onClick={() => toggleMic()}
            title={micOn ? tr.micOff : tr.micOn}
            className="flex size-9 items-center justify-center rounded-full transition active:scale-95"
            style={{
              background: !micOn ? `${C.rose}1A` : t.paper,
              border: `1px solid ${!micOn ? `${C.rose}55` : t.edge}`,
              color: !micOn ? C.rose : C.ink,
            }}
          >
            {micOn ? <MicrophoneIcon size={18} /> : <MicrophoneSlashIcon size={18} />}
          </button>

          {/* Language Selector */}
          <div className="scale-90 origin-center">
            <LanguagePicker />
          </div>

          {/* Home */}
          <button
            onClick={onHome}
            title={tr.home}
            className="flex size-9 items-center justify-center rounded-full transition hover:brightness-95 active:scale-95"
            style={{ background: t.paper, border: `1px solid ${t.edge}`, color: C.ink }}
          >
            <HouseIcon size={18} />
          </button>

          {/* Dashboard */}
          <Link
            href="/dashboard"
            title="Student Progress Dashboard"
            className="flex size-9 items-center justify-center rounded-full transition hover:brightness-95 active:scale-95"
            style={{ background: t.paper, border: `1px solid ${t.edge}`, color: C.ink }}
          >
            <ChartLineUpIcon size={18} />
          </Link>

          {/* New Chat */}
          <button
            onClick={onNewChat}
            title={tr.newChat}
            className="flex size-9 items-center justify-center rounded-full transition hover:brightness-95 active:scale-95"
            style={{ background: t.paper, border: `1px solid ${t.edge}`, color: C.ink }}
          >
            <PlusIcon size={18} />
          </button>

          {/* End Call */}
          <button
            onClick={onEnd}
            title={tr.endCall}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-semibold text-white transition hover:brightness-110 active:scale-95"
            style={{ background: C.rose, boxShadow: `0 2px 8px ${C.rose}44` }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
            <span className="hidden md:inline">{tr.endCall}</span>
          </button>
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. CALL ENDED
// ---------------------------------------------------------------------------

function EndedScreen({
  turns,
  onRestart,
  onOpen,
}: {
  turns: number;
  onRestart: () => void;
  onOpen: (c: Chat) => void;
}) {
  const t = useT();
  return (
    <Shell>
      <Mark tint={C.sage} />
      <h2 className="text-[22px] font-bold" style={{ color: C.ink }}>
        {t.ended}
      </h2>
      <p className="mt-2 mb-8 text-center text-[15px]" style={{ color: C.inkSoft }}>
        {turns > 0 ? t.endedTurns(turns) : t.endedNone}
      </p>
      <PrimaryButton onClick={onRestart}>{t.newChat}</PrimaryButton>
      <ChatHistory onOpen={onOpen} />
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// 5. MIC PERMISSION ERROR
// ---------------------------------------------------------------------------

const MIC_COPY: Record<MicError, { title: string; body: string; how: string[] }> = {
  denied: {
    title: 'Microphone is blocked',
    body: 'The browser is not allowing the microphone. Nova needs it to hear you.',
    how: ['Click the lock icon in the address bar', 'Set Microphone to Allow', 'Reload this page'],
  },
  notfound: {
    title: 'No microphone found',
    body: 'This device does not seem to have a microphone.',
    how: ['Connect a headset or mic', 'Check the input device in system settings', 'Reload'],
  },
  other: {
    title: 'Could not open the microphone',
    body: 'Another app may be using it.',
    how: ['Close Meet / Zoom and similar apps', 'Reload the browser', 'Try again'],
  },
};

function MicErrorScreen({ kind, onRetry }: { kind: MicError; onRetry: () => void }) {
  const copy = MIC_COPY[kind];
  return (
    <Shell>
      <div
        className="mb-5 flex size-14 items-center justify-center rounded-full text-2xl"
        style={{ background: `${C.rose}1A` }}
      >
        🎤
      </div>
      <h2 className="text-center text-[21px] font-bold" style={{ color: C.rose }}>
        {copy.title}
      </h2>
      <p
        className="mt-2 max-w-[16rem] text-center text-[14px] leading-relaxed"
        style={{ color: C.inkSoft }}
      >
        {copy.body}
      </p>

      <div
        className="mt-6 w-full rounded-2xl p-4"
        style={{ background: C.paper, border: `1px solid ${C.line}` }}
      >
        <p
          className="mb-3 font-mono text-[10px] tracking-[0.18em] uppercase"
          style={{ color: C.inkSoft }}
        >
          How to fix
        </p>
        <ol className="flex flex-col gap-2.5">
          {copy.how.map((step, i) => (
            <li key={i} className="flex gap-3 text-[14px]" style={{ color: C.ink }}>
              <span
                className="flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold text-white"
                style={{ background: C.clay }}
              >
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-6 w-full">
        <PrimaryButton onClick={onRetry}>Try again</PrimaryButton>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

const FADE = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.26 },
};

/** Language dropdown. Changing it re-labels the UI and tells the teacher to switch. */
function LanguagePicker() {
  const { lang, setLang } = useContext(LangContext);
  const t = useT();
  return (
    <label className="flex w-full items-center gap-2 text-[12px]" style={{ color: C.inkSoft }}>
      <span className="font-mono tracking-[0.14em] uppercase">{t.language}</span>
      <select
        value={lang}
        onChange={(e) => setLang(e.target.value as Lang)}
        className="flex-1 rounded-xl px-3 py-2 text-[14px] font-semibold outline-none"
        style={{ background: C.paper, border: `1px solid ${C.line}`, color: C.ink }}
      >
        {LANGS.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function NovaView() {
  const [lang, setLangState] = useState<Lang>('en');
  const room = useMaybeRoomContext();
  useEffect(() => setLangState(readLangCookie()), []);
  const setLang = useCallback(
    (l: Lang) => {
      setLangState(l);
      writeLangCookie(l);
      // Mid-class switch: tell whoever is teaching to change language now.
      room?.localParticipant
        .sendText(JSON.stringify({ type: 'language', lang: l }), { topic: 'nova-board-student' })
        .catch(() => {});
    },
    [room]
  );
  return (
    <LangContext.Provider value={{ lang, setLang }}>
      <NovaViewInner />
    </LangContext.Provider>
  );
}

function NovaViewInner() {
  const session = useSessionContext();
  const { connectionState, isConnected, start, end } = session;
  const { messages } = useSessionMessages(session);

  const [micError, setMicError] = useState<MicError | null>(null);
  const [hasEnded, setHasEnded] = useState(false);
  const [turns, setTurns] = useState(0);
  const [canvas, setCanvas] = useState<CanvasPayload[]>([]);
  // Day 9: which agent currently holds the conversation. The backend pushes an
  // 'agent' frame on every handoff, so the UI changes with the voice.
  const [handoffs, setHandoffs] = useState<
    { id: string; from: string; to: string; reason: string; at: number }[]
  >([]);
  const [agentId, setAgentId] = useState<{
    id: string;
    name: string;
    role: string;
    tint: string;
    lang: string;
  }>({ id: 'nova', name: 'Acharya', role: 'Teacher', tint: C.clay, lang: 'English' });
  const wasConnected = useRef(false);
  const [chatId, setChatId] = useState(() => `c${Date.now()}`);
  const [resume, setResume] = useState<Chat | null>(null);
  const goingHome = useRef(false);
  // "New chat" mid-class: end this session, then go straight into a fresh one.
  const restarting = useRef(false);

  // The agent pushes code and flowcharts here over the data channel while it
  // talks. Anything unparseable is dropped rather than crashing the view.
  useDataChannel('nova-canvas', (msg) => {
    try {
      const payload = JSON.parse(new TextDecoder().decode(msg.payload)) as CanvasPayload;
      if (payload.kind === 'agent') {
        // Record why the conversation moved, so the student can see it rather
        // than wondering why a different voice is suddenly talking.
        if (payload.from && payload.from !== payload.id) {
          setHandoffs((prev) => [
            ...prev,
            {
              id: `${payload.from}-${payload.id}-${prev.length}`,
              from: payload.from!,
              to: payload.id,
              reason: payload.reason ?? '',
              at: Date.now(),
            },
          ]);
        }
        setAgentId({
          id: payload.id,
          name: payload.name,
          role: payload.role,
          tint: payload.tint,
          lang: payload.lang,
        });
        return;
      }
      // Cards accumulate so a flowchart and its code stay on screen together.
      setCanvas((prev) => (payload.kind === 'clear' ? [] : [...prev, payload]));
    } catch {
      /* ignore malformed frames */
    }
  });

  // Remember the transcript length before teardown — messages are cleared on
  // disconnect, so the ended screen would otherwise always read zero.
  useEffect(() => {
    if (isConnected) {
      wasConnected.current = true;
      setTurns(messages.length);
    } else if (wasConnected.current) {
      wasConnected.current = false;
      if (restarting.current) {
        restarting.current = false;
        void handleStartRef.current();
      } else if (goingHome.current) {
        goingHome.current = false; // straight back to the start screen
      } else {
        setHasEnded(true);
      }
    }
  }, [isConnected, messages.length]);

  // Start a class: a brand-new chat, or (with `chat`) continue an old one.
  const startClass = useCallback(
    async (chat: Chat | null) => {
      setMicError(null);
      const err = await requestMic();
      if (err) {
        setMicError(err);
        return;
      }
      setHasEnded(false);
      setResume(chat);
      setChatId(chat ? chat.id : `c${Date.now()}`);
      // The token route reads this to tell the agent to wait for the history.
      document.cookie = `nova_resume=${chat ? 1 : 0}; path=/; max-age=60; samesite=lax`;
      setCanvas([]);
      setHandoffs([]);
      setAgentId({
        id: 'nova',
        name: 'Acharya',
        role: 'Teacher',
        tint: C.clay,
        lang: 'English',
      });
      await start();
    },
    [start]
  );
  const handleStart = useCallback(() => startClass(null), [startClass]);
  const handleContinue = useCallback((chat: Chat) => startClass(chat), [startClass]);

  const handleStartRef = useRef(handleStart);
  handleStartRef.current = handleStart;

  const handleEnd = useCallback(async () => {
    await end();
  }, [end]);

  const handleHome = useCallback(async () => {
    goingHome.current = true;
    await end();
  }, [end]);

  const handleNewChat = useCallback(async () => {
    restarting.current = true;
    await end();
  }, [end]);

  let screen: Screen = 'ready';
  if (micError) screen = 'mic-error';
  else if (isConnected) screen = 'live';
  else if (connectionState === ConnectionState.Connecting) screen = 'connecting';
  else if (hasEnded) screen = 'ended';

  return (
    <AnimatePresence mode="wait">
      <motion.div key={screen} {...FADE}>
        {screen === 'ready' && <ReadyScreen onStart={handleStart} onOpen={handleContinue} />}
        {screen === 'connecting' && <ConnectingScreen />}
        {screen === 'live' && (
          <LiveScreen
            chatId={chatId}
            resume={resume}
            onHome={handleHome}
            onNewChat={handleNewChat}
            onEnd={handleEnd}
            canvas={canvas}
            agent={agentId}
            handoffs={handoffs}
          />
        )}
        {screen === 'ended' && (
          <EndedScreen turns={turns} onRestart={handleStart} onOpen={handleContinue} />
        )}
        {screen === 'mic-error' && <MicErrorScreen kind={micError!} onRetry={handleStart} />}
      </motion.div>
    </AnimatePresence>
  );
}
