'use client';

import { createContext, useContext, useState, useMemo } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useT } from '../i18n';
import type { CheckpointOption, Rect, Step } from './types';
import { normalizeOptions, type CheckpointEntry } from './board-state';
import type {
  CellGeom,
  ChainGeom,
  CodeGeom,
  DiagramGeom,
  IllustrationGeom,
  ListGeom,
  MediaGeom,
  PlacedEl,
  PlacedStep,
  TableGeom,
  TextGeom,
  TreeGeom,
} from './layout';
import { HAND, MONO, TITLE_FS, estimateCheckpointContentHeight } from './layout';
import { arrowHead, sketchLine, sketchPill, sketchRect } from './sketch';

/** Marker colours. Navy for the lesson, clay for Nova's live annotations. */
export const INK = {
  board: '#FBFAF6',
  grid: '#EFEBE2',
  ink: '#2B3A55',
  soft: '#8A8F9C',
  faint: '#C9C6BD',
  teacher: '#C4704F',
  highlight: '#F6D55C',
  student: '#2F7FD1',
  studentHi: '#7ED957',
};

const WRITE_STAGGER = 0.55; // seconds between elements of one step

/** Reveal an element left-to-right, like a marker writing it. Mount-only. */
function WriteIn({
  id,
  w,
  h,
  delay,
  children,
}: {
  id: string;
  w: number;
  h: number;
  delay: number;
  children: React.ReactNode;
}) {
  const dur = Math.min(1.5, 0.35 + w / 900);
  return (
    <>
      <defs>
        <clipPath id={`wr-${id}`}>
          <motion.rect
            x={-20}
            y={-40}
            height={h + 80}
            initial={{ width: 0 }}
            animate={{ width: w + 60 }}
            transition={{ duration: dur, delay, ease: 'easeInOut' }}
          />
        </clipPath>
      </defs>
      <g clipPath={`url(#wr-${id})`}>{children}</g>
    </>
  );
}

function Label({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <text x={0} y={17} fontFamily={HAND} fontSize={17} fill={INK.soft}>
      {text}
    </text>
  );
}

// ---------------------------------------------------------------------------

function TextEl({ pe, color = INK.ink }: { pe: PlacedEl; color?: string }) {
  const g = pe.geom as TextGeom;
  return (
    <>
      {g.lines.map((ln, i) => (
        <text key={i} x={0} y={i * g.lh + g.fs} fontFamily={HAND} fontSize={g.fs} fill={color}>
          {ln}
        </text>
      ))}
    </>
  );
}

export type TutorState =
  | 'Explaining'
  | 'Waiting for answer'
  | 'Listening'
  | 'Reconnecting'
  | 'Ready';

export const LiveSpeechContext = createContext<{
  agentSpeech?: string;
  userQuestion?: string;
  isSpeaking?: boolean;
  tutorState?: TutorState;
}>({});

