import type { BoardOp, El, Step, CheckpointOption } from './types';
import type { ImageEntry } from './image-layout';

export const INK_HIGHLIGHT = '#F6D55C';

export type Annot =
  | { kind: 'hl'; id: number; target: string; color: string }
  | { kind: 'arrow'; id: number; from: string; to: string; label?: string };

export type State = {
  title: string;
  steps: Step[];
  images?: ImageEntry[];
  revealed: number;
  planning: string | null;
  annots: Annot[];
  pointAt: string | null;
  pointSeq: number;
  seq: number;
  stepNotes?: Record<string, string>;
  rejectedMedia?: string[];
};

export const EMPTY: State = {
  title: '',
  steps: [],
  revealed: 0,
  planning: null,
  annots: [],
  pointAt: null,
  pointSeq: 0,
  seq: 0,
  stepNotes: {},
  rejectedMedia: [],
};

export const HL_COLORS: Record<string, string> = {
  yellow: INK_HIGHLIGHT,
  green: '#9BE08A',
  pink: '#F7A8C4',
  blue: '#A9D2F7',
  orange: '#F9C58D',
};

export function withElement(steps: Step[], id: string, fn: (el: El) => El): Step[] {
  return steps.map((s) => ({
    ...s,
    elements: s.elements.map((e) => (e.id === id ? fn(e) : e)),
  }));
}

export function reduce(state: State, op: BoardOp): State {
  const seq = state.seq + 1;
  switch (op.op) {
    case 'planning':
      return { ...state, planning: op.topic, seq };
    case 'lesson': {
      // Append lesson steps instead of wiping earlier diagrams/lessons
      const newSteps = op.lesson.steps.map((s) => ({ ...s, elements: [...s.elements] }));
      const steps = [...state.steps, ...newSteps];
      return {
        ...state,
        title: state.title ? `${state.title} · ${op.lesson.title}` : op.lesson.title,
        steps,
        revealed: state.revealed > 0 ? state.revealed : 0,
        seq,
      };
    }
    case 'reveal':
      return {
        ...state,
        planning: null,
        revealed: Math.min(state.steps.length, Math.max(state.revealed, op.step)),
        pointAt: null,
        seq,
      };
    case 'add': {
      if (op.element.kind === 'media' && op.element.image_role) {
        return {
          ...state,
          images: [
            ...(state.images ?? []).filter((image) => image.element.id !== op.element.id),
            { element: op.element, after: op.after },
          ],
          seq,
        };
      }
      const steps = state.steps.map((s) => ({ ...s, elements: [...s.elements] }));
      let revealed = state.revealed;
      // After the element it explains, else at the end of the latest step.
      const afterId = op.after?.split('#')[0];
      let si = afterId
        ? steps.slice(0, revealed).findIndex((s) => s.elements.some((e) => e.id === afterId))
        : -1;
      if (si >= 0) {
        const at = steps[si].elements.findIndex((e) => e.id === afterId);
        steps[si].elements.splice(at + 1, 0, op.element);
      } else {
        let cur = steps[revealed > 0 ? revealed - 1 : 0];
        const elConceptId =
          (op.element as any).conceptId ||
          (op as any).conceptId ||
          (op.element.kind === 'diagram' ? `concept-${op.element.id}` : cur?.conceptId || op.element.id);

        if (revealed === 0) {
          steps.splice(0, 0, {
            id: `free${seq}`,
            conceptId: elConceptId,
            title: (op.element as any).label || '',
            elements: [],
          });
          revealed = 1;
        }
        si = revealed - 1;
        cur = steps[si];

        // When a new diagram or media arrives and the current step already has a diagram or media,
        // create a new step block below so the previous diagram is never deleted or squeezed!
        if (!cur.conceptId) {
          cur.conceptId = elConceptId;
        }
        const hasExistingVisual = cur.elements.some((e) => e.kind === 'diagram' || e.kind === 'media');
        const isNewVisual = op.element.kind === 'diagram' || op.element.kind === 'media';

        if (hasExistingVisual && isNewVisual) {
          const newStep = {
            id: `free${seq}`,
            conceptId: elConceptId,
            title: (op.element as any).label || '',
            elements: [op.element],
          };
          steps.push(newStep);
          revealed = steps.length;
          si = steps.length - 1;
        } else {
          cur.elements.push(op.element);
        }
      }
      return {
        ...state,
        steps,
        revealed,
        planning: null,
        pointAt: op.element.id,
        pointSeq: seq,
        seq,
      };
    }
    case 'array':
      return {
        ...state,
        steps: withElement(state.steps, op.id, (el) => {
          if (el.kind !== 'array') return el;
          return {
            ...el,
            values: op.values ?? el.values,
            pointers: op.pointers ?? el.pointers,
          };
        }),
        seq,
      };
    case 'highlight':
      return {
        ...state,
        annots: [
          ...state.annots.filter((a) => a.kind !== 'hl' || a.target !== op.target),
          {
            kind: 'hl' as const,
            id: seq,
            target: op.target,
            color: HL_COLORS[op.color ?? 'yellow'] ?? INK_HIGHLIGHT,
          },
        ].slice(-8),
        pointAt: op.target,
        pointSeq: seq,
        seq,
      };
    case 'arrow':
      return {
        ...state,
        annots: [
          ...state.annots,
          { kind: 'arrow' as const, id: seq, from: op.from, to: op.to, label: op.label },
        ].slice(-4),
        pointAt: op.to,
        pointSeq: seq,
        seq,
      };
    case 'point':
      return { ...state, pointAt: op.target, pointSeq: seq, seq };
    case 'unmark':
      return { ...state, annots: [], pointAt: null, seq };
    case 'clear':
      return { ...state, seq }; // preserve history — do not wipe
    case 'step_note':
      return {
        ...state,
        stepNotes: { ...(state.stepNotes ?? {}), [op.conceptId]: op.text },
        seq,
      };
    case 'media_reject':
      return {
        ...state,
        rejectedMedia: [...(state.rejectedMedia ?? []).filter((mid) => mid !== op.id), op.id],
        seq,
      };
    case 'board_new':
    case 'board_open':
    case 'media_fail':
    case 'checkpoint':
    case 'checkpoint_active':
    case 'checkpoint_ready':
    case 'checkpoint_playback_done':
    case 'checkpoint_response':
    case 'checkpoint_evaluated':
    case 'checkpoint_complete':
      return state; // handled by checkpoint lifecycle / media store
    default:
      return state;
  }
}

