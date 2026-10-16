'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useDataChannel, useSessionContext } from '@livekit/components-react';
import { jsPDF } from 'jspdf';
import { useT } from '../i18n';
import { loadBoard, loadMedia, saveBoard, saveMedia } from './archive';
import { BoardElement, INK, LiveSpeechCard, LiveSpeechContext, MediaActionContext, MediaContext, StepTitle } from './elements';
import { activateConcept, createSpeechTrackingState, processSpeechLines } from './speech-tracker';
import { type ImageEntry, visibleImageSteps } from './image-layout';
import { type BoardLayout, HAND, findStepTarget, layoutBoard, targetRect, targetText } from './layout';
import { type Pt, bboxOf, hitTest, shapeOf, snapshotRegion } from './marks';
import {
  type ResearchItem,
  type ResearchOp,
  ResearchPanel,
  reduceResearch,
} from './research-panel';
import { arrowHead, sketchCircle, smoothPath } from './sketch';
import type { BoardOp, El, ImageStatusOp, Rect, Step, StudentMark } from './types';

/**
 * The shared whiteboard.
 *
 * Nova draws here while it talks: a lesson arrives as steps, each revealed as
 * Nova reaches it, plus live highlights, arrows and notes when a doubt comes
 * up. The student draws here too — circling or underlining anything turns
 * into a precise question ("line 3 of the code") that Nova hears instantly.
 *
 * Agent -> browser: data channel "nova-board" (small JSON ops).
 * Browser -> agent: text stream "nova-board-student" (marks, with a JPEG of
 * the marked region, which can be far larger than a data packet allows).
 */

export const BOARD_TOPIC = 'nova-board';
export const STUDENT_TOPIC = 'nova-board-student';

// ---------------------------------------------------------------------------
// Board state and engine logic
// ---------------------------------------------------------------------------

import {
  type Annot,
  type State,
  EMPTY,
  HL_COLORS,
  withElement,
  reduce,
  type Book,
  type BookOp,
  FIRST_BOOK,
  withPage,
  reduceBook,
  resolveMediaConcept,
  type TutorState,
  deriveTutorState,
  type CheckpointLifecycle,
  type CheckpointStatus,
  checkpointKey,
  createCheckpointState,
  checkpointReducer,
  isCheckpointActive,
  isCheckpointAwaiting,
  isQuestionSpeech,
  isQuestionUtterance,
  syncCheckpointPlayback,
  isLearnerResponseForCheckpoint,
  shouldCompleteCheckpoint,
  getLearnerResponseLine,
} from './board-state';

export type { Annot, State, Book, BookOp, TutorState, CheckpointLifecycle, CheckpointStatus };
export {
  checkpointKey,
  createCheckpointState,
  checkpointReducer,
  isCheckpointActive,
  isCheckpointAwaiting,
  isQuestionSpeech,
  isQuestionUtterance,
  syncCheckpointPlayback,
  isLearnerResponseForCheckpoint,
  shouldCompleteCheckpoint,
  findStepTarget,
};
export {
  EMPTY,
  HL_COLORS,
  withElement,
  reduce,
  FIRST_BOOK,
  withPage,
  reduceBook,
  resolveMediaConcept,
  deriveTutorState,
};

// ---------------------------------------------------------------------------
// Student ink
// ---------------------------------------------------------------------------

type Tool = 'pen' | 'highlighter' | 'hand';
type Stroke = { id: number; pts: Pt[]; tool: Tool; mark: number | null; page: string };
type Mark = {
  id: number;
  page: string;
  box: Rect;
  shape: StudentMark['shape'];
  targets: { target: string; text: string }[];
  status: 'open' | 'asked';
  image?: string;
};

const GROUP_MS = 850; // strokes closer together than this are one mark
const AUTO_ASK_S = 2; // seconds before a circle asks on its own

// ---------------------------------------------------------------------------

/**
 * `chatId` names the archive this board is saved under. With `replay`, the
 * board is read-only: it loads a finished class from the archive instead of
 * listening to a live one.
 */