export function LiveSpeechCard({
  slot,
  step,
  isLatest,
  stepIndex,
  speechText,
  checkpoint,
  onResponse,
  onRevealHint,
  onRetry,
}: {
  slot: Rect;
  step: Step;
  isLatest: boolean;
  stepIndex?: number;
  speechText?: string;
  checkpoint?: CheckpointEntry;
  onResponse?: (params: {
    checkpointId: string;
    conceptId?: string;
    modality: 'voice' | 'typed' | 'chip';
    response: string;
    optionId?: string;
  }) => void;
  onRevealHint?: (checkpointId: string, conceptId?: string) => void;
  onRetry?: (checkpointId: string, conceptId?: string) => void;
}) {
  const [typedInput, setTypedInput] = useState('');
  const speechCtx = useContext(LiveSpeechContext);
  const rawText = (speechText || step.say || '').trim();
  const text = rawText;
  const tutorState = isLatest
    ? (speechCtx.tutorState ?? (speechCtx.isSpeaking ? 'Explaining' : 'Ready'))
    : 'Ready';
  const isSpeaking = tutorState === 'Explaining';
  const checkQuestion = (checkpoint?.question || step.check || '').trim();
  const options = checkpoint?.options || step.checkOptions;
  const normalizedOptions = useMemo(() => normalizeOptions(options), [options]);
  const hints = checkpoint?.hints || step.checkHints;
  const cpId = checkpoint?.id || `cp-${step.conceptId || step.id}`;
  const conceptId = step.conceptId || step.id;
  const isAwaiting = checkpoint?.status === 'awaiting_response';
  const isAnswered = Boolean(
    checkpoint?.answerReceived ||
    checkpoint?.status === 'answered' ||
    checkpoint?.status === 'completed'
  );
  const response = checkpoint?.response;
  const evaluation = checkpoint?.evaluation;
  const revealedHintsCount = checkpoint?.revealedHintsCount ?? 0;

  // Show card only when there is meaningful content or active live speech
  if (!text && !checkQuestion && !isSpeaking) {
    return null;
  }

  const w = slot.w;
  const checkH = checkQuestion
    ? estimateCheckpointContentHeight(
        checkpoint || {
          question: checkQuestion,
          options: normalizedOptions,
          hints,
          criteria: step.checkCriteria,
          status: 'pending',
          answerReceived: isAnswered,
          response,
          evaluation,
          revealedHintsCount,
        },
        w
      )
    : 0;
  // Use layout slot bounds strictly so card never overlaps subsequent elements
  const h = slot.h;
  const padX = 18;

  const words = text ? text.split(/\s+/).filter(Boolean) : [];
  // Highlight trailing stream of words when speaking live
  const highlightStart = isSpeaking ? Math.max(0, words.length - 6) : -1;

  const displayTitle = isSpeaking
    ? 'ACHARYA SPEAKING'
    : step.title
      ? step.title.toUpperCase()
      : 'EXPLANATION';

  // Configure badge styling based on derived tutorState
  let badgeText = "📘 ACHARYA'S NOTE";
  let badgeFill = '#F0ECE1';
  let badgeColor = '#8C8177';
  let accentColor = '#C4704F';
  let badgeW = 148;

  if (isLatest) {
    switch (tutorState) {
      case 'Explaining':
        badgeText = '🎙️ EXPLAINING';
        badgeFill = '#FEF3C7';
        badgeColor = '#92400E';
        accentColor = '#D97706';
        badgeW = 140;
        break;
      case 'Waiting for answer':
        badgeText = '❓ WAITING FOR ANSWER';
        badgeFill = '#FEF9C3';
        badgeColor = '#854D0E';
        accentColor = '#EAB308';
        badgeW = 168;
        break;
      case 'Listening':
        badgeText = '👂 LISTENING';
        badgeFill = '#DCFCE7';
        badgeColor = '#166534';
        accentColor = '#16A34A';
        badgeW = 120;
        break;
      case 'Reconnecting':
        badgeText = '🔄 RECONNECTING';
        badgeFill = '#FEE2E2';
        badgeColor = '#991B1B';
        accentColor = '#DC2626';
        badgeW = 148;
        break;
      case 'Ready':
      default:
        badgeText = "📘 ACHARYA'S NOTE";
        badgeFill = '#F0ECE1';
        badgeColor = '#8C8177';
        accentColor = '#C4704F';
        badgeW = 148;
        break;
    }
  }

  return (
    <g transform={`translate(${slot.x}, ${slot.y})`} data-step={stepIndex}>
      {/* Background card plate */}
      <rect
        x={0}
        y={0}
        width={w}
        height={h}
        rx={14}
        fill="#FCFBF7"
        stroke="#E2DCD0"
        strokeWidth={1.5}
      />
      {/* Top accent line */}
      <rect x={0} y={0} width={w} height={4} rx={2} fill={accentColor} />

      {/* Header Badge */}
      <rect
        x={padX}
        y={14}
        width={badgeW}
        height={22}
        rx={6}
        fill={badgeFill}
      />
      {isLatest && tutorState === 'Explaining' && (
        <circle cx={padX + 10} cy={25} r={4} fill="#D97706" data-snapshot-skip>
          <animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite" />
        </circle>
      )}
      {isLatest && tutorState === 'Listening' && (
        <circle cx={padX + 10} cy={25} r={4} fill="#16A34A" data-snapshot-skip>
          <animate attributeName="opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite" />
        </circle>
      )}
      {isLatest && tutorState === 'Waiting for answer' && (
        <circle cx={padX + 10} cy={25} r={4} fill="#EAB308" data-snapshot-skip>
          <animate attributeName="opacity" values="1;0.4;1" dur="1.5s" repeatCount="indefinite" />
        </circle>
      )}
      <text
        x={padX + (isLatest && tutorState !== 'Ready' ? 20 : 10)}
        y={29}
        fontFamily={MONO}
        fontSize={10}
        fontWeight={700}
        letterSpacing="0.06em"
        fill={badgeColor}
      >
        {badgeText}
      </text>

      {/* Title */}
      <text
        x={padX}
        y={56}
        fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif"
        fontSize={14}
        fontWeight={700}
        fill="#1E293B"
      >
        {displayTitle.length > 44 ? `${displayTitle.slice(0, 44)}…` : displayTitle}
      </text>

      {/* Divider */}
      <line
        x1={padX}
        y1={66}
        x2={w - padX}
        y2={66}
        stroke="#EBE5D8"
        strokeWidth={1}
        strokeDasharray="4 4"
      />

      {/* Spoken words with native font kerning and karaoke highlighter (no unnatural word gaps) */}
      <foreignObject x={padX} y={76} width={w - padX * 2} height={Math.max(60, h - 90 - checkH)}>
        <div
          style={{
            fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
            fontSize: '16px',
            lineHeight: '1.65',
            color: '#334155',
            overflowWrap: 'break-word',
            wordBreak: 'normal',
            userSelect: 'text',
          }}
        >
          {words.map((word, idx) => {
            const isHi = highlightStart >= 0 && idx >= highlightStart;
            return (
              <span key={idx}>
                <span
                  style={{
                    backgroundColor: isHi ? '#FEF08A' : 'transparent',
                    color: isHi ? '#1E293B' : '#334155',
                    fontWeight: isHi ? 600 : 400,
                    borderRadius: isHi ? '4px' : '0',
                    padding: isHi ? '2px 4px' : '0',
                    boxDecorationBreak: 'clone',
                    WebkitBoxDecorationBreak: 'clone',
                  }}
                >
                  {word}
                </span>
                {' '}
              </span>
            );
          })}
        </div>
      </foreignObject>

      {/* Check-in Question box (if present) */}
      {checkQuestion && (
        <foreignObject x={padX} y={h - checkH - 12} width={w - padX * 2} height={checkH}>
          <div
            data-interactive="true"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerMove={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              background:
                isAnswered && evaluation
                  ? evaluation.isCorrect === true
                    ? '#F0FDF4'
                    : evaluation.isCorrect === false
                      ? '#FEF2F2'
                      : '#FEF9C3'
                  : '#FEF9C3',
              border: `1px solid ${
                isAnswered && evaluation
                  ? evaluation.isCorrect === true
                    ? '#86EFAC'
                    : evaluation.isCorrect === false
                      ? '#FCA5A5'
                      : '#FDE047'
                  : '#FDE047'
              }`,
              borderRadius: '8px',
              padding: '6px 10px',
              fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
              height: '100%',
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              overflowY: 'auto',
            }}
          >
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: '10px',
                  fontWeight: 700,
                  color:
                    isAnswered && evaluation
                      ? evaluation.isCorrect === true
                        ? '#166534'
                        : evaluation.isCorrect === false
                          ? '#991B1B'
                          : '#854D0E'
                      : '#854D0E',
                }}
              >
                💡 QUICK CHECK
              </div>
              {isAwaiting && (
                <div
                  style={{
                    fontSize: '9.5px',
                    fontWeight: 700,
                    color: '#854D0E',
                    background: '#FEF08A',
                    padding: '1px 6px',
                    borderRadius: '4px',
                  }}
                >
                  WAITING FOR ANSWER
                </div>
              )}
            </div>

            {/* Question Text */}
            <div
              style={{
                fontSize: '12px',
                fontWeight: 600,
                color:
                  isAnswered && evaluation
                    ? evaluation.isCorrect === true
                      ? '#14532D'
                      : evaluation.isCorrect === false
                        ? '#7F1D1D'
                        : '#713F12'
                    : '#713F12',
                lineHeight: 1.3,
                marginBottom: '4px',
              }}
            >
              {checkQuestion}
            </div>

            {/* Live Interim Voice Transcription */}
            {checkpoint?.interimResponse && isAwaiting && (
              <div
                style={{
                  fontSize: '11px',
                  color: '#92400E',
                  fontStyle: 'italic',
                  background: '#FEF08A',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  marginBottom: '4px',
                }}
              >
                🎙️ Speaking: &ldquo;{checkpoint.interimResponse}&rdquo;…
              </div>
            )}

            {/* Option Chips (when options are present) */}
            {normalizedOptions && normalizedOptions.length > 0 && isAwaiting && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '4px' }}>
                {normalizedOptions.map((opt) => (
                  <button
                    key={opt.id}
                    data-option-id={opt.id}
                    data-interactive="true"
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onResponse?.({
                        checkpointId: cpId,
                        conceptId,
                        modality: 'chip',
                        response: opt.text,
                        optionId: opt.id,
                      });
                    }}
                    style={{
                      padding: '3px 8px',
                      fontSize: '11px',
                      fontWeight: 600,
                      borderRadius: '12px',
                      border: '1px solid #FCD34D',
                      background: response?.optionId === opt.id || response?.text === opt.text ? '#FDE047' : '#FFFFFF',
                      color: '#92400E',
                      cursor: 'pointer',
                    }}
                  >
                    {opt.text}
                  </button>
                ))}
              </div>
            )}

            {/* Typed input row (when awaiting response) */}
            {isAwaiting && (
              <form
                data-interactive="true"
                onPointerDown={(e) => e.stopPropagation()}
                onSubmit={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (typedInput.trim()) {
                    onResponse?.({
                      checkpointId: cpId,
                      conceptId,
                      modality: 'typed',
                      response: typedInput.trim(),
                    });
                    setTypedInput('');
                  }
                }}
                style={{ display: 'flex', gap: '4px', marginTop: '2px' }}
              >
                <input
                  type="text"
                  data-interactive="true"
                  value={typedInput}
                  onPointerDown={(e) => e.stopPropagation()}
                  onChange={(e) => setTypedInput(e.target.value)}
                  placeholder="Type an answer or speak..."
                  style={{
                    flex: 1,
                    fontSize: '11px',
                    padding: '3px 8px',
                    border: '1px solid #FCD34D',
                    borderRadius: '5px',
                    background: '#FFFFFF',
                    color: '#1E293B',
                    outline: 'none',
                  }}
                />
                <button
                  type="submit"
                  data-interactive="true"
                  disabled={!typedInput.trim()}
                  onPointerDown={(e) => e.stopPropagation()}
                  style={{
                    padding: '3px 9px',
                    fontSize: '11px',
                    fontWeight: 600,
                    background: typedInput.trim() ? '#D97706' : '#E2DCD0',
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: '5px',
                    cursor: typedInput.trim() ? 'pointer' : 'default',
                  }}
                >
                  Send
                </button>
              </form>
            )}

            {/* Answer Received & Evaluation Result (when answered) */}
            {isAnswered && (
              <div style={{ marginTop: '2px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px' }}>
                  <div style={{ color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '72%' }}>
                    <span style={{ fontWeight: 600 }}>Answer:</span> &ldquo;{response?.text || 'Recorded'}&rdquo;{' '}
                    <span style={{ fontSize: '9.5px', color: '#64748B' }}>
                      ({response?.modality === 'voice' ? '🎙️ voice' : response?.modality === 'chip' ? '🔘 option' : '⌨️ typed'})
                    </span>
                  </div>
                  {evaluation && (
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 700,
                        padding: '1px 6px',
                        borderRadius: '4px',
                        background:
                          evaluation.isCorrect === true
                            ? '#DCFCE7'
                            : evaluation.isCorrect === false
                              ? '#FEE2E2'
                              : '#FEF08A',
                        color:
                          evaluation.isCorrect === true
                            ? '#166534'
                            : evaluation.isCorrect === false
                              ? '#991B1B'
                              : '#854D0E',
                      }}
                    >
                      {evaluation.isCorrect === true
                        ? '✓ Correct'
                        : evaluation.isCorrect === false
                          ? '✕ Try Again'
                          : '⏳ Evaluating…'}
                    </span>
                  )}
                </div>

                {/* Feedback + Hint / Retry controls */}
                {evaluation && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px', marginTop: '2px' }}>
                    <div
                      style={{
                        fontSize: '10.5px',
                        color: evaluation.isCorrect === true ? '#166534' : '#991B1B',
                        flex: 1,
                      }}
                    >
                      {evaluation.feedback}
                    </div>
                    {evaluation.isCorrect === false && (
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {hints && hints.length > 0 && revealedHintsCount < hints.length && (
                          <button
                            type="button"
                            data-interactive="true"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              onRevealHint?.(cpId, conceptId);
                            }}
                            style={{
                              fontSize: '10px',
                              fontWeight: 600,
                              padding: '2px 6px',
                              background: '#FEF08A',
                              border: '1px solid #FCD34D',
                              borderRadius: '4px',
                              color: '#854D0E',
                              cursor: 'pointer',
                            }}
                          >
                            💡 Hint ({revealedHintsCount + 1}/{hints.length})
                          </button>
                        )}
                        <button
                          type="button"
                          data-interactive="true"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            onRetry?.(cpId, conceptId);
                          }}
                          style={{
                            fontSize: '10px',
                            fontWeight: 600,
                            padding: '2px 6px',
                            background: '#F1F5F9',
                            border: '1px solid #CBD5E1',
                            borderRadius: '4px',
                            color: '#334155',
                            cursor: 'pointer',
                          }}
                        >
                          🔄 Retry
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Revealed hints box */}
                {hints && hints.length > 0 && revealedHintsCount > 0 && (
                  <div
                    style={{
                      background: '#FEF9C3',
                      border: '1px solid #FDE047',
                      borderRadius: '4px',
                      padding: '3px 6px',
                      fontSize: '10.5px',
                      color: '#854D0E',
                      marginTop: '2px',
                    }}
                  >
                    {hints.slice(0, revealedHintsCount).map((hint, hIdx) => (
                      <div key={hIdx}>💡 {hint}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </foreignObject>
      )}
    </g>
  );
}

export function TextbookCardEl({
  w,
  h,
  title,
  text,
}: {
  w: number;
  h: number;
  title?: string;
  text: string;
  isLive?: boolean;
}) {
  return (
    <LiveSpeechCard
      slot={{ x: 0, y: 0, w, h }}
      step={{ id: 'card', title: title || '', elements: [], say: text }}
      isLatest={false}
    />
  );
}

function NoteEl({ pe }: { pe: PlacedEl }) {
  const g = pe.geom as TextGeom;
  const el = pe.el as Extract<PlacedEl['el'], { kind: 'note' }>;
  const bodyText = el.text?.trim();

  if (!bodyText) return null;

  return (
    <>
      <path
        d={`M6,-10 Q4,${g.lh * 0.55} 20,${g.lh * 0.55}`}
        fill="none"
        stroke={INK.teacher}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <path
        d={arrowHead(6, -12, -Math.PI / 2, 8)}
        fill="none"
        stroke={INK.teacher}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <g transform="translate(30,0)">
        {g.lines.map((ln, i) => (
          <text
            key={i}
            x={0}
            y={i * g.lh + g.fs}
            fontFamily={HAND}
            fontSize={g.fs}
            fill={INK.teacher}
          >
            {ln}
          </text>
        ))}
      </g>
    </>
  );
}

function CodeEl({ pe }: { pe: PlacedEl }) {
  const el = pe.el as Extract<PlacedEl['el'], { kind: 'code' }>;
  const g = pe.geom as CodeGeom;
  const bodyH = pe.h - g.labelH;
  return (
    <>
      <Label text={el.label} />
      <rect x={0} y={g.labelH} width={pe.w} height={bodyH} rx={8} fill="#F3F1EA" />
      <path
        d={sketchRect(0, g.labelH, pe.w, bodyH, pe.el.id)}
        fill="none"
        stroke={INK.faint}
        strokeWidth={1.5}
      />
      {el.lines.map((ln, i) => (
        <g key={i}>
          <text
            x={g.pad - 4}
            y={g.labelH + g.pad + i * g.lh + g.fs}
            fontFamily={MONO}
            className="mono"
            fontSize={g.fs * 0.78}
            fill={INK.faint}
            textAnchor="end"
          >
            {i + 1}
          </text>
          <text
            x={g.pad + 6}
            y={g.labelH + g.pad + i * g.lh + g.fs}
            fontFamily={MONO}
            className="mono"
            fontSize={g.fs}
            fill={INK.ink}
            style={{ whiteSpace: 'pre' }}
          >
            {ln}
          </text>
        </g>
      ))}
    </>
  );
}

function ArrayEl({ pe }: { pe: PlacedEl }) {
  const el = pe.el as Extract<PlacedEl['el'], { kind: 'array' }>;
  const g = pe.geom as CellGeom;
  const fs = Math.min(21, g.cellW * 0.42);
  return (
    <>
      <Label text={el.label} />
      {el.values.map((v, i) => (
        <g key={i}>
          <path
            d={sketchRect(i * g.cellW, g.top, g.cellW, g.cellH, `${pe.el.id}-${i}`)}
            fill="none"
            stroke={INK.ink}
            strokeWidth={2}
            strokeLinecap="round"
          />
          <AnimatePresence mode="popLayout">
            <motion.text
              key={`${i}-${v}`}
              x={i * g.cellW + g.cellW / 2}
              y={g.top + g.cellH / 2 + fs * 0.36}
              textAnchor="middle"
              fontFamily={HAND}
              fontSize={fs}
              fill={INK.ink}
              initial={{ opacity: 0, y: g.top + g.cellH / 2 + fs * 0.36 - 10 }}
              animate={{ opacity: 1, y: g.top + g.cellH / 2 + fs * 0.36 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35 }}
            >
              {v}
            </motion.text>
          </AnimatePresence>
          <text
            x={i * g.cellW + g.cellW / 2}
            y={g.top + g.cellH + 15}
            textAnchor="middle"
            fontFamily={MONO}
            className="mono"
            fontSize={11}
            fill={INK.soft}
          >
            {i}
          </text>
        </g>
      ))}
      {(el.pointers ?? []).map((p, k) => {
        // Pointers on the same cell stack so both names stay readable.
        const same = (el.pointers ?? []).slice(0, k).filter((q) => q.index === p.index).length;
        const cx = p.index * g.cellW + g.cellW / 2;
        const top = g.top + g.cellH + 20;
        return (
          <motion.g
            key={p.name}
            initial={false}
            animate={{ x: cx }}
            transition={{ type: 'spring', stiffness: 170, damping: 20 }}
          >
            <path d={`M0,${top + 18} L0,${top + 2}`} stroke={INK.teacher} strokeWidth={2} />
            <path
              d={arrowHead(0, top, -Math.PI / 2, 7)}
              fill="none"
              stroke={INK.teacher}
              strokeWidth={2}
            />
            <text
              x={same * 16}
              y={top + 34}
              textAnchor="middle"
              fontFamily={HAND}
              fontSize={17}
              fill={INK.teacher}
            >
              {p.name}
            </text>
          </motion.g>
        );
      })}
    </>
  );
}

function ChainEl({ pe }: { pe: PlacedEl }) {
  const el = pe.el as Extract<PlacedEl['el'], { kind: 'chain' }>;
  const g = pe.geom as ChainGeom;
  return (
    <>
      <Label text={el.label} />
      {g.boxes.map((b, i) => (
        <g key={i}>
          <path
            d={sketchRect(b.x, b.y, b.w, b.h, `${pe.el.id}-${i}`)}
            fill="none"
            stroke={INK.ink}
            strokeWidth={2}
            strokeLinecap="round"
          />
          <text
            x={b.x + b.w / 2}
            y={b.y + b.h / 2 + g.fs * 0.36}
            textAnchor="middle"
            fontFamily={HAND}
            fontSize={g.fs}
            fill={INK.ink}
          >
            {el.values[i]}
          </text>
          {g.arrows && i < g.boxes.length - 1 && (
            <ChainArrow a={b} b={g.boxes[i + 1]} vertical={g.vertical} seed={`${pe.el.id}-a${i}`} />
          )}
        </g>
      ))}
    </>
  );
}

function ChainArrow({
  a,
  b,
  vertical,
  seed,
}: {
  a: { x: number; y: number; w: number; h: number };
  b: { x: number; y: number; w: number; h: number };
  vertical: boolean;
  seed: string;
}) {
  const [x1, y1, x2, y2] = vertical
    ? [a.x + a.w / 2, a.y + a.h + 2, b.x + b.w / 2, b.y - 3]
    : [a.x + a.w + 3, a.y + a.h / 2, b.x - 4, b.y + b.h / 2];
  return (
    <>
      <path
        d={sketchLine(x1, y1, x2, y2, seed, 0.8)}
        fill="none"
        stroke={INK.ink}
        strokeWidth={1.8}
      />
      <path
        d={arrowHead(x2, y2, Math.atan2(y2 - y1, x2 - x1), 8)}
        fill="none"
        stroke={INK.ink}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </>
  );
}

function TreeEl({ pe }: { pe: PlacedEl }) {
  const el = pe.el as Extract<PlacedEl['el'], { kind: 'tree' }>;
  const g = pe.geom as TreeGeom;
  const at = new Map(g.nodes.map((n) => [n.node.id, n]));
  return (
    <>
      <Label text={el.label} />
      {g.edges.map((e) => {
        const a = at.get(e.from);
        const b = at.get(e.to);
        if (!a || !b) return null;
        return (
          <path
            key={`${e.from}-${e.to}`}
            d={sketchLine(a.x + a.w / 2, a.y + a.h, b.x + b.w / 2, b.y, `${pe.el.id}-${e.to}`, 0.8)}
            fill="none"
            stroke={INK.ink}
            strokeWidth={1.8}
          />
        );
      })}
      {g.nodes.map((n) => (
        <g key={n.node.id}>
          <path
            d={sketchPill(n.x, n.y, n.w, n.h, `${pe.el.id}-${n.node.id}`)}
            fill={INK.board}
            stroke={INK.ink}
            strokeWidth={2}
          />
          <text
            x={n.x + n.w / 2}
            y={n.y + n.h / 2 + g.fs * 0.36}
            textAnchor="middle"
            fontFamily={HAND}
            fontSize={g.fs}
            fill={INK.ink}
          >
            {n.node.label}
          </text>
        </g>
      ))}
    </>
  );
}

function TableEl({ pe }: { pe: PlacedEl }) {
  const el = pe.el as Extract<PlacedEl['el'], { kind: 'table' }>;
  const g = pe.geom as TableGeom;
  const top = g.labelH;
  const nrows = el.rows.length + (g.headers ? 1 : 0);
  const xs = g.colW.reduce<number[]>((acc, w) => [...acc, acc[acc.length - 1] + w], [0]);
  const width = xs[xs.length - 1];
  const cell = (text: string, ci: number, ri: number, bold: boolean) => (
    <text
      key={`${ri}-${ci}`}
      x={xs[ci] + 10}
      y={top + ri * g.rowH + g.rowH / 2 + g.fs * 0.36}
      fontFamily={HAND}
      fontSize={g.fs}
      fontWeight={bold ? 700 : 400}
      fill={bold ? INK.teacher : INK.ink}
    >
      {text}
    </text>
  );
  return (
    <>
      <Label text={el.label} />
      {Array.from({ length: nrows + 1 }, (_, r) => (
        <path
          key={`h${r}`}
          d={sketchLine(0, top + r * g.rowH, width, top + r * g.rowH, `${pe.el.id}-h${r}`, 0.9)}
          fill="none"
          stroke={r === 1 && g.headers ? INK.ink : INK.faint}
          strokeWidth={r === 1 && g.headers ? 1.8 : 1.3}
        />
      ))}
      {xs.map((x, c) => (
        <path
          key={`v${c}`}
          d={sketchLine(x, top, x, top + nrows * g.rowH, `${pe.el.id}-v${c}`, 0.9)}
          fill="none"
          stroke={INK.faint}
          strokeWidth={1.3}
        />
      ))}
      {g.headers && (el.headers ?? []).map((h, c) => cell(h, c, 0, true))}
      {el.rows.map((row, r) => row.map((t, c) => cell(t, c, r + (g.headers ? 1 : 0), false)))}
    </>
  );
}

// ---------------------------------------------------------------------------
// General-subject visuals: diagrams, cycles, lists, generated media
// ---------------------------------------------------------------------------

/** Generated media bytes by element id: a blob URL, 'failed', or 'rejected'. */
export const MediaContext = createContext<
  Record<string, { url: string; mime: string; source?: string } | 'failed' | 'rejected'>
>({});

export const MediaActionContext = createContext<{
  onReject?: (id: string) => void;
}>({});

function edgePoint(r: { x: number; y: number; w: number; h: number }, tx: number, ty: number) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  const t = Math.min(
    Math.abs(dx) > 0.01 ? r.w / 2 / Math.abs(dx) : Infinity,
    Math.abs(dy) > 0.01 ? r.h / 2 / Math.abs(dy) : Infinity
  );
  return { x: cx + dx * Math.min(1, t + 0.05), y: cy + dy * Math.min(1, t + 0.05) };
}