export type Book = { pages: Record<string, State>; order: string[]; active: string };
export type BookOp =
  | (BoardOp & { board?: string })
  | { op: 'local_open'; board: string }
  | { op: 'local_new'; board: string; title: string }
  | { op: 'restore'; book: Book };

export const FIRST_BOOK: Book = {
  pages: { b1: { ...EMPTY, title: 'Board 1' } },
  order: ['b1'],
  active: 'b1',
};

export function withPage(book: Book, id: string, title?: string): Book {
  if (book.pages[id]) return book;
  return {
    ...book,
    pages: { ...book.pages, [id]: { ...EMPTY, title: title || `Board ${book.order.length + 1}` } },
    order: [...book.order, id],
  };
}

export function reduceBook(book: Book, op: BookOp): Book {
  if (op.op === 'restore') return op.book;
  if (op.op === 'local_open') return { ...withPage(book, op.board), active: op.board };
  if (op.op === 'local_new') return { ...withPage(book, op.board, op.title), active: op.board };
  const id = op.board ?? book.active;
  let next = withPage(book, id, op.op === 'board_new' ? op.title : undefined);
  if (op.op === 'board_new' && op.title) {
    next = { ...next, pages: { ...next.pages, [id]: { ...next.pages[id], title: op.title } } };
  }
  const page = reduce(next.pages[id], op);
  // Wherever the teacher draws is where the student should be looking.
  return { ...next, pages: { ...next.pages, [id]: page }, active: id };
}

/**
 * Resolves the owner concept for an image on the whiteboard.
 * If the image is a direct step element, resolves that step's concept.
 * If the image was attached after an existing diagram/element, resolves that anchor's step concept.
 */
export function resolveMediaConcept(
  steps: Step[],
  images: ImageEntry[] | undefined,
  mediaId: string
): string | undefined {
  const directStep = steps.find((s) => s.elements.some((e) => e.id === mediaId));
  if (directStep) return directStep.conceptId || directStep.id;

  const imgEntry = images?.find((im) => im.element.id === mediaId);
  if (imgEntry) {
    const anchor = imgEntry.after?.split('#')[0];
    if (anchor) {
      const parentStep = steps.find((s) => s.elements.some((e) => e.id === anchor));
      if (parentStep) return parentStep.conceptId || parentStep.id;
    }
    return `image-${mediaId}`;
  }

  return undefined;
}

export type TutorState =
  | 'Explaining'
  | 'Waiting for answer'
  | 'Listening'
  | 'Reconnecting'
  | 'Ready';

/**
 * Derives the active tutor state from real runtime signals, ensuring silence
 * does not falsely indicate reconnecting or waiting for an answer.
 */
export function deriveTutorState({
  connectionState,
  isSpeaking,
  hasActiveCheck,
  isListening,
  replay,
}: {
  connectionState?: string;
  isSpeaking?: boolean;
  hasActiveCheck?: boolean;
  isListening?: boolean;
  replay?: boolean;
}): TutorState {
  if (replay) return 'Ready';
  if (connectionState === 'reconnecting' || connectionState === 'disconnected') {
    return 'Reconnecting';
  }
  if (isSpeaking) {
    return 'Explaining';
  }
  if (hasActiveCheck) {
    return 'Waiting for answer';
  }
  if (isListening) {
    return 'Listening';
  }
  return 'Ready';
}