export function Board({
  onActiveBoardChange,
  fallback,
  chatId,
  replay = false,
  restore = false,
  lines = [],
  isSpeaking: propIsSpeaking,
  isListening: propIsListening,
  roomState: propRoomState,
}: {
  fallback?: React.ReactNode;
  chatId?: string;
  replay?: boolean;
  /** Live, but continuing a saved chat: load its board first. */
  restore?: boolean;
  lines?: { id: string; mine: boolean; text: string; at: number; final?: boolean }[];
  onActiveBoardChange?: (id: string) => void;
  isSpeaking?: boolean;
  isListening?: boolean;
  roomState?: string;
}) {
  const [book, dispatch] = useReducer(reduceBook, FIRST_BOOK);
  const t = useT();
  const [imageRequests, setImageRequests] = useState<Record<string, ImageStatusOp>>({});
  useEffect(() => {
    onActiveBoardChange?.(book.active);
  }, [book.active, onActiveBoardChange]);
  const [research, dispatchResearch] = useReducer(reduceResearch, []);
  const [media, setMedia] = useState<
    Record<string, { url: string; mime: string; source?: string } | 'failed' | 'rejected'>
  >({});
  const [checkpointState, dispatchCheckpoint] = useReducer(
    checkpointReducer,
    undefined,
    createCheckpointState
  );
  const state = book.pages[book.active] ?? EMPTY;
  const session = useSessionContext();
  const room = replay ? undefined : session.room;

  // Stable active concept ID: pointAt element's concept, or the currently revealed step
  const activeConceptId = useMemo(() => {
    if (state.pointAt) {
      const pe = state.steps
        .flatMap((s) => s.elements)
        .find((e) => e.id === state.pointAt?.split('#')[0]);
      if (pe) {
        const stepWithEl = state.steps.find((s) => s.elements.some((e) => e.id === pe.id));
        if (stepWithEl) return stepWithEl.conceptId || stepWithEl.id;
      }
    }
    const currentStep = state.steps[state.revealed - 1];
    return currentStep?.conceptId || currentStep?.id;
  }, [state.pointAt, state.steps, state.revealed]);

  const latestUserQuestion = useMemo(
    () => lines.filter((l) => l.mine).slice(-1)[0]?.text,
    [lines]
  );
  const latestAgentSpeech = useMemo(
    () => lines.filter((l) => !l.mine).slice(-1)[0]?.text,
    [lines]
  );

  const connectionState = propRoomState ?? room?.state ?? (replay ? 'connected' : undefined);
  const isAgentSpeaking = propIsSpeaking !== undefined ? propIsSpeaking : Boolean(latestAgentSpeech);
  const isStudentListening =
    propIsListening !== undefined ? propIsListening : Boolean(latestUserQuestion && !isAgentSpeaking);
  const hasActiveCheck = isCheckpointAwaiting(checkpointState, book.active, activeConceptId);

  const tutorState: TutorState = useMemo(() => {
    return deriveTutorState({
      connectionState,
      isSpeaking: isAgentSpeaking,
      hasActiveCheck,
      isListening: isStudentListening,
      replay,
    });
  }, [connectionState, isAgentSpeaking, hasActiveCheck, isStudentListening, replay]);

  const bookRef = useRef(book);
  bookRef.current = book;

  // --- archive: save the live board as it changes; load it when replaying
  const chatRef = useRef(chatId);
  chatRef.current = chatId;
  // Until a continued chat's board is loaded, do not save the empty one over it.
  const restoredRef = useRef(!restore);
  useEffect(() => {
    if (replay || !chatId || !restoredRef.current) return;
    const snapshot = { book, research };
    const t = setTimeout(() => void saveBoard(chatId, snapshot), 600);
    return () => {
      clearTimeout(t);
      // Also on unmount: ending the class must not drop the last change.
      void saveBoard(chatId, snapshot);
    };
  }, [book, research, chatId, replay]);
  useEffect(() => {
    if (!(replay || restore) || !chatId) return;
    let alive = true;
    void (async () => {
      const saved = await loadBoard<{ book: Book; research: ResearchItem[] }>(chatId);
      const blobs = await loadMedia(chatId);
      if (!alive) return;
      if (saved?.book) dispatch({ op: 'restore', book: saved.book });
      if (saved?.research) dispatchResearch({ op: 'restore', items: saved.research });
      restoredRef.current = true;

      const rejectedIds = new Set(
        Object.values(saved?.book?.pages ?? {}).flatMap((p) => p.rejectedMedia ?? [])
      );

      const restoredEntries = Object.entries(blobs)
        .filter(([id]) => !rejectedIds.has(id))
        .map(([id, m]) => [
          id,
          { url: URL.createObjectURL(m.blob), mime: m.mime, source: m.source },
        ]);
      const rejectedEntries = Array.from(rejectedIds).map((id) => [id, 'rejected' as const]);

      setMedia((live) => {
        const next = { ...Object.fromEntries(restoredEntries), ...live };
        for (const id of rejectedIds) {
          next[id] = 'rejected';
        }
        return next;
      });
    })();
    return () => {
      alive = false;
    };
  }, [replay, restore, chatId]);

  useDataChannel(BOARD_TOPIC, (msg) => {
    if (replay) return;
    try {
      const op = JSON.parse(new TextDecoder().decode(msg.payload)) as BookOp | ResearchOp | ImageStatusOp;
      if (op.op === 'image_status') {
        setImageRequests((previous) => Object.fromEntries(
          Object.entries({ ...previous, [op.id]: op }).slice(-24)
        ));
      }
      else if (op.op.startsWith('research')) dispatchResearch(op as ResearchOp);
      else if (op.op === 'media_fail')
        setMedia((m) => ({ ...m, [(op as { id: string }).id]: 'failed' }));
      else if (op.op === 'checkpoint' || op.op === 'checkpoint_active') {
        const cpOp = op as Record<string, any>;
        const latestStudentLine = lines?.filter((l) => l.mine).slice(-1)[0];
        const latestTeacherLine = lines?.filter((l) => !l.mine).slice(-1)[0];
        dispatchCheckpoint({
          type: 'activate',
          boardId: cpOp.board || book.active,
          conceptId: cpOp.conceptId || activeConceptId,
          checkpointId: cpOp.id,
          speechId: cpOp.speechId,
          question: cpOp.question,
          options: cpOp.options,
          hints: cpOp.hints,
          criteria: cpOp.criteria,
          answerKey: cpOp.answerKey,
          at: Date.now(),
          isSpeaking: isAgentSpeaking,
          lastStudentLineId: latestStudentLine?.id,
          lastTeacherLineId: latestTeacherLine?.id,
        });
      } else if (op.op === 'checkpoint_ready' || op.op === 'checkpoint_playback_done') {
        const cpOp = op as Record<string, any>;
        const latestStudentLine = lines?.filter((l) => l.mine).slice(-1)[0];
        dispatchCheckpoint({
          type: 'await_response',
          boardId: cpOp.board || book.active,
          conceptId: cpOp.conceptId || activeConceptId,
          checkpointId: cpOp.id,
          speechId: cpOp.speechId,
          at: Date.now(),
          lastStudentLineId: latestStudentLine?.id,
        });
      } else if (op.op === 'checkpoint_evaluated') {
        const cpOp = op as Record<string, any>;
        const isCorrectVal = typeof cpOp.isCorrect === 'boolean' ? cpOp.isCorrect : undefined;
        const statusVal = cpOp.status || (isCorrectVal !== undefined ? 'evaluated' : 'pending');
        dispatchCheckpoint({
          type: 'evaluate',
          boardId: cpOp.board || book.active,
          conceptId: cpOp.conceptId || activeConceptId,
          checkpointId: cpOp.checkpointId || cpOp.id,
          isCorrect: isCorrectVal,
          status: statusVal,
          feedback: cpOp.feedback,
          criteriaMet: typeof cpOp.criteriaMet === 'boolean' ? cpOp.criteriaMet : undefined,
          optionId: cpOp.optionId,
          at: cpOp.at || Date.now(),
        });
      } else if (op.op === 'checkpoint_complete') {
        const cpOp = op as Record<string, any>;
        dispatchCheckpoint({
          type: 'complete',
          boardId: cpOp.board || book.active,
          conceptId: cpOp.conceptId || activeConceptId,
          checkpointId: cpOp.id,
          at: Date.now(),
        });
      }
      else dispatch(op as BookOp);
    } catch {
      /* ignore malformed frames */
    }
  });

  // Checkpoint registration: track checks from revealed steps as 'pending'
  useEffect(() => {
    state.steps.slice(0, state.revealed).forEach((s) => {
      const conceptId = s.conceptId || s.id;
      if (s.check?.trim() && conceptId) {
        dispatchCheckpoint({
          type: 'register',
          boardId: book.active,
          conceptId,
          question: s.check.trim(),
          options: s.checkOptions,
          hints: s.checkHints,
          criteria: s.checkCriteria,
        });
      }
    });
  }, [state.steps, state.revealed, book.active]);

  // When question playback starts and finishes, track lifecycle of prepared checkpoints
  const prevSpeakingRef = useRef(isAgentSpeaking);
  useEffect(() => {
    const next = syncCheckpointPlayback({
      state: checkpointState,
      boardId: book.active,
      isSpeaking: isAgentSpeaking,
      wasSpeaking: prevSpeakingRef.current,
      lines,
      now: Date.now(),
    });
    if (next !== checkpointState) {
      dispatchCheckpoint({ type: 'set', state: next });
    }
    prevSpeakingRef.current = isAgentSpeaking;
  }, [isAgentSpeaking, book.active, checkpointState, lines]);

  // Tell the teachers which page the student is looking at, so "ఇది" and
  // "this board" mean the right thing.
  const tellAgent = useCallback(
    (msg: Record<string, unknown>) => {
      room?.localParticipant
        .sendText(JSON.stringify(msg), { topic: STUDENT_TOPIC })
        .catch((err) => console.warn('board message not sent', err));
    },
    [room]
  );

  const handleCheckpointResponse = useCallback(
    ({
      checkpointId,
      conceptId,
      modality,
      response,
      optionId,
    }: {
      checkpointId: string;
      conceptId?: string;
      modality: 'voice' | 'typed' | 'chip';
      response: string;
      optionId?: string;
    }) => {
      const cid = conceptId || activeConceptId;
      dispatchCheckpoint({
        type: 'submit_response',
        boardId: book.active,
        conceptId: cid,
        checkpointId,
        response: response.trim(),
        modality,
        optionId,
        at: Date.now(),
      });
      tellAgent({
        type: 'checkpoint_response',
        checkpointId,
        conceptId: cid,
        board: book.active,
        modality,
        optionId,
        response: response.trim(),
      });
    },
    [activeConceptId, book.active, tellAgent]
  );

  const handleRevealHint = useCallback(
    (checkpointId: string, conceptId?: string) => {
      dispatchCheckpoint({
        type: 'reveal_hint',
        boardId: book.active,
        conceptId: conceptId || activeConceptId,
        checkpointId,
      });
    },
    [activeConceptId, book.active]
  );

  const handleRetryCheckpoint = useCallback(
    (checkpointId: string, conceptId?: string) => {
      dispatchCheckpoint({
        type: 'retry',
        boardId: book.active,
        conceptId: conceptId || activeConceptId,
        checkpointId,
      });
    },
    [activeConceptId, book.active]
  );

  // Checkpoint voice response: when learner speaks strictly after question playback finishes
  useEffect(() => {
    if (!activeConceptId) return;
    const currentCp = checkpointState.checkpoints[checkpointKey(book.active, activeConceptId)];
    if (currentCp?.status !== 'awaiting_response') return;

    const matchingLine = getLearnerResponseLine(currentCp, lines);
    if (matchingLine?.text?.trim()) {
      const respText = matchingLine.text.trim();
      const cpId = currentCp.id || `cp-${activeConceptId}`;
      const isFinal = matchingLine.final !== false;

      if (!isFinal) {
        if (currentCp.interimResponse === respText) return;
        // Retain segment finality: interim fragments update live transcription without locking answer
        dispatchCheckpoint({
          type: 'interim_response',
          boardId: book.active,
          conceptId: activeConceptId,
          checkpointId: cpId,
          response: respText,
          at: matchingLine.at,
        });
      } else {
        // Speech segment finalized: submit final response for grading and feedback
        dispatchCheckpoint({
          type: 'submit_response',
          boardId: book.active,
          conceptId: activeConceptId,
          checkpointId: cpId,
          response: respText,
          modality: 'voice',
          at: matchingLine.at,
        });
        tellAgent({
          type: 'checkpoint_response',
          checkpointId: cpId,
          conceptId: activeConceptId,
          board: book.active,
          modality: 'voice',
          response: respText,
        });
      }
    }
  }, [lines, activeConceptId, book.active, checkpointState, tellAgent]);

  // When advancing to a new step, mark earlier active checkpoints as completed
  const prevRevealedRef = useRef(state.revealed);
  useEffect(() => {
    if (state.revealed > prevRevealedRef.current) {
      const prevStep = state.steps[prevRevealedRef.current - 1];
      const prevConcept = prevStep?.conceptId || prevStep?.id;
      if (prevConcept) {
        dispatchCheckpoint({
          type: 'complete',
          boardId: book.active,
          conceptId: prevConcept,
        });
      }
      prevRevealedRef.current = state.revealed;
    }
  }, [state.revealed, state.steps, book.active]);

  const openPage = (id: string) => {
    if (id === book.active) return;
    dispatch({ op: 'local_open', board: id });
    tellAgent({ type: 'board_open', board: id });
  };
  const newPage = () => {
    const id = `s${Date.now().toString(36)}`;
    const title = `Board ${book.order.length + 1}`;
    dispatch({ op: 'local_new', board: id, title });
    tellAgent({ type: 'board_new', board: id, title });
  };

  // Generated images and clips arrive as byte streams, keyed by element id.
  useEffect(() => {
    if (!room) return;
    const topic = 'nova-media';
    try {
      room.registerByteStreamHandler(topic, async (reader) => {
        try {
          const id = reader.info.attributes?.id ?? reader.info.id;
          const isRejected = Object.values(bookRef.current.pages).some((p) =>
            p.rejectedMedia?.includes(id)
          );
          if (isRejected) {
            setMedia((m) => ({ ...m, [id]: 'rejected' }));
            return;
          }
          const chunks = await reader.readAll();
          // Re-check rejection in case learner rejected the illustration while chunks were downloading
          const wasRejectedDuringRead = Object.values(bookRef.current.pages).some((p) =>
            p.rejectedMedia?.includes(id)
          );
          if (wasRejectedDuringRead) {
            setMedia((m) => ({ ...m, [id]: 'rejected' }));
            return;
          }
          const mime = reader.info.mimeType || 'image/jpeg';
          const blob = new Blob(chunks as BlobPart[], { type: mime });
          const url = URL.createObjectURL(blob);
          const source = reader.info.attributes?.source || undefined;
          setMedia((m) => {
            if (m[id] === 'rejected') return m;
            return { ...m, [id]: { url, mime, source } };
          });
          if (chatRef.current) void saveMedia(chatRef.current, id, { blob, mime, source });
        } catch (err) {
          console.warn('Media byte stream interrupted or incomplete', err);
          const id = reader.info.attributes?.id ?? reader.info.id;
          if (id) {
            setMedia((m) => {
              if (m[id] === 'rejected') return m;
              return { ...m, [id]: 'failed' };
            });
          }
        }
      });
    } catch {
      /* already registered by a previous mount */
    }
    return () => {
      try {
        room.unregisterByteStreamHandler(topic);
      } catch {
        /* ignore */
      }
    };
  }, [room]);

  // --- responsive columns
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(900);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setViewW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Single full-width canvas workspace so diagrams and illustrations flow cleanly top-to-bottom.
  const columns = 1;

  const layout: BoardLayout = useMemo(() => {
    const visible = visibleImageSteps(state.steps, state.revealed, state.images ?? []);
    return layoutBoard(
      visible,
      visible.length,
      columns,
      state.stepNotes,
      activeConceptId,
      isAgentSpeaking,
      checkpointState.checkpoints,
      book.active,
      viewW
    );
  }, [
    state.steps,
    state.revealed,
    state.images,
    columns,
    state.stepNotes,
    activeConceptId,
    isAgentSpeaking,
    checkpointState.checkpoints,
    book.active,
    viewW,
  ]);

  // Track speech segments by board and stable concept ID to prevent cross-board or cross-step leakage
  const speechTrackingState = useRef(createSpeechTrackingState());
  const lastActiveConceptKey = useRef<string>('');
  const stepNotesRef = useRef(state.stepNotes);
  stepNotesRef.current = state.stepNotes;

  useEffect(() => {
    if (!lines || !activeConceptId) return;

    // Refresh concept activation boundary when active concept or board changes
    const activeKey = `${book.active}::${activeConceptId}`;
    if (lastActiveConceptKey.current !== activeKey) {
      lastActiveConceptKey.current = activeKey;
      const latestExistingLineId =
        lines.filter((l) => !l.mine && l.text?.trim()).slice(-1)[0]?.id ?? '';
      activateConcept(speechTrackingState.current, book.active, activeConceptId, latestExistingLineId);
    }

    const { notes, hasChanges } = processSpeechLines({
      state: speechTrackingState.current,
      boardId: book.active,
      activeConceptId,
      lines,
      initialStepNotes: stepNotesRef.current,
    });

    if (hasChanges) {
      for (const [cid, text] of Object.entries(notes)) {
        if (stepNotesRef.current?.[cid] !== text) {
          dispatch({ op: 'step_note', conceptId: cid, text, board: book.active });
        }
      }
    }
  }, [lines, activeConceptId, book.active]);

  const handleRejectMedia = useCallback((id: string) => {
    dispatch({ op: 'media_reject', id, board: book.active });
    setMedia((m) => ({ ...m, [id]: 'rejected' }));
    const ownerConceptId = resolveMediaConcept(state.steps, state.images, id) || activeConceptId;
    tellAgent({
      type: 'media_rejected',
      id,
      board: book.active,
      conceptId: ownerConceptId,
    });
  }, [tellAgent, book.active, state.steps, state.images, activeConceptId]);

  const isMobile = viewW <= 640;
  const scale = isMobile ? Math.min(1, viewW / layout.width) : Math.min(viewW / layout.width, 0.78);
  // Dock has reserved viewport space outside the canvas; 60px provides clean bottom breathing room.
  const bottomPaddingPx = 60;
  const boardH = Math.max(
    layout.height + bottomPaddingPx / scale,
    ((scrollRef.current?.clientHeight ?? 600) + bottomPaddingPx) / scale
  );

  const jumpToStep = useCallback(
    (stepId: string) => {
      const rect = findStepTarget(layout, stepId);
      if (!rect) return;
      const top = Math.max(0, (rect.y - 20) * scale);
      if (scrollRef.current) {
        if (typeof scrollRef.current.scrollTo === 'function') {
          scrollRef.current.scrollTo({
            top,
            behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 'auto' : 'smooth',
          });
        } else {
          scrollRef.current.scrollTop = top;
        }
      }
    },
    [layout, scale]
  );

  // --- follow Nova: keep whatever it just drew or pointed at in view
  const followRect = useMemo<Rect | undefined>(() => {
    if (state.pointAt) return targetRect(layout, state.pointAt);
    const last = layout.steps[layout.steps.length - 1];
    return last ? { x: last.x, y: last.y, w: last.w, h: last.h } : undefined;
  }, [layout, state.pointAt]);
  // Auto-scroll disabled: let the student scroll the board at their own pace.
  // The board grows downward as new content is added; the student scrolls to explore.

  // --- Nova's marker: shows where it is pointing, then fades
  const [pointerOn, setPointerOn] = useState(false);
  useEffect(() => {
    if (!state.pointAt) return;
    setPointerOn(true);
    const t = setTimeout(() => setPointerOn(false), 3500);
    return () => clearTimeout(t);
  }, [state.pointSeq, state.pointAt]);
  const pointerRect = state.pointAt ? targetRect(layout, state.pointAt) : undefined;

  // --- student ink
  const svgRef = useRef<SVGSVGElement>(null);
  const [tool, setTool] = useState<Tool>('pen');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [marks, setMarks] = useState<Mark[]>([]);
  const drawing = useRef<Stroke | null>(null);
  const groupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStrokes = useRef<number[]>([]);
  const strokePts = useRef(new Map<number, Pt[]>()); // read synchronously when a mark closes
  const nextId = useRef(1);

  const toBoard = useCallback((e: React.PointerEvent): Pt => {
    const svg = svgRef.current!;
    const m = svg.getScreenCTM();
    if (!m) return [0, 0];
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [p.x, p.y];
  }, []);

  const sendMark = useCallback(
    async (mark: Mark, ask: boolean) => {
      if (!room) return;
      const payload: StudentMark = {
        type: 'mark',
        id: String(mark.id),
        board: mark.page,
        ask,
        shape: mark.shape,
        targets: mark.targets,
        image: mark.image,
      };
      try {
        await room.localParticipant.sendText(JSON.stringify(payload), { topic: STUDENT_TOPIC });
      } catch (err) {
        console.warn('could not send mark', err);
      }
    },
    [room]
  );

  const finishMark = useCallback(async () => {
    if (replay) {
      pendingStrokes.current = []; // a finished class has no teacher to ask
      return;
    }
    const ids = pendingStrokes.current;
    pendingStrokes.current = [];
    if (!ids.length) return;
    const markId = nextId.current++;
    const mine = ids.map((id) => strokePts.current.get(id) ?? []);
    const pts = mine.flat();
    const firstPts = mine[0] ?? [];
    setStrokes((prev) => prev.map((s) => (ids.includes(s.id) ? { ...s, mark: markId } : s)));
    if (!pts.length) return;
    const box = bboxOf(pts);
    const shape = ids.length === 1 ? shapeOf(firstPts, box) : 'scribble';
    const targets = hitTest(layout, box, shape).map((t) => {
      const pe = layout.els.find((e) => e.el.id === t.split('#')[0]);
      let text = targetText(layout, t);
      // On a picture, say WHERE on it — "the image" alone tells the teacher nothing.
      if (pe?.el.kind === 'media') {
        const g = pe.geom as { labelH: number; mediaW: number; mediaH: number };
        const fx = Math.round(((box.x + box.w / 2 - pe.x) / g.mediaW) * 100);
        const fy = Math.round(((box.y + box.h / 2 - pe.y - g.labelH) / g.mediaH) * 100);
        text += ` — the mark is around ${Math.max(0, Math.min(100, fx))}% from the left and ${Math.max(0, Math.min(100, fy))}% from the top of the picture`;
      }
      return { target: t, text };
    });

    // Snapshot the mark plus whatever it points at, with some context around.
    const region = [
      box,
      ...targets.map((t) => targetRect(layout, t.target)).filter(Boolean),
    ] as Rect[];
    const x0 = Math.max(0, Math.min(...region.map((r) => r.x)) - 60);
    const y0 = Math.max(0, Math.min(...region.map((r) => r.y)) - 60);
    const x1 = Math.min(layout.width, Math.max(...region.map((r) => r.x + r.w)) + 60);
    const y1 = Math.max(...region.map((r) => r.y + r.h)) + 60;
    const image = svgRef.current
      ? await snapshotRegion(svgRef.current, {
          x: x0,
          y: y0,
          w: Math.max(200, x1 - x0),
          h: Math.max(120, y1 - y0),
        })
      : undefined;

    const mark: Mark = {
      id: markId,
      page: book.active,
      box,
      shape,
      targets,
      status: 'open',
      image,
    };
    setMarks((prev) => [...prev.filter((m) => m.status === 'asked').slice(-3), mark]);
    // Context only: if the student now just SAYS "idhi enti?", Nova knows what "idhi" is.
    void sendMark(mark, false);
  }, [layout, sendMark, book.active, replay]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (tool === 'hand' || e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.closest('button, input, textarea, form, select, a, [data-interactive]') ||
        ['button', 'input', 'textarea', 'form', 'select', 'a'].includes(target.tagName.toLowerCase()))
    ) {
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    if (groupTimer.current) clearTimeout(groupTimer.current);
    const s: Stroke = {
      id: nextId.current++,
      pts: [toBoard(e)],
      tool,
      mark: null,
      page: book.active,
    };
    drawing.current = s;
    strokePts.current.set(s.id, s.pts);
    setStrokes((prev) => [...prev, s]);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = drawing.current;
    if (!s) return;
    const p = toBoard(e);
    const last = s.pts[s.pts.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 2) return;
    s.pts = [...s.pts, p];
    strokePts.current.set(s.id, s.pts);
    setStrokes((prev) => prev.map((x) => (x.id === s.id ? { ...s } : x)));
  };
  const onPointerUp = () => {
    const s = drawing.current;
    drawing.current = null;
    if (!s) return;
    pendingStrokes.current.push(s.id);
    if (groupTimer.current) clearTimeout(groupTimer.current);
    groupTimer.current = setTimeout(() => void finishMark(), GROUP_MS);
  };

  const ask = (mark: Mark) => {
    setMarks((prev) => prev.map((m) => (m.id === mark.id ? { ...m, status: 'asked' } : m)));
    void sendMark(mark, true);
  };
  const dismiss = (mark: Mark) => {
    setMarks((prev) => prev.filter((m) => m.id !== mark.id));
    setStrokes((prev) => prev.filter((s) => s.mark !== mark.id));
  };
  const eraseAll = () => {
    // This page's ink only; other boards keep theirs.
    setStrokes((prev) => prev.filter((s) => s.page !== book.active));
    setMarks((prev) => prev.filter((m) => m.page !== book.active));
    pendingStrokes.current = [];
  };

  const exportBoard = async () => {
    if (!svgRef.current) return;
    const steps = layout.steps;
    const baseTitle = (state.title || 'whiteboard-lesson').toLowerCase().replace(/\s+/g, '-');
    const pdf = new jsPDF({
      orientation: 'landscape',
      unit: 'pt',
      format: [960, 540],
    });

    if (steps.length === 0) {
      const r = { x: 0, y: 0, w: layout.width, h: Math.max(Math.round((layout.width * 9) / 16), 400) };
      const dataUrl = await snapshotRegion(svgRef.current, r, 1920);
      if (dataUrl) {
        pdf.addImage(dataUrl, 'PNG', 0, 0, 960, 540);
        pdf.save(`${baseTitle}-slides.pdf`);
      }
      return;
    }

    for (let i = 0; i < steps.length; i++) {
      const ps = steps[i];
      // Keep exact 16:9 ratio centered around this step
      const stepH = Math.max(ps.h + 50, 480);
      const targetH = Math.max(Math.round((layout.width * 9) / 16), stepH);
      const targetW = Math.round((targetH * 16) / 9);
      const offsetX = Math.round((layout.width - targetW) / 2);
      const slideRect = {
        x: offsetX,
        y: Math.max(0, ps.y - 15),
        w: targetW,
        h: targetH,
      };

      const dataUrl = await snapshotRegion(svgRef.current, slideRect, 1920, ps.index);
      if (!dataUrl) {
        console.error(`Snapshot failed for slide ${i + 1}`);
        alert(`Failed to export slide ${i + 1}. Export cancelled.`);
        return;
      }
      if (i > 0) {
        pdf.addPage([960, 540], 'landscape');
      }
      pdf.addImage(dataUrl, 'PNG', 0, 0, 960, 540);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(140, 130, 120);
      const footerText = `${state.title || 'Lesson Whiteboard'}  |  Slide ${i + 1} of ${steps.length}`;
      pdf.text(footerText, 28, 526);
    }

    pdf.save(`${baseTitle}-slides.pdf`);
  };

  const pageStrokes = strokes.filter((s) => s.page === book.active);
  const pageMarks = marks.filter((m) => m.page === book.active);
  const empty = state.revealed === 0 && !state.planning && !state.images?.length;
  const pageImages = Object.values(imageRequests).filter((request) => request.board === book.active);
  const pendingImages = pageImages.filter((request) => request.status === 'generating');
  const lastImageFailed = pageImages.at(-1)?.status === 'failed';
  const readyImage = [...pageImages].reverse().find((request) => request.status === 'done');
  const viewImage = () => {
    if (!readyImage) return;
    const rect = targetRect(layout, readyImage.id);
    if (!rect) return;
    scrollRef.current?.scrollTo({
      top: Math.max(0, (rect.y - 20) * scale),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  };
  if (empty && fallback && strokes.length === 0 && book.order.length === 1 && research.length === 0)
    return <>{fallback}</>;

  return (
    <div className="flex h-full w-full flex-col xl:flex-row">
      <div
        className="relative flex min-h-0 min-w-0 flex-1 flex-col"
        style={{ background: INK.board }}
      >
        {/* header: lesson title + tools */}
        <div
          className="nova-board-toolbar flex items-center gap-3 px-5 py-3"
          style={{ borderBottom: `1px solid ${INK.grid}` }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
            {book.order.map((id, i) => {
              const pg = book.pages[id];
              const on = id === book.active;
              return (
                <button
                  key={id}
                  onClick={() => openPage(id)}
                  title={pg.title}
                  className="max-w-[180px] shrink-0 truncate rounded-xl px-3 py-1.5 text-[15px] transition"
                  style={{
                    fontFamily: 'var(--font-hand)',
                    fontWeight: on ? 700 : 400,
                    color: on ? INK.ink : INK.soft,
                    background: on ? '#FFFFFF' : 'transparent',
                    border: `1px solid ${on ? INK.faint : 'transparent'}`,
                  }}
                >
                  <span style={{ color: INK.teacher }}>{i + 1}</span>{' '}
                  {pg.planning && pg.revealed === 0 ? pg.planning : pg.title}
                </button>
              );
            })}
            <button
              onClick={newPage}
              title="New board — the old ones stay"
              aria-label="New board"
              className="flex size-8 shrink-0 items-center justify-center rounded-xl text-[18px] transition hover:brightness-95"
              style={{ color: INK.soft, border: `1px dashed ${INK.faint}` }}
            >
              +
            </button>
          </div>
          <Tools
            tool={tool}
            setTool={setTool}
            onErase={eraseAll}
            canErase={pageStrokes.length > 0}
            onExport={exportBoard}
          />
        </div>

        {/* Concept Navigation Breadcrumbs & Live Tutor Status Bar */}
        {state.steps.length > 0 && (
          <div
            className="nova-board-roadmap flex items-center justify-between gap-3 px-5 py-2 text-xs"
            style={{ borderBottom: `1px solid ${INK.grid}`, background: '#FAF8F4' }}
          >
            <nav aria-label="Lesson concepts" className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-0.5">
              <span className="font-mono text-[10px] uppercase tracking-wider shrink-0" style={{ color: INK.soft }}>
                Roadmap:
              </span>
              {state.steps.map((step, idx) => {
                const isRevealed = idx < state.revealed;
                const isActive = (step.conceptId || step.id) === activeConceptId;
                const isCompleted = isRevealed && !isActive;
                const stepNum = idx + 1;
                const title = step.title || `Concept ${stepNum}`;

                return (
                  <button
                    key={step.id}
                    type="button"
                    disabled={!isRevealed}
                    onClick={() => jumpToStep(step.id)}
                    title={isRevealed ? `Jump to ${title}` : `${title} (Upcoming)`}
                    className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                      isActive
                        ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-300 font-semibold'
                        : isCompleted
                          ? 'bg-stone-100 text-stone-700 hover:bg-stone-200/80 cursor-pointer'
                          : 'bg-transparent text-stone-400 opacity-60 cursor-not-allowed'
                    }`}
                  >
                    <span
                      className={`flex size-4 items-center justify-center rounded-full text-[10px] font-mono ${
                        isActive
                          ? 'bg-amber-600 text-white font-bold'
                          : isCompleted
                            ? 'bg-stone-300 text-stone-700 font-semibold'
                            : 'border border-stone-300 text-stone-400'
                      }`}
                    >
                      {isCompleted ? '✓' : stepNum}
                    </span>
                    <span className="truncate max-w-[150px]">{title}</span>
                  </button>
                );
              })}
            </nav>

            {!replay && (
              <div
                className="flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold"
                style={{
                  background:
                    tutorState === 'Explaining'
                      ? '#FEF3C7'
                      : tutorState === 'Waiting for answer'
                        ? '#FEF9C3'
                        : tutorState === 'Listening'
                          ? '#DCFCE7'
                          : tutorState === 'Reconnecting'
                            ? '#FEE2E2'
                            : '#F1EFEA',
                  color:
                    tutorState === 'Explaining'
                      ? '#92400E'
                      : tutorState === 'Waiting for answer'
                        ? '#854D0E'
                        : tutorState === 'Listening'
                          ? '#166534'
                          : tutorState === 'Reconnecting'
                            ? '#991B1B'
                            : '#57534E',
                }}
              >
                <span
                  className={`size-2 rounded-full ${
                    tutorState === 'Explaining'
                      ? 'bg-amber-500 animate-pulse'
                      : tutorState === 'Waiting for answer'
                        ? 'bg-yellow-500 animate-bounce'
                        : tutorState === 'Listening'
                          ? 'bg-green-500 animate-pulse'
                          : tutorState === 'Reconnecting'
                            ? 'bg-red-500 animate-ping'
                            : 'bg-stone-400'
                  }`}
                />
                <span>Acharya: {tutorState}</span>
              </div>
            )}
          </div>
        )}

        {!replay && (pendingImages.length > 0 || lastImageFailed || readyImage) && (
          <div className="nova-board-media-status flex items-center justify-between gap-3 px-5 py-2 text-[13px]" style={{ color: INK.ink, borderBottom: `1px solid ${INK.grid}` }}>
            <p role="status">
            {pendingImages.length > 0
              ? pendingImages.some((request) => request.role === 'explanation') ? t.preparingExplanationImage : t.preparingTopicImage
              : lastImageFailed ? t.imageUnavailable : t.imageReady}
            </p>
            {readyImage && (
              <button type="button" onClick={viewImage} className="min-h-11 shrink-0 rounded-lg border px-3 py-2 font-medium focus-visible:outline-2 focus-visible:outline-offset-2" style={{ borderColor: INK.grid, outlineColor: INK.ink }}>
                {t.viewImage}
              </button>
            )}
          </div>
        )}

        <div
          ref={scrollRef}
          className="relative min-h-0 flex-1 overflow-x-auto overflow-y-auto"
          style={{ touchAction: tool === 'hand' ? 'auto' : 'none' }}
        >
          <div className="relative" style={{ height: boardH * scale }}>
            <svg
              ref={svgRef}
              className="nova-board absolute inset-0 select-none"
              viewBox={`0 0 ${layout.width} ${boardH}`}
              width={viewW}
              height={boardH * scale}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              style={{ cursor: tool === 'hand' ? 'grab' : 'crosshair' }}
            >
              <GridPaper w={layout.width} h={boardH} />

              {/* Nova's highlights sit under the ink so text stays crisp */}
              <g>
                <AnimatePresence>
                  {state.annots
                    .filter((a) => a.kind === 'hl')
                    .map((a) => {
                      const r = a.kind === 'hl' ? targetRect(layout, a.target) : undefined;
                      if (!r || a.kind !== 'hl') return null;
                      const targetElId = a.target.split('#')[0];
                      const pe = layout.els.find((e) => e.el.id === targetElId);
                      return (
                        <motion.rect
                          key={a.id}
                          data-step={pe?.step}
                          x={r.x - 6}
                          y={r.y - 3}
                          height={r.h + 6}
                          rx={6}
                          fill={a.color}
                          opacity={0.55}
                          initial={{ width: 0 }}
                          animate={{ width: r.w + 12 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.45, ease: 'easeOut' }}
                        />
                      );
                    })}
                </AnimatePresence>
              </g>

              <LiveSpeechContext.Provider
                value={{
                  agentSpeech: latestAgentSpeech,
                  userQuestion: latestUserQuestion,
                  isSpeaking: isAgentSpeaking,
                  tutorState,
                }}
              >
                {layout.steps.map((ps) => (
                  <StepTitle key={ps.step.id} ps={ps} />
                ))}
                {layout.steps.map((ps) => {
                  if (!ps.companionSlot) return null;
                  const isLatest = ps.conceptId === activeConceptId;
                  const stepText = state.stepNotes?.[ps.conceptId] || ps.step.say || '';
                  const cpKey = checkpointKey(book.active, ps.conceptId);
                  const cpEntry = checkpointState.checkpoints[cpKey];
                  return (
                    <LiveSpeechCard
                      key={`speech-${ps.step.id}`}
                      slot={ps.companionSlot}
                      step={ps.step}
                      isLatest={isLatest}
                      stepIndex={ps.index}
                      speechText={stepText}
                      checkpoint={cpEntry}
                      onResponse={handleCheckpointResponse}
                      onRevealHint={handleRevealHint}
                      onRetry={handleRetryCheckpoint}
                    />
                  );
                })}
                <MediaContext.Provider value={media}>
                  <MediaActionContext.Provider value={{ onReject: handleRejectMedia }}>
                    {layout.els.map((pe) => (
                      <BoardElement key={pe.el.id} pe={pe} />
                    ))}
                  </MediaActionContext.Provider>
                </MediaContext.Provider>
              </LiveSpeechContext.Provider>

              {/* Nova's arrows */}
              {state.annots.map((a) => {
                if (a.kind !== 'arrow') return null;
                const pe = layout.els.find((e) => e.el.id === a.from.split('#')[0]);
                return <TeacherArrow key={a.id} layout={layout} a={a} step={pe?.step} />;
              })}

              {/* student ink */}
              <g>
                {pageStrokes.map((s) => {
                  const strokeY = s.pts[0]?.[1] ?? 0;
                  let st = layout.steps.find((ps) => strokeY >= ps.y && strokeY <= ps.y + ps.h);
                  if (!st && layout.steps.length > 0) {
                    let minDist = Infinity;
                    for (const ps of layout.steps) {
                      const dist = Math.max(0, ps.y - strokeY, strokeY - (ps.y + ps.h));
                      if (dist < minDist) {
                        minDist = dist;
                        st = ps;
                      }
                    }
                  }
                  return (
                    <path
                      key={s.id}
                      data-step={st?.index}
                      d={smoothPath(s.pts)}
                      fill="none"
                      stroke={s.tool === 'highlighter' ? INK.studentHi : INK.student}
                      strokeWidth={s.tool === 'highlighter' ? 18 : 3.4}
                      strokeOpacity={s.tool === 'highlighter' ? 0.4 : 0.95}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  );
                })}
              </g>

              {/* Nova's marker pointing at what it is talking about */}
              <AnimatePresence>
                {pointerOn && pointerRect && (
                  <motion.g
                    data-snapshot-skip
                    key="pointer"
                    initial={{
                      opacity: 0,
                      x: pointerRect.x + pointerRect.w + 6,
                      y: pointerRect.y + pointerRect.h / 2,
                    }}
                    animate={{
                      opacity: 1,
                      x: pointerRect.x + pointerRect.w + 6,
                      y: pointerRect.y + pointerRect.h / 2,
                    }}
                    exit={{ opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 120, damping: 18 }}
                  >
                    <g transform="rotate(-35)">
                      <rect x={4} y={-6} width={46} height={12} rx={4} fill={INK.teacher} />
                      <path d="M4,-6 L-8,0 L4,6 Z" fill={INK.teacher} />
                    </g>
                  </motion.g>
                )}
              </AnimatePresence>

              {state.planning && state.revealed === 0 && !state.images?.length && (
                <Planning w={layout.width} topic={state.planning} />
              )}
            </svg>

            {/* mark chips, in screen space over the board */}
            <AnimatePresence>
              {pageMarks.map((m) => (
                <MarkChip
                  key={m.id}
                  mark={m}
                  scale={scale}
                  maxX={viewW}
                  onAsk={() => ask(m)}
                  onDismiss={() => dismiss(m)}
                />
              ))}
            </AnimatePresence>
          </div>

          {empty && pageStrokes.length === 0 && <EmptyBoard />}
        </div>
      </div>
      {research.length > 0 && (
        <div className="h-72 shrink-0 xl:h-full xl:w-[330px]">
          <ResearchPanel items={research} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function GridPaper({ w, h }: { w: number; h: number }) {
  return (
    <>
      <defs>
        <pattern id="nova-grid" width={32} height={32} patternUnits="userSpaceOnUse">
          <path d="M32,0 L0,0 0,32" fill="none" stroke={INK.grid} strokeWidth={1} />
        </pattern>
      </defs>
      <rect x={0} y={0} width={w} height={h} fill={INK.board} />
      <rect x={0} y={0} width={w} height={h} fill="url(#nova-grid)" />
    </>
  );
}

function TeacherArrow({
  layout,
  a,
  step,
}: {
  layout: BoardLayout;
  a: Extract<Annot, { kind: 'arrow' }>;
  step?: number;
}) {
  const r1 = targetRect(layout, a.from);
  const r2 = targetRect(layout, a.to);
  if (!r1 || !r2) return null;
  const c1 = { x: r1.x + r1.w / 2, y: r1.y + r1.h / 2 };
  const c2 = { x: r2.x + r2.w / 2, y: r2.y + r2.h / 2 };
  // Leave from / arrive at the rect edges rather than the centres.
  const edge = (r: Rect, from: { x: number; y: number }, to: { x: number; y: number }) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const t = Math.min(
      Math.abs(dx) > 0.01 ? r.w / 2 / Math.abs(dx) : Infinity,
      Math.abs(dy) > 0.01 ? r.h / 2 / Math.abs(dy) : Infinity
    );
    return { x: from.x + dx * Math.min(1, t + 0.04), y: from.y + dy * Math.min(1, t + 0.04) };
  };
  const p1 = edge(r1, c1, c2);
  const p2 = edge(r2, c2, c1);
  const mx = (p1.x + p2.x) / 2 + (p2.y - p1.y) * 0.18;
  const my = (p1.y + p2.y) / 2 - (p2.x - p1.x) * 0.18;
  const ang = Math.atan2(p2.y - my, p2.x - mx);
  return (
    <g data-step={step}>
      <motion.path
        d={`M${p1.x},${p1.y} Q${mx},${my} ${p2.x},${p2.y}`}
        fill="none"
        stroke={INK.teacher}
        strokeWidth={2.6}
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.6 }}
      />
      <motion.path
        d={arrowHead(p2.x, p2.y, ang, 12)}
        fill="none"
        stroke={INK.teacher}
        strokeWidth={2.6}
        strokeLinecap="round"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.55 }}
      />
      {a.label && (
        <motion.text
          x={mx}
          y={my - 8}
          textAnchor="middle"
          fontFamily={HAND}
          fontSize={19}
          fill={INK.teacher}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          {a.label}
        </motion.text>
      )}
    </g>
  );
}

function Planning({ w, topic }: { w: number; topic: string }) {
  const t = useT();
  return (
    <g data-snapshot-skip>
      <motion.path
        d={sketchCircle(w / 2, 150, 44, 44, topic)}
        fill="none"
        stroke={INK.teacher}
        strokeWidth={3}
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: [0, 1, 1], opacity: [1, 1, 0] }}
        transition={{ duration: 1.8, repeat: Infinity }}
      />
      <text x={w / 2} y={240} textAnchor="middle" fontFamily={HAND} fontSize={24} fill={INK.soft}>
        {t.preparing} {topic}
      </text>
    </g>
  );
}

function MarkChip({
  mark,
  scale,
  maxX,
  onAsk,
  onDismiss,
}: {
  mark: Mark;
  scale: number;
  maxX: number;
  onAsk: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  // Circling IS asking: after a short countdown the question goes by itself.
  // The student can ask straight away, or cancel with the cross.
  const [left_s, setLeftS] = useState(AUTO_ASK_S);
  const askRef = useRef(onAsk);
  askRef.current = onAsk;
  useEffect(() => {
    if (mark.status !== 'open') return;
    if (left_s <= 0) {
      askRef.current();
      return;
    }
    const id = setTimeout(() => setLeftS((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [left_s, mark.status]);
  const left = Math.min((mark.box.x + mark.box.w) * scale + 10, maxX - 250);
  const top = Math.max(4, mark.box.y * scale - 8);
  const what = mark.targets
    .map((t) => t.text)
    .filter(Boolean)
    .slice(0, 2)
    .join(' · ');
  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      className="absolute z-10 w-[240px] rounded-2xl px-3 py-2.5 shadow-lg"
      style={{ left, top, background: '#FFFFFF', border: `1px solid ${INK.grid}` }}
    >
      {mark.status === 'asked' ? (
        <div className="flex items-center gap-2">
          <motion.span
            className="size-2 rounded-full"
            style={{ background: INK.teacher }}
            animate={{ opacity: [1, 0.2, 1] }}
            transition={{ duration: 1.1, repeat: Infinity }}
          />
          <span className="text-[13px] font-semibold" style={{ color: INK.teacher }}>
            {t.looking}
          </span>
        </div>
      ) : (
        <>
          {what && (
            <p className="mb-2 truncate font-mono text-[11px]" style={{ color: INK.soft }}>
              {what}
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={onAsk}
              className="flex-1 rounded-xl py-2 text-[13px] font-semibold text-white transition hover:brightness-105 active:scale-[0.98]"
              style={{ background: INK.teacher }}
            >
              {t.dontGet}
              {left_s > 0 ? ` (${left_s})` : ''}
            </button>
            <button
              onClick={onDismiss}
              aria-label="Remove mark"
              className="rounded-xl px-3 py-2 text-[13px] transition hover:brightness-95"
              style={{ background: INK.board, color: INK.soft, border: `1px solid ${INK.grid}` }}
            >
              ✕
            </button>
          </div>
        </>
      )}
    </motion.div>
  );
}

function Tools({
  tool,
  setTool,
  onErase,
  canErase,
  onExport,
}: {
  tool: Tool;
  setTool: (t: Tool) => void;
  onErase: () => void;
  canErase: boolean;
  onExport?: () => void;
}) {
  const btn = (t: Tool, label: string, icon: React.ReactNode) => (
    <button
      key={t}
      onClick={() => setTool(t)}
      title={label}
      aria-label={label}
      aria-pressed={tool === t}
      className="flex size-9 items-center justify-center rounded-xl transition"
      style={{
        background: tool === t ? `${INK.student}1F` : 'transparent',
        color: tool === t ? INK.student : INK.soft,
        border: `1px solid ${tool === t ? `${INK.student}55` : INK.grid}`,
      }}
    >
      {icon}
    </button>
  );
  return (
    <div className="flex items-center gap-1.5">
      {btn(
        'pen',
        'Pen — circle or underline anything to ask about it',
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M4 20l4-1 11-11-3-3L5 16l-1 4z" strokeLinejoin="round" />
        </svg>
      )}
      {btn(
        'highlighter',
        'Highlighter',
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M9 15l-4 5h6l2-2M9 15l7-11 4 3-7 11-4-3z" strokeLinejoin="round" />
        </svg>
      )}
      {btn(
        'hand',
        'Scroll the board',
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path
            d="M8 13V5a1.5 1.5 0 013 0v6m0-1V4a1.5 1.5 0 013 0v7m0-5a1.5 1.5 0 013 0v7m0-4a1.5 1.5 0 013 0v5a7 7 0 01-7 7h-1a7 7 0 01-6-3l-3-5a1.5 1.5 0 012.5-1.6L8 15"
            strokeLinecap="round"
          />
        </svg>
      )}
      <button
        onClick={onErase}
        disabled={!canErase}
        title="Erase my marks"
        aria-label="Erase my marks"
        className="flex size-9 items-center justify-center rounded-xl transition disabled:opacity-35"
        style={{ color: INK.soft, border: `1px solid ${INK.grid}` }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M16 3l5 5-10 10H6l-3-3L16 3zM6 18h14" strokeLinejoin="round" />
        </svg>
      </button>

      {onExport && (
        <button
          onClick={onExport}
          title="Export board as presentation slides (PDF)"
          aria-label="Export board as presentation slides (PDF)"
          className="flex size-9 items-center justify-center rounded-xl transition hover:brightness-95 active:scale-95"
          style={{ color: INK.ink, border: `1px solid ${INK.grid}`, background: '#FFFFFF' }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  );
}

function EmptyBoard() {
  const t = useT();
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
      <p className="text-[26px]" style={{ color: INK.ink, fontFamily: 'var(--font-hand)' }}>
        {t.boardEmptyTitle}
      </p>
      <p className="mt-2 max-w-[24rem] text-[14px] leading-relaxed" style={{ color: INK.soft }}>
        {t.boardEmptyBody}
      </p>
    </div>
  );
}