const PALETTE: Record<string, { fill: string; stroke: string }> = {
  blue: { fill: '#DCEBFA', stroke: '#4F7DB3' },
  green: { fill: '#DDF3E4', stroke: '#4E9A6A' },
  orange: { fill: '#FCE3D2', stroke: '#C4704F' },
  pink: { fill: '#F9DDE8', stroke: '#B85B82' },
  purple: { fill: '#E8E0F8', stroke: '#7A62B8' },
  yellow: { fill: '#FBF1C9', stroke: '#B8952E' },
  gray: { fill: '#ECEBE7', stroke: '#7C7A73' },
};
const paint = (c?: string) => PALETTE[c ?? ''] ?? { fill: '#FFFFFF', stroke: INK.ink };

/** A short label on an arrow, on a white chip so crossing lines never hide it. */
function EdgeLabel({ x, y, text }: { x: number; y: number; text: string }) {
  const w = text.length * 7.6 + 12;
  return (
    <g>
      <rect
        x={x - w / 2}
        y={y - 11}
        width={w}
        height={20}
        rx={10}
        fill="#FFFFFF"
        stroke={INK.grid}
      />
      <text x={x} y={y + 4} textAnchor="middle" fontFamily={HAND} fontSize={14} fill={INK.teacher}>
        {text}
      </text>
    </g>
  );
}