export type CheckpointStatus = 'pending' | 'prepared' | 'awaiting_response' | 'answered' | 'completed';

export type CheckpointResponse = {
  text: string;
  modality: 'voice' | 'typed' | 'chip';
  optionId?: string;
  at: number;
  isFinal?: boolean;
};

export type CheckpointEvaluation = {
  isCorrect?: boolean;
  criteriaMet?: boolean;
  feedback?: string;
  evaluatedAt: number;
  status?: 'pending' | 'evaluated';
};

export type CheckpointEntry = {
  status: CheckpointStatus;
  id?: string;
  boardId?: string;
  conceptId?: string;
  question?: string;
  options?: CheckpointOption[];
  hints?: string[];
  revealedHintsCount?: number;
  criteria?: string;
  answerKey?: string;
  speechId?: string;
  activatedAt?: number;
  playbackStarted?: boolean;
  questionPlaybackStarted?: boolean;
  questionPlaybackLineId?: string;
  awaitingResponseAt?: number;
  completedAt?: number;
  lastStudentLineIdAtActivation?: string;
  lastTeacherLineIdAtActivation?: string;
  interimResponse?: string;
  // Answer received tracking (separated from evaluation / correctness)
  answerReceived?: boolean;
  response?: CheckpointResponse;
  evaluation?: CheckpointEvaluation;
};

export function normalizeOptions(
  options?: Array<string | CheckpointOption>
): CheckpointOption[] | undefined {
  if (!options || !options.length) return undefined;
  return options.map((opt, i) => {
    if (typeof opt === 'string') {
      return { id: `opt-${i}`, text: opt };
    }
    return { id: opt.id || `opt-${i}`, text: opt.text };
  });
}

export type CheckpointLifecycle = {
  checkpoints: Record<string, CheckpointEntry>;
};

export function checkpointKey(boardId: string, conceptId: string): string {
  return `${boardId}:${conceptId}`;
}

export function createCheckpointState(): CheckpointLifecycle {
  return { checkpoints: {} };
}

/**
 * Evaluates a learner's response against structured criteria, stable option IDs, and answer key.
 * Keeps answer receipt separate from correctness.
 * Handles negation, semantic meaning, and records evaluation pending when appropriate.
 */