function DiagramNode({
  n,
  r,
  seed,
  fs,
  band,
}: {
  n: { id: string; label: string; icon?: string; note?: string; color?: string; description?: string; bullets?: string[] };
  r: { x: number; y: number; w: number; h: number };
  seed: string;
  fs: number;
  band?: boolean;
}) {
  const p = paint(n.color);
  const text = `${n.icon ? n.icon + ' ' : ''}${n.label}`;
  const size = Math.min(fs, (r.w - 18) / Math.max(1, text.length * 0.52));
  const labelY = n.note && !band ? r.y + r.h / 2 - 2 : r.y + r.h / 2 + size * 0.36;
  return (
    <g>
      <path
        d={band ? sketchRect(r.x, r.y, r.w, r.h, seed) : sketchPill(r.x, r.y, r.w, r.h, seed)}
        fill={p.fill}
        stroke={p.stroke}
        strokeWidth={2}
      />
      <text
        x={band ? r.x + 16 : r.x + r.w / 2}
        y={labelY}
        textAnchor={band ? 'start' : 'middle'}
        fontFamily={HAND}
        fontSize={size}
        fontWeight={700}
        fill={INK.ink}
      >
        {text}
      </text>
      {n.note && (
        <text
          x={band ? r.x + r.w - 14 : r.x + r.w / 2}
          y={band ? r.y + r.h / 2 + 5 : r.y + r.h / 2 + 16}
          textAnchor={band ? 'end' : 'middle'}
          fontFamily={HAND}
          fontSize={13}
          fill={INK.soft}
        >
          {n.note}
        </text>
      )}
    </g>
  );
}

function InfoCard({
  n,
  card,
  index,
  nodeRect,
  seed,
}: {
  n: { id: string; label: string; icon?: string; color?: string; description?: string; bullets?: string[] };
  card: { x: number; y: number; w: number; h: number; side: 'left' | 'right' };
  index: number;
  nodeRect: { x: number; y: number; w: number; h: number };
  seed: string;
}) {
  const p = paint(n.color);
  const pad = 16;

  // Dashed connector line from card top to node bottom
  const connX = nodeRect.x + nodeRect.w / 2;
  const connFromY = card.y;
  const connToY = nodeRect.y + nodeRect.h;

  // Word-wrap helper
  const wrapText = (text: string, maxChars: number): string[] => {
    const words = text.split(' ');
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      if (line && line.length + w.length + 1 > maxChars) {
        lines.push(line);
        line = w;
      } else {
        line = line ? line + ' ' + w : w;
      }
    }
    if (line) lines.push(line);
    return lines;
  };

  // Pre-compute all text positions
  const items: { type: 'heading' | 'desc' | 'bullet'; lines: string[]; y: number; bulletIdx?: number }[] = [];
  let ty = card.y + pad;

  // Heading
  items.push({ type: 'heading', lines: [`${index + 1}. ${n.icon ? n.icon + ' ' : ''}${n.label}`], y: ty });
  ty += 24;

  // Description
  if (n.description) {
    const lines = wrapText(n.description, 32);
    items.push({ type: 'desc', lines, y: ty });
    ty += lines.length * 17 + 6;
  }

  // Bullets
  if (n.bullets && n.bullets.length > 0) {
    ty += 4;
    n.bullets.forEach((b, bi) => {
      const lines = wrapText(b, 30);
      items.push({ type: 'bullet', lines, y: ty, bulletIdx: bi });
      ty += lines.length * 16 + 5;
    });
  }

  return (
    <g>
      {/* Dashed connector */}
      <path
        d={sketchLine(connX, connToY, connX, connFromY, `${seed}-conn`, 0.6)}
        stroke={p.stroke}
        strokeWidth={1.5}
        strokeDasharray="6 4"
        fill="none"
        opacity={0.6}
      />
      <circle cx={connX} cy={connFromY} r={4} fill={p.stroke} opacity={0.5} />

      {/* Card background — hand-drawn border */}
      <path
        d={sketchRect(card.x, card.y, card.w, card.h, `${seed}-card`)}
        fill={`${p.fill}88`}
        stroke={p.stroke}
        strokeWidth={1.8}
      />
      {/* Left color accent bar */}
      <rect
        x={card.x}
        y={card.y + 8}
        width={4}
        height={card.h - 16}
        rx={2}
        fill={p.stroke}
        opacity={0.7}
      />

      {items.map((item, i) => {
        if (item.type === 'heading') {
          return (
            <text
              key={i}
              x={card.x + pad}
              y={item.y + 15}
              fontFamily={HAND}
              fontSize={16}
              fontWeight={700}
              fill={INK.ink}
            >
              {item.lines[0]}
            </text>
          );
        }
        if (item.type === 'desc') {
          return (
            <g key={i}>
              {item.lines.map((ln, j) => (
                <text
                  key={j}
                  x={card.x + pad}
                  y={item.y + j * 17 + 13}
                  fontFamily={HAND}
                  fontSize={13}
                  fill={INK.soft}
                >
                  {ln}
                </text>
              ))}
            </g>
          );
        }
        // bullet
        return (
          <g key={i}>
            <circle cx={card.x + pad + 4} cy={item.y + 10} r={3.5} fill={p.stroke} />
            {item.lines.map((ln, j) => (
              <text
                key={j}
                x={card.x + pad + 14}
                y={item.y + j * 16 + 13}
                fontFamily={HAND}
                fontSize={12.5}
                fill={INK.ink}
              >
                {ln}
              </text>
            ))}
          </g>
        );
      })}
    </g>
  );
}