export function evaluateCheckpointAnswer(
  checkpoint: CheckpointEntry | undefined,
  responseText: string,
  optionId?: string
): CheckpointEvaluation {
  const at = Date.now();
  const trimmed = responseText.trim();
  if (!checkpoint || (!trimmed && !optionId)) {
    return {
      isCorrect: false,
      criteriaMet: false,
      feedback: 'No answer provided.',
      evaluatedAt: at,
      status: 'evaluated',
    };
  }

  const answerKey = checkpoint.answerKey?.trim().toLowerCase();
  const options = checkpoint.options || [];

  // 1. Chip / Option ID response: evaluate against explicit answerKey
  if (optionId) {
    if (answerKey) {
      const isCorrect =
        optionId.toLowerCase() === answerKey ||
        trimmed.toLowerCase() === answerKey;
      return {
        isCorrect,
        criteriaMet: isCorrect,
        feedback: isCorrect ? 'Correct! Excellent answer.' : 'Not quite. Check the hint or try again!',
        evaluatedAt: at,
        status: 'evaluated',
      };
    }
    // If options are present with no explicit answerKey: record receipt with evaluation pending
    const matchedOpt = options.find((o) => o.id === optionId);
    return {
      feedback: matchedOpt ? `Option selected: ${matchedOpt.text}. Awaiting evaluation.` : 'Option selected. Awaiting evaluation.',
      evaluatedAt: at,
      status: 'pending',
    };
  }

  // 2. Explicit criteria evaluation with negation check
  if (checkpoint.criteria?.trim()) {
    const crit = checkpoint.criteria.trim().toLowerCase();
    const resp = trimmed.toLowerCase();

    // Check multiple criteria keywords or acceptable alternatives
    const acceptedParts = crit
      .split(/,|;|\bor\b/i)
      .map((p) => p.trim())
      .filter(Boolean);

    const negationRegex = /\b(?:not|no|never|neither|nor|without|isn't|isnt|aren't|arent|wasn't|wasnt|weren't|werent|don't|dont|doesn't|doesnt|didn't|didnt|won't|wont|cannot|can't|cant)\b/gi;
    const contrastRegex = /[;:.!?—]|\s--\s|\b(?:but|instead|rather|whereas|while|however|although|though)\b/i;

    let matchedWithoutNegation = false;
    let foundNegatedMatch = false;

    for (const part of acceptedParts) {
      const idx = resp.indexOf(part);
      if (idx !== -1) {
        // Look back before the keyword for negation words
        const lookback = resp.slice(Math.max(0, idx - 45), idx);
        const matches = Array.from(lookback.matchAll(negationRegex));
        if (matches.length > 0) {
          const lastMatch = matches[matches.length - 1];
          const matchEnd = (lastMatch.index ?? 0) + lastMatch[0].length;
          const between = lookback.slice(matchEnd);
          const isContrast =
            contrastRegex.test(between) ||
            /\w+\s*,/.test(between) ||
            /^\s*,\s*$/.test(between);

          if (!isContrast) {
            foundNegatedMatch = true;
          } else {
            matchedWithoutNegation = true;
          }
        } else {
          matchedWithoutNegation = true;
        }
      }
    }

    if (matchedWithoutNegation) {
      return {
        isCorrect: true,
        criteriaMet: true,
        feedback: 'Correct! Excellent answer.',
        evaluatedAt: at,
        status: 'evaluated',
      };
    }

    if (foundNegatedMatch) {
      return {
        isCorrect: false,
        criteriaMet: false,
        feedback: 'Your answer denies or negates the required concept. Check the hint or try again!',
        evaluatedAt: at,
        status: 'evaluated',
      };
    }

    // No criteria match (e.g. answer "The Moon" for criteria "chlorophyll")
    return {
      isCorrect: false,
      criteriaMet: false,
      feedback: 'Not quite. Check the hint or try again!',
      evaluatedAt: at,
      status: 'evaluated',
    };
  }

  // 3. Options present without explicit criteria:
  if (options.length > 0) {
    const resp = trimmed.toLowerCase();

    // Check if the typed/voice response matches any valid option
    const matchedOpt = options.find(
      (opt) => opt.text.toLowerCase() === resp || opt.id.toLowerCase() === resp
    );

    if (!matchedOpt) {
      // Out-of-domain answer (e.g. options "Roots / Leaves", answer "The Moon")
      return {
        isCorrect: false,
        criteriaMet: false,
        feedback: 'Answer does not match any available option. Check the hint or try again!',
        evaluatedAt: at,
        status: 'evaluated',
      };
    }

    if (answerKey) {
      const isCorrect =
        matchedOpt.id.toLowerCase() === answerKey ||
        matchedOpt.text.toLowerCase() === answerKey ||
        resp === answerKey;
      return {
        isCorrect,
        criteriaMet: isCorrect,
        feedback: isCorrect ? 'Correct! Excellent answer.' : 'Not quite. Check the hint or try again!',
        evaluatedAt: at,
        status: 'evaluated',
      };
    }

    // Valid option selected/spoken, but no explicit answerKey: record receipt with evaluation pending
    return {
      feedback: `Option selected: ${matchedOpt.text}. Awaiting evaluation.`,
      evaluatedAt: at,
      status: 'pending',
    };
  }

  // 4. Open conversational response without criteria or answer key: record receipt with evaluation pending
  return {
    feedback: 'Answer received. Acharya will review.',
    evaluatedAt: at,
    status: 'pending',
  };
}

export type CheckpointAction =
  | { type: 'set'; state: CheckpointLifecycle }
  | {
      type: 'register';
      boardId: string;
      conceptId: string;
      question: string;
      checkpointId?: string;
      speechId?: string;
      options?: Array<string | CheckpointOption>;
      hints?: string[];
      criteria?: string;
      answerKey?: string;
    }
  | {
      type: 'activate';
      boardId: string;
      conceptId: string;
      checkpointId?: string;
      speechId?: string;
      question?: string;
      options?: Array<string | CheckpointOption>;
      hints?: string[];
      criteria?: string;
      answerKey?: string;
      at?: number;
      isSpeaking?: boolean;
      lastStudentLineId?: string;
      lastTeacherLineId?: string;
    }
  | {
      type: 'playback_started';
      boardId: string;
      conceptId?: string;
      checkpointId?: string;
      speechId?: string;
      lineId?: string;
    }
  | {
      type: 'await_response';
      boardId: string;
      conceptId?: string;
      checkpointId?: string;
      speechId?: string;
      at?: number;
      lastStudentLineId?: string;
    }
  | {
      type: 'interim_response';
      boardId: string;
      conceptId?: string;
      checkpointId?: string;
      response: string;
      at?: number;
    }
  | {
      type: 'submit_response';
      boardId: string;
      conceptId?: string;
      checkpointId?: string;
      response: string;
      modality: 'voice' | 'typed' | 'chip';
      optionId?: string;
      at?: number;
    }
  | {
      type: 'reveal_hint';
      boardId: string;
      conceptId?: string;
      checkpointId?: string;
    }
  | {
      type: 'retry';
      boardId: string;
      conceptId?: string;
      checkpointId?: string;
    }
  | {
      type: 'evaluate';
      boardId: string;
      conceptId?: string;
      checkpointId?: string;
      isCorrect?: boolean;
      status?: 'pending' | 'evaluated';
      feedback?: string;
      criteriaMet?: boolean;
      optionId?: string;
      at?: number;
    }
  | { type: 'complete'; boardId: string; conceptId?: string; checkpointId?: string; at?: number }
  | { type: 'reset'; boardId?: string };

export function checkpointReducer(
  state: CheckpointLifecycle,
  action: CheckpointAction
): CheckpointLifecycle {
  switch (action.type) {
    case 'set':
      return action.state;
    case 'register': {
      const key = checkpointKey(action.boardId, action.conceptId);
      if (state.checkpoints[key]) return state;
      return {
        checkpoints: {
          ...state.checkpoints,
          [key]: {
            status: 'pending',
            id: action.checkpointId || `cp-${action.conceptId}`,
            speechId: action.speechId,
            boardId: action.boardId,
            conceptId: action.conceptId,
            question: action.question,
            options: normalizeOptions(action.options),
            hints: action.hints,
            revealedHintsCount: 0,
            criteria: action.criteria,
            answerKey: action.answerKey,
          },
        },
      };
    }
    case 'activate': {
      const key = checkpointKey(action.boardId, action.conceptId);
      const existing = state.checkpoints[key];
      // Do not re-activate a completed checkpoint unless explicitly updated with a new question or ID
      if (
        existing?.status === 'completed' &&
        !action.question &&
        (!action.checkpointId || action.checkpointId === existing.id)
      ) {
        return state;
      }
      const activationTime = action.at ?? Date.now();
      // Always begin in 'prepared' with questionPlaybackStarted = false.
      // Prior explanation speech must never be mistaken for question playback.
      return {
        checkpoints: {
          ...state.checkpoints,
          [key]: {
            status: 'prepared',
            playbackStarted: false,
            questionPlaybackStarted: false,
            id: action.checkpointId ?? existing?.id ?? `cp-${action.conceptId}`,
            speechId: action.speechId ?? existing?.speechId,
            boardId: action.boardId,
            conceptId: action.conceptId,
            question: action.question ?? existing?.question,
            options: normalizeOptions(action.options) ?? existing?.options,
            hints: action.hints ?? existing?.hints,
            revealedHintsCount: 0,
            criteria: action.criteria ?? existing?.criteria,
            answerKey: action.answerKey ?? existing?.answerKey,
            activatedAt: activationTime,
            awaitingResponseAt: undefined,
            lastStudentLineIdAtActivation: action.lastStudentLineId ?? existing?.lastStudentLineIdAtActivation,
            lastTeacherLineIdAtActivation: action.lastTeacherLineId ?? existing?.lastTeacherLineIdAtActivation,
            answerReceived: false,
            response: undefined,
            evaluation: undefined,
          },
        },
      };
    }
    case 'playback_started': {
      let key = action.conceptId ? checkpointKey(action.boardId, action.conceptId) : '';
      if (!key && (action.checkpointId || action.speechId)) {
        for (const [k, cp] of Object.entries(state.checkpoints)) {
          const matchCp = !action.checkpointId || cp.id === action.checkpointId;
          const matchSpeech = !action.speechId || cp.speechId === action.speechId;
          if (matchCp && matchSpeech) {
            key = k;
            break;
          }
        }
      }
      if (!key) return state;
      const existing = state.checkpoints[key];
      if (!existing || existing.status !== 'prepared') return state;

      // Strict ownership matching: prevent delayed/stale matching from earlier questions
      if (action.checkpointId && existing.id && action.checkpointId !== existing.id) {
        return state;
      }
      if (action.speechId && existing.speechId && action.speechId !== existing.speechId) {
        return state;
      }

      return {
        checkpoints: {
          ...state.checkpoints,
          [key]: {
            ...existing,
            playbackStarted: true,
            questionPlaybackStarted: true,
            questionPlaybackLineId: action.lineId ?? existing.questionPlaybackLineId,
          },
        },
      };
    }
    case 'await_response': {
      let key = action.conceptId ? checkpointKey(action.boardId, action.conceptId) : '';
      if (!key && (action.checkpointId || action.speechId)) {
        for (const [k, cp] of Object.entries(state.checkpoints)) {
          const matchCp = !action.checkpointId || cp.id === action.checkpointId;
          const matchSpeech = !action.speechId || cp.speechId === action.speechId;
          if (matchCp && matchSpeech) {
            key = k;
            break;
          }
        }
      }
      if (!key) return state;
      const existing = state.checkpoints[key];
      if (!existing || existing.status !== 'prepared') return state;

      // Strict ownership matching: prevent delayed/stale completions from earlier questions
      if (action.checkpointId && existing.id && action.checkpointId !== existing.id) {
        return state;
      }
      if (action.speechId && existing.speechId && action.speechId !== existing.speechId) {
        return state;
      }

      const readyTime = action.at ?? Date.now();
      return {
        checkpoints: {
          ...state.checkpoints,
          [key]: {
            ...existing,
            status: 'awaiting_response',
            awaitingResponseAt: readyTime,
            lastStudentLineIdAtActivation: action.lastStudentLineId ?? existing.lastStudentLineIdAtActivation,
          },
        },
      };
    }
    case 'interim_response': {
      let key = action.conceptId ? checkpointKey(action.boardId, action.conceptId) : '';
      if (!key && action.checkpointId) {
        for (const [k, cp] of Object.entries(state.checkpoints)) {
          if (cp.id === action.checkpointId) {
            key = k;
            break;
          }
        }
      }
      if (!key) return state;
      const existing = state.checkpoints[key];
      if (!existing || existing.status !== 'awaiting_response') return state;

      if (action.checkpointId && existing.id && action.checkpointId !== existing.id) {
        return state;
      }

      if (existing.interimResponse === action.response) {
        return state;
      }

      return {
        checkpoints: {
          ...state.checkpoints,
          [key]: {
            ...existing,
            interimResponse: action.response,
            response: {
              text: action.response,
              modality: 'voice',
              at: action.at ?? Date.now(),
              isFinal: false,
            },
          },
        },
      };
    }
    case 'submit_response': {
      let key = action.conceptId ? checkpointKey(action.boardId, action.conceptId) : '';
      if (!key && action.checkpointId) {
        for (const [k, cp] of Object.entries(state.checkpoints)) {
          if (cp.id === action.checkpointId) {
            key = k;
            break;
          }
        }
      }
      if (!key) return state;
      const existing = state.checkpoints[key];
      if (!existing) return state;
      // Accept response while awaiting response or when answered (for updates/retries)
      if (existing.status !== 'awaiting_response' && existing.status !== 'answered') return state;

      if (action.checkpointId && existing.id && action.checkpointId !== existing.id) {
        return state;
      }

      const at = action.at ?? Date.now();
      const evaluation = evaluateCheckpointAnswer(existing, action.response, action.optionId);

      return {
        checkpoints: {
          ...state.checkpoints,
          [key]: {
            ...existing,
            status: 'answered',
            answerReceived: true,
            interimResponse: undefined,
            response: {
              text: action.response,
              modality: action.modality,
              optionId: action.optionId,
              at,
              isFinal: true,
            },
            evaluation,
            completedAt: evaluation.isCorrect ? at : undefined,
          },
        },
      };
    }
    case 'reveal_hint': {
      let key = action.conceptId ? checkpointKey(action.boardId, action.conceptId) : '';
      if (!key && action.checkpointId) {
        for (const [k, cp] of Object.entries(state.checkpoints)) {
          if (cp.id === action.checkpointId) {
            key = k;
            break;
          }
        }
      }
      if (!key) return state;
      const existing = state.checkpoints[key];
      if (!existing) return state;
      const currentCount = existing.revealedHintsCount ?? 0;
      const maxHints = existing.hints?.length ?? 0;
      return {
        checkpoints: {
          ...state.checkpoints,
          [key]: {
            ...existing,
            revealedHintsCount: Math.min(maxHints, currentCount + 1),
          },
        },
      };
    }
    case 'retry': {
      let key = action.conceptId ? checkpointKey(action.boardId, action.conceptId) : '';
      if (!key && action.checkpointId) {
        for (const [k, cp] of Object.entries(state.checkpoints)) {
          if (cp.id === action.checkpointId) {
            key = k;
            break;
          }
        }
      }
      if (!key) return state;
      const existing = state.checkpoints[key];
      if (!existing) return state;
      return {
        checkpoints: {
          ...state.checkpoints,
          [key]: {
            ...existing,
            status: 'awaiting_response',
            answerReceived: false,
            interimResponse: undefined,
            response: undefined,
            evaluation: undefined,
          },
        },
      };
    }
    case 'evaluate': {
      let key = action.conceptId ? checkpointKey(action.boardId, action.conceptId) : '';
      if (!key && action.checkpointId) {
        for (const [k, cp] of Object.entries(state.checkpoints)) {
          if (cp.id === action.checkpointId) {
            key = k;
            break;
          }
        }
      }
      if (!key) return state;
      const existing = state.checkpoints[key];
      if (!existing) return state;
      const evalAt = action.at ?? Date.now();
      const evalStatus = action.status ?? (action.isCorrect !== undefined ? 'evaluated' : 'pending');
      return {
        checkpoints: {
          ...state.checkpoints,
          [key]: {
            ...existing,
            evaluation: {
              isCorrect: action.isCorrect,
              feedback:
                action.feedback ??
                (action.isCorrect
                  ? 'Correct!'
                  : action.isCorrect === false
                    ? 'Incorrect.'
                    : 'Answer received. Acharya will review.'),
              criteriaMet: action.criteriaMet ?? action.isCorrect,
              evaluatedAt: evalAt,
              status: evalStatus,
            },
            completedAt: action.isCorrect === true ? evalAt : undefined,
          },
        },
      };
    }
    case 'complete': {
      let key = action.conceptId ? checkpointKey(action.boardId, action.conceptId) : '';
      if (!key && action.checkpointId) {
        for (const [k, cp] of Object.entries(state.checkpoints)) {
          if (action.checkpointId && cp.id === action.checkpointId) {
            key = k;
            break;
          }
        }
      }
      if (!key) return state;
      const existing = state.checkpoints[key];
      if (!existing || existing.status === 'completed') return state;

      if (action.checkpointId && existing.id && action.checkpointId !== existing.id) {
        return state;
      }

      return {
        checkpoints: {
          ...state.checkpoints,
          [key]: {
            ...existing,
            status: 'completed',
            completedAt: action.at ?? Date.now(),
          },
        },
      };
    }
    case 'reset': {
      if (!action.boardId) return createCheckpointState();
      const prefix = `${action.boardId}:`;
      const next: Record<string, CheckpointEntry> = {};
      for (const [k, v] of Object.entries(state.checkpoints)) {
        if (!k.startsWith(prefix)) next[k] = v;
      }
      return { checkpoints: next };
    }
    default:
      return state;
  }
}

export function isCheckpointActive(
  state: CheckpointLifecycle,
  boardId: string,
  conceptId?: string
): boolean {
  if (!conceptId) return false;
  const key = checkpointKey(boardId, conceptId);
  const cp = state.checkpoints[key];
  return cp?.status === 'prepared' || cp?.status === 'awaiting_response';
}

export function isCheckpointAwaiting(
  state: CheckpointLifecycle,
  boardId: string,
  conceptId?: string
): boolean {
  if (!conceptId) return false;
  const key = checkpointKey(boardId, conceptId);
  const cp = state.checkpoints[key];
  return cp?.status === 'awaiting_response';
}

function normalizeForMatch(str: string): string[] {
  return str
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

const QUESTION_STOP_WORDS = new Set([
  'what', 'is', 'the', 'a', 'an', 'in', 'of', 'to', 'and', 'for', 'on', 'with', 'at',
  'by', 'this', 'that', 'it', 'tell', 'me', 'now', 'can', 'you', 'how', 'does', 'do',
  'are', 'which', 'who', 'whom', 'why', 'where', 'when', 'so', 'then', 'let', 'us',
  'here', 'class', 'student', 'students', 'answer', 'question'
]);

/**
 * Determines whether an utterance corresponds to the checkpoint question.
 * Strictly uses explicit checkpoint ID or speechId handle ownership.
 */
export function isQuestionUtterance(
  checkpoint: CheckpointEntry | undefined,
  utterance: { checkpointId?: string; speechId?: string; text?: string; id?: string } | undefined
): boolean {
  if (!checkpoint || !utterance) return false;
  if (utterance.checkpointId && checkpoint.id && utterance.checkpointId === checkpoint.id) {
    return true;
  }
  if (utterance.speechId && checkpoint.speechId && utterance.speechId === checkpoint.speechId) {
    return true;
  }
  return false;
}

export interface CheckpointPlaybackSyncParams {
  state: CheckpointLifecycle;
  boardId: string;
  isSpeaking: boolean;
  wasSpeaking?: boolean;
  lines?: Array<{
    id: string;
    mine: boolean;
    text?: string;
    at?: number;
    checkpointId?: string;
    speechId?: string;
  }>;
  completedCheckpointId?: string;
  completedSpeechId?: string;
  now?: number;
}

/**
 * Production checkpoint playback synchronizer.
 * Ties playback start and completion directly to explicit checkpoint IDs / speech handles.
 */
export function syncCheckpointPlayback({
  state,
  boardId,
  isSpeaking,
  wasSpeaking,
  lines,
  completedCheckpointId,
  completedSpeechId,
  now = Date.now(),
}: CheckpointPlaybackSyncParams): CheckpointLifecycle {
  let nextState = state;
  const latestStudentLine = lines?.filter((l) => l.mine).slice(-1)[0];

  // 1. Explicit completion signals tied to checkpoint ID or speech ID
  if (completedCheckpointId || completedSpeechId) {
    for (const [key, cp] of Object.entries(nextState.checkpoints)) {
      if (cp.status === 'prepared') {
        const matchCp = !completedCheckpointId || cp.id === completedCheckpointId;
        const matchSpeech = !completedSpeechId || cp.speechId === completedSpeechId;
        if (matchCp && matchSpeech) {
          nextState = checkpointReducer(nextState, {
            type: 'await_response',
            boardId: cp.boardId || boardId,
            conceptId: cp.conceptId || key.split(':')[1],
            checkpointId: completedCheckpointId || cp.id,
            speechId: completedSpeechId || cp.speechId,
            at: now,
            lastStudentLineId: latestStudentLine?.id,
          });
        }
      }
    }
  }

  // 2. Utterance ownership: detect teacher lines tied to checkpoint ID or speech ID
  for (const [key, cp] of Object.entries(nextState.checkpoints)) {
    const [fallbackBoard, fallbackConcept] = key.split(':');
    const cpBoardId = cp.boardId || fallbackBoard;
    const cpConceptId = cp.conceptId || fallbackConcept;

    if (cp.status === 'prepared' && cpBoardId === boardId) {
      const matchingQuestionLine = lines?.find(
        (l) => !l.mine && isQuestionUtterance(cp, l)
      );

      if (matchingQuestionLine && !cp.questionPlaybackStarted) {
        nextState = checkpointReducer(nextState, {
          type: 'playback_started',
          boardId: cpBoardId,
          conceptId: cpConceptId,
          checkpointId: cp.id,
          speechId: cp.speechId,
          lineId: matchingQuestionLine.id,
        });
      }

      // If speech finished for a question utterance that was playing:
      if (wasSpeaking && !isSpeaking) {
        const currentCp = nextState.checkpoints[key];
        if (currentCp?.questionPlaybackStarted) {
          nextState = checkpointReducer(nextState, {
            type: 'await_response',
            boardId: cpBoardId,
            conceptId: cpConceptId,
            checkpointId: cp.id,
            speechId: cp.speechId,
            at: now,
            lastStudentLineId: latestStudentLine?.id,
          });
        }
      }
    }
  }

  return nextState;
}

/**
 * Diagnostic helper: inspects text similarity for diagnostics and logs only.
 * Production playback association MUST NOT rely on text matching.
 */
export function isQuestionSpeech(
  question: string | undefined,
  speechText: string | undefined
): boolean {
  if (!question?.trim() || !speechText?.trim()) return false;

  const qClean = question.trim().toLowerCase();
  const sClean = speechText.trim().toLowerCase();

  // 1. Direct substring inclusion in either direction
  if (sClean.includes(qClean) || qClean.includes(sClean)) {
    return true;
  }

  // 2. Token overlap: check if significant keywords from the question appear in speech
  const qTokens = normalizeForMatch(qClean);
  const sTokens = new Set(normalizeForMatch(sClean));

  const keyTokens = qTokens.filter((t) => !QUESTION_STOP_WORDS.has(t));
  const tokensToCheck = keyTokens.length > 0 ? keyTokens : qTokens;

  if (tokensToCheck.length === 0) return false;

  let matches = 0;
  for (const t of tokensToCheck) {
    if (sTokens.has(t)) matches++;
  }

  if (tokensToCheck.length <= 2) {
    return matches >= 1;
  }
  return matches >= 2 || matches / tokensToCheck.length >= 0.35;
}

/**
 * Validates whether a learner transcript line represents a response to the active checkpoint.
 * Strictly ignores speech that occurred prior to or at checkpoint activation time, avoiding
 * counting earlier learner interruptions during the teacher's explanation.
 * Also ignores speech spoken while the question is being played back ('prepared' state).
 */
export function isLearnerResponseForCheckpoint(
  checkpoint: CheckpointEntry | undefined,
  line: { mine: boolean; text?: string; at: number; id?: string }
): boolean {
  if (!checkpoint) return false;
  // A checkpoint only accepts answers once question playback has concluded ('awaiting_response')
  if (checkpoint.status !== 'awaiting_response') return false;
  if (!line.mine || !line.text?.trim()) return false;
  const readyAt = checkpoint.awaitingResponseAt ?? checkpoint.activatedAt ?? 0;
  // Must arrive strictly after question playback completed and awaiting response began
  if (line.at <= readyAt) return false;
  // Must not be the student line that was already present when awaiting response began
  if (checkpoint.lastStudentLineIdAtActivation && line.id === checkpoint.lastStudentLineIdAtActivation) {
    return false;
  }
  return true;
}

export function shouldCompleteCheckpoint(
  checkpoint: CheckpointEntry | undefined,
  lines: Array<{ id: string; mine: boolean; text?: string; at: number }> | undefined
): boolean {
  if (!checkpoint || !lines) return false;
  return lines.some((l) => isLearnerResponseForCheckpoint(checkpoint, l));
}

export function getLearnerResponseLine<
  T extends { id: string; mine: boolean; text?: string; at: number; final?: boolean },
>(checkpoint: CheckpointEntry | undefined, lines: T[] | undefined): T | undefined {
  if (!checkpoint || !lines) return undefined;
  return lines.find((l) => isLearnerResponseForCheckpoint(checkpoint, l));
}