function DiagramEl({ pe }: { pe: PlacedEl }) {
  const el = pe.el as Extract<PlacedEl['el'], { kind: 'diagram' }>;
  const g = pe.geom as DiagramGeom;
  const hub = g.layout === 'hub' ? el.nodes[0] : undefined;
  // A hub always has spokes; other layouts draw exactly the edges given.
  const edges =
    hub && el.edges.length === 0
      ? el.nodes.slice(1).map((n) => ({ from: hub.id, to: n.id, label: '' }))
      : g.layout === 'layers' || g.layout === 'compare' || g.layout === 'timeline'
        ? []
        : el.edges;
  return (
    <>
      {pe.w < 700 && (
        <rect
          x={0}
          y={0}
          width={pe.w}
          height={pe.h}
          rx={14}
          fill="#FCFBF7"
          stroke="#E2DCD0"
          strokeWidth={1.5}
        />
      )}
      {el.label && (
        <text
          x={pe.w < 700 ? 20 : 0}
          y={pe.w < 700 ? 28 : 19}
          fontFamily={pe.w < 700 ? 'ui-sans-serif, system-ui, sans-serif' : HAND}
          fontSize={pe.w < 700 ? 15 : 20}
          fontWeight={700}
          fill={INK.ink}
        >
          {el.label}
        </text>
      )}

      {g.layout === 'timeline' && g.axisY !== undefined && (
        <>
          <path
            d={sketchLine(0, g.axisY, pe.w, g.axisY, `${pe.el.id}-axis`, 1)}
            stroke={INK.ink}
            strokeWidth={2.4}
            fill="none"
          />
          <path
            d={arrowHead(pe.w, g.axisY, 0, 10)}
            stroke={INK.ink}
            strokeWidth={2.4}
            fill="none"
          />
          {el.nodes.map((n) => {
            const r = g.boxes[n.id];
            if (!r) return null;
            const cx = r.x + r.w / 2;
            return (
              <g key={`t-${n.id}`}>
                <line
                  x1={cx}
                  y1={g.axisY}
                  x2={cx}
                  y2={r.y}
                  stroke={INK.faint}
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                />
                <circle cx={cx} cy={g.axisY} r={6} fill={paint(n.color).stroke} />
              </g>
            );
          })}
        </>
      )}

      {g.layout === 'compare' && g.headers && (
        <>
          {g.headers.map((h, i) => (
            <g key={h.text}>
              <rect
                x={h.x}
                y={h.y}
                width={h.w}
                height={34}
                rx={10}
                fill={i === 0 ? '#DCEBFA' : '#FCE3D2'}
              />
              <text
                x={h.x + h.w / 2}
                y={h.y + 23}
                textAnchor="middle"
                fontFamily={HAND}
                fontSize={19}
                fontWeight={700}
                fill={INK.ink}
              >
                {h.text}
              </text>
            </g>
          ))}
          {g.center && (
            <g>
              <circle cx={g.center.x} cy={g.center.y} r={20} fill={INK.teacher} />
              <text
                x={g.center.x}
                y={g.center.y + 5}
                textAnchor="middle"
                fontFamily={HAND}
                fontSize={15}
                fontWeight={700}
                fill="#FFFFFF"
              >
                vs
              </text>
            </g>
          )}
        </>
      )}

      {edges.map((e, i) => {
        const a = g.boxes[e.from];
        const b = g.boxes[e.to];
        if (!a || !b) return null;
        const p1 = edgePoint(a, b.x + b.w / 2, b.y + b.h / 2);
        const p2 = edgePoint(b, a.x + a.w / 2, a.y + a.h / 2);
        let mx = (p1.x + p2.x) / 2;
        let my = (p1.y + p2.y) / 2;
        if (g.layout === 'cycle' && g.center) {
          // Bow outward so the loop reads as a loop.
          const ox = mx - g.center.x;
          const oy = my - g.center.y;
          const len = Math.hypot(ox, oy) || 1;
          mx += (ox / len) * 28;
          my += (oy / len) * 28;
        }
        const ang = Math.atan2(p2.y - my, p2.x - mx);
        // Label at the true midpoint of the curve.
        const lx = (p1.x + 2 * mx + p2.x) / 4;
        const ly = (p1.y + 2 * my + p2.y) / 4;
        return (
          <g key={i}>
            <path
              d={`M${p1.x},${p1.y} Q${mx},${my} ${p2.x},${p2.y}`}
              fill="none"
              stroke={INK.ink}
              strokeWidth={1.9}
              strokeLinecap="round"
            />
            {/* 60 FPS animated SVG flow pulse */}
            <path
              d={`M${p1.x},${p1.y} Q${mx},${my} ${p2.x},${p2.y}`}
              fill="none"
              stroke={g.layout === 'cycle' ? '#E05D38' : '#3B82F6'}
              strokeWidth={2.4}
              strokeDasharray="6 8"
              strokeLinecap="round"
              opacity={0.75}
            >
              <animate
                attributeName="stroke-dashoffset"
                values="28;0"
                dur={g.layout === 'cycle' ? '1.3s' : '1.8s'}
                repeatCount="indefinite"
              />
            </path>
            <path
              d={arrowHead(p2.x, p2.y, ang, 9)}
              fill="none"
              stroke={INK.ink}
              strokeWidth={1.9}
              strokeLinecap="round"
            />
            {e.label && <EdgeLabel x={lx} y={ly} text={e.label} />}
          </g>
        );
      })}

      {el.nodes.map((n) => {
        const r = g.boxes[n.id];
        if (!r) return null;
        return (
          <DiagramNode
            key={n.id}
            n={n}
            r={r}
            seed={`${pe.el.id}-${n.id}`}
            fs={hub && n.id === hub.id ? g.fs + 2 : g.fs}
            band={g.layout === 'layers'}
          />
        );
      })}

      {g.cards &&
        el.nodes.map((n, i) => {
          const card = g.cards?.[n.id];
          const nodeRect = g.boxes[n.id];
          if (!card || !nodeRect) return null;
          return (
            <InfoCard
              key={`card-${n.id}`}
              n={n}
              card={card}
              index={i}
              nodeRect={nodeRect}
              seed={`${pe.el.id}-${n.id}`}
            />
          );
        })}
    </>
  );
}

function ListEl({ pe }: { pe: PlacedEl }) {
  const el = pe.el as Extract<PlacedEl['el'], { kind: 'list' }>;
  const g = pe.geom as ListGeom;
  return (
    <>
      <Label text={el.label} />
      {g.items.map((it, i) => (
        <g key={i}>
          <circle cx={8} cy={it.y + g.lh / 2} r={4} fill={INK.teacher} />
          {it.lines.map((ln, j) => (
            <text
              key={j}
              x={24}
              y={it.y + j * g.lh + g.fs}
              fontFamily={HAND}
              fontSize={g.fs}
              fill={INK.ink}
            >
              {ln}
            </text>
          ))}
        </g>
      ))}
    </>
  );
}

function MediaEl({ pe }: { pe: PlacedEl }) {
  const t = useT();
  const el = pe.el as Extract<PlacedEl['el'], { kind: 'media' }>;
  const g = pe.geom as MediaGeom;
  const mediaMap = useContext(MediaContext);
  const mediaActions = useContext(MediaActionContext);
  const media = mediaMap[el.id];
  const isRejected = media === 'rejected';
  const ready = media && media !== 'failed' && media !== 'rejected' ? media : null;
  const clipId = `media-clip-${pe.el.id}`;

  return (
    <>
      <defs>
        <clipPath id={clipId}>
          <rect x={0} y={0} width={g.mediaW} height={g.mediaH} rx={14} />
        </clipPath>
      </defs>

      {/* Media Card Frame */}
      <rect
        x={0}
        y={0}
        width={g.mediaW}
        height={g.mediaH}
        rx={14}
        fill="#F7F5EE"
        stroke="#E2DCD0"
        strokeWidth={1.5}
      />

      {isRejected ? (
        <g>
          <rect
            x={14}
            y={14}
            width={g.mediaW - 28}
            height={g.mediaH - 28}
            rx={10}
            fill="#FEFDF9"
            stroke="#E2DCD0"
            strokeWidth={1.5}
            strokeDasharray="5 5"
          />
          <text
            x={g.mediaW / 2}
            y={g.mediaH / 2 - 16}
            textAnchor="middle"
            fontFamily="ui-sans-serif, sans-serif"
            fontSize={28}
          >
            🔬
          </text>
          <text
            x={g.mediaW / 2}
            y={g.mediaH / 2 + 14}
            textAnchor="middle"
            fontFamily={HAND}
            fontSize={17}
            fontWeight={700}
            fill={INK.ink}
          >
            {el.caption || 'Concept Illustration'}
          </text>
          <text
            x={g.mediaW / 2}
            y={g.mediaH / 2 + 36}
            textAnchor="middle"
            fontFamily="ui-sans-serif, system-ui, sans-serif"
            fontSize={12}
            fill="#78716C"
          >
            Illustration hidden by student · Concept structure and notes displayed
          </text>
        </g>
      ) : ready ? (
        ready.mime.startsWith('video') ? (
          <foreignObject x={0} y={0} width={g.mediaW} height={g.mediaH} clipPath={`url(#${clipId})`}>
            <video
              src={ready.url}
              autoPlay
              loop
              muted
              playsInline
              controls
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </foreignObject>
        ) : (
          <g clipPath={`url(#${clipId})`}>
            <image
              href={ready.url}
              x={0}
              y={0}
              width={g.mediaW}
              height={g.mediaH}
              preserveAspectRatio="xMidYMid meet"
            />
          </g>
        )
      ) : (
        <g>
          <text
            x={g.mediaW / 2}
            y={g.mediaH / 2 - 12}
            textAnchor="middle"
            fontFamily="ui-sans-serif, sans-serif"
            fontSize={28}
          >
            🎨
          </text>
          <motion.text
            x={g.mediaW / 2}
            y={g.mediaH / 2 + 20}
            textAnchor="middle"
            fontFamily={HAND}
            fontSize={18}
            fill={INK.teacher}
            animate={media === 'failed' ? { opacity: 1 } : { opacity: [0.4, 1, 0.4] }}
            transition={media === 'failed' ? {} : { duration: 1.4, repeat: Infinity }}
          >
            {media === 'failed'
              ? t.imageUnavailable
              : el.media === 'video'
                ? 'Creating video simulation…'
                : t.preparingTopicImage}
          </motion.text>
        </g>
      )}

      {/* Floating Source Badge */}
      {ready && (
        <g data-snapshot-skip>
          <rect
            x={g.mediaW - 240}
            y={g.mediaH - 34}
            width={228}
            height={24}
            rx={12}
            fill="#FFFFFF"
            fillOpacity={0.92}
            stroke="#E2DCD0"
            strokeWidth={1}
          />
          <text
            x={g.mediaW - 126}
            y={g.mediaH - 18}
            textAnchor="middle"
            fontFamily={MONO}
            className="mono"
            fontSize={11}
            fontWeight={600}
            fill={INK.teacher}
          >
            {ready.source
              ? ready.source.slice(0, 32)
              : el.media === 'video'
                ? 'AI · Video Clip'
                : 'AI-generated illustration'}
          </text>
        </g>
      )}

      {/* Rejection safeguard button */}
      {ready && mediaActions.onReject && (
        <g
          data-snapshot-skip
          className="cursor-pointer select-none"
          onClick={() => mediaActions.onReject?.(el.id)}
        >
          <title>Reject image if text is unreadable or inaccurate</title>
          <rect
            x={g.mediaW - 138}
            y={12}
            width={126}
            height={24}
            rx={12}
            fill="#FEF2F2"
            fillOpacity={0.94}
            stroke="#FCA5A5"
            strokeWidth={1}
          />
          <text
            x={g.mediaW - 75}
            y={28}
            textAnchor="middle"
            fontFamily="ui-sans-serif, system-ui, sans-serif"
            fontSize={11}
            fontWeight={600}
            fill="#DC2626"
          >
            🚫 Hide Unreadable
          </text>
        </g>
      )}

      {/* Top Caption Pill */}
      {el.caption && !isRejected && (
        <g>
          <rect
            x={12}
            y={12}
            width={Math.min(g.mediaW - 156, el.caption.length * 8.2 + 24)}
            height={26}
            rx={13}
            fill="#1E293B"
            fillOpacity={0.84}
          />
          <text
            x={24}
            y={29}
            fontFamily="ui-sans-serif, system-ui, sans-serif"
            fontSize={12}
            fontWeight={600}
            fill="#F8FAFC"
          >
            {el.caption.length > 44 ? `${el.caption.slice(0, 44)}…` : el.caption}
          </text>
        </g>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function IllustrationEl({ pe }: { pe: PlacedEl }) {
  const el = pe.el as Extract<PlacedEl['el'], { kind: 'illustration' }>;
  const g = pe.geom as IllustrationGeom;
  const pad = (pe.w - g.illusW) / 2;
  const actions = el.actions ?? [{ action: 'SHOW' as const }];
  const has = (action: string) => actions.some((item) => item.action === action);
  const parts = el.parts ?? [];
  const sourceW = parts.length ? Math.ceil(Math.max(...parts.map((part) => part.x + part.w)) / 100) * 100 : 200;
  const scale = g.illusW / sourceW;
  const partFor = (target?: string) => {
    const key = (target ?? '').trim().toLowerCase();
    return parts.find((part) => part.id.toLowerCase() === key || part.label.toLowerCase() === key);
  };
  const pointFor = (part: NonNullable<ReturnType<typeof partFor>>) => ({
    x: pad + (part.x + part.w / 2) * scale,
    y: 8 + (part.y + part.h / 2) * scale,
  });
  const actionText = actions
    .filter((item) => item.action !== 'SHOW')
    .slice(0, 2)
    .map((item) => item.label ?? item.action.toLowerCase())
    .join(' · ');
  return (
    <>
      {/* Hand-drawn frame */}
      <path
        d={sketchRect(0, 0, pe.w, g.illusH + 16, pe.el.id)}
        fill="#FCFBF7"
        stroke="#E2DCD0"
        strokeWidth={1.5}
      />
      {/* SVG illustration rendered inside */}
      <g transform={`translate(${pad}, 8) scale(${scale})`}>
        <motion.g
          animate={has('ZOOM') || has('ANIMATE') ? { scale: [0.96, 1, 0.98, 1] } : { scale: 1 }}
          transition={{ duration: 2.4, repeat: has('ANIMATE') ? Infinity : 0, ease: 'easeInOut' }}
          dangerouslySetInnerHTML={{ __html: el.svg.replace(/<svg[^>]*>/, '').replace(/<\/svg>/, '') }}
        />
      </g>
      {actions.map((action, index) => {
        const part = partFor(action.target);
        if (!part || !['HIGHLIGHT', 'PULSE', 'LABEL', 'ZOOM'].includes(action.action)) return null;
        const x = pad + part.x * scale;
        const y = 8 + part.y * scale;
        const w = part.w * scale;
        const h = part.h * scale;
        return (
          <g key={`${action.action}-${part.id}-${index}`}>
            {action.action !== 'LABEL' && <motion.rect x={x} y={y} width={w} height={h} rx={10} fill="#FCE9A955" stroke="#E4A34A" strokeWidth={2} strokeDasharray={action.action === 'PULSE' ? '5 5' : undefined} animate={action.action === 'ZOOM' ? { opacity: [0.35, 1, 0.35], strokeWidth: [2, 4, 2] } : undefined} transition={action.action === 'ZOOM' ? { duration: 1.3, repeat: Infinity } : undefined} />}
            {action.action === 'PULSE' && <animate attributeName="opacity" values=".45;1;.45" dur="1.4s" repeatCount="indefinite" />}
            {(action.action === 'LABEL' || action.label) && <text x={x + w / 2} y={Math.max(16, y - 6)} textAnchor="middle" fontFamily={MONO} fontSize={10} fontWeight={700} fill={INK.teacher}>{(action.label ?? part.label).slice(0, 28)}</text>}
          </g>
        );
      })}
      {parts.length === 0 && (has('HIGHLIGHT') || has('PULSE')) && (
        <circle cx={pe.w / 2} cy={g.illusH / 2 + 8} r={g.illusW * 0.4} fill="none" stroke="#E4A34A" strokeWidth={2} strokeDasharray="5 5" opacity={0.8}>
          {has('PULSE') && <animate attributeName="r" values={`${g.illusW * 0.35};${g.illusW * 0.43};${g.illusW * 0.35}`} dur="1.8s" repeatCount="indefinite" />}
        </circle>
      )}
      {actions.filter((action) => action.action === 'FLOW' || action.action === 'CONNECT').map((action, index) => {
        const [fromId, toId] = (action.target ?? '').split(/\s*(?:->|→)\s*/);
        const from = partFor(fromId);
        const to = partFor(toId);
        if (!from || !to) return null;
        const a = pointFor(from), b = pointFor(to);
        return <path key={`flow-${index}`} d={`M${a.x} ${a.y} C${(a.x + b.x) / 2} ${a.y}, ${(a.x + b.x) / 2} ${b.y}, ${b.x} ${b.y}`} fill="none" stroke="#C4704F" strokeWidth={2.5} strokeDasharray="5 6" opacity={0.85}><animate attributeName="stroke-dashoffset" values="22;0" dur="1.3s" repeatCount="indefinite" /></path>;
      })}
      {actionText && !actions.some((action) => action.action === 'LABEL') && (
        <text x={12} y={22} fontFamily={MONO} fontSize={10} fontWeight={700} fill={INK.teacher}>
          {actionText.slice(0, 28).toUpperCase()}
        </text>
      )}
      {/* Label */}
      {el.label && (
        <text
          x={pe.w / 2}
          y={g.illusH + 16 + g.labelH - 4}
          textAnchor="middle"
          fontFamily={HAND}
          fontSize={16}
          fill={INK.soft}
        >
          {el.label}
        </text>
      )}
    </>
  );
}

export function BoardElement({ pe }: { pe: PlacedEl }) {
  let body: React.ReactNode;
  switch (pe.el.kind) {
    case 'text':
      body = <TextEl pe={pe} />;
      break;
    case 'note':
      body = <NoteEl pe={pe} />;
      break;
    case 'code':
      body = <CodeEl pe={pe} />;
      break;
    case 'array':
      body = <ArrayEl pe={pe} />;
      break;
    case 'chain':
      body = <ChainEl pe={pe} />;
      break;
    case 'tree':
      body = <TreeEl pe={pe} />;
      break;
    case 'table':
      body = <TableEl pe={pe} />;
      break;
    case 'diagram':
      body = <DiagramEl pe={pe} />;
      break;
    case 'list':
      body = <ListEl pe={pe} />;
      break;
    case 'illustration':
      body = <IllustrationEl pe={pe} />;
      break;
    case 'media':
      body = <MediaEl pe={pe} />;
      break;
  }
  return (
    <motion.g
      data-el={pe.el.id}
      data-step={pe.step}
      initial={{ x: pe.x, y: pe.y }}
      animate={{ x: pe.x, y: pe.y }}
      transition={{ type: 'spring', stiffness: 140, damping: 22 }}
    >
      <WriteIn id={pe.el.id} w={pe.w} h={pe.h} delay={0.45 + pe.order * WRITE_STAGGER}>
        {body}
      </WriteIn>
    </motion.g>
  );
}

export function StepTitle({ ps }: { ps: PlacedStep }) {
  const rawTitle = ps.step.title;
  if (!rawTitle) return null;
  const isQuestion = rawTitle.toLowerCase().startsWith('q:') || rawTitle.includes('?');
  const displayTitle = isQuestion && !rawTitle.startsWith('Q:') ? `Q: ${rawTitle}` : rawTitle;
  const badgeW = Math.min(ps.w, displayTitle.length * 10 + 44);
  return (
    <motion.g
      data-step={ps.index}
      initial={{ x: ps.x, y: ps.y }}
      animate={{ x: ps.x, y: ps.y }}
      transition={{ type: 'spring', stiffness: 140, damping: 22 }}
    >
      <WriteIn id={`title-${ps.step.id}`} w={badgeW} h={44} delay={0}>
        <g>
          <rect
            x={0}
            y={6}
            width={badgeW}
            height={34}
            rx={17}
            fill={isQuestion ? '#F0ECE1' : '#F7F4EB'}
            stroke={isQuestion ? '#D4CBBF' : '#E2DCD0'}
            strokeWidth={1.5}
          />
          <text
            x={16}
            y={28}
            fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif"
            fontSize={14}
            fontWeight={600}
            fill="#332B25"
          >
            {displayTitle}
          </text>
        </g>
      </WriteIn>
    </motion.g>
  );
}
