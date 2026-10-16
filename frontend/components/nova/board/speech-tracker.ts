/**
 * Production speech-to-board accumulator and isolation engine.
 *
 * Ensures:
 * 1. Restored base notes from archive are kept separate from live utterances and never duplicated.
 * 2. Live speech segments are tracked by unique line ID and concatenated once in chronological order.
 * 3. Watermarks prevent past transcript from leaking onto newly revealed steps.
 * 4. Activation records are strictly scoped by (boardId, conceptId) to prevent cross-board leakage.
 */

export interface SpeechLine {
  id: string;
  mine: boolean;
  text: string;
  at?: number;
  final?: boolean;
}

export interface SpeechSegment {
  conceptId: string;
  text: string;
  order: number;
  at?: number;
}

export interface SpeechTrackingState {
  /** boardId -> (lineId -> SpeechSegment) */
  boardSegments: Map<string, Map<string, SpeechSegment>>;
  /** `${boardId}::${conceptId}` -> lineId at activation watermark */
  conceptActivationWatermark: Map<string, string>;
  /** boardId -> (conceptId -> immutable base note from archive) */
  restoredBaseNotes: Map<string, Map<string, string>>;
  /** Monotonic sequence counter to preserve strict chronological ordering across evictions */
  segmentSeq: number;
}

export function createSpeechTrackingState(): SpeechTrackingState {
  return {
    boardSegments: new Map(),
    conceptActivationWatermark: new Map(),
    restoredBaseNotes: new Map(),
    segmentSeq: 0,
  };
}

export function activateConcept(
  state: SpeechTrackingState,
  boardId: string,
  conceptId: string,
  latestLineId: string = ''
) {
  const activationKey = `${boardId}::${conceptId}`;
  state.conceptActivationWatermark.set(activationKey, latestLineId);
}

export function processSpeechLines({
  state,
  boardId,
  activeConceptId,
  lines,
  initialStepNotes,
}: {
  state: SpeechTrackingState;
  boardId: string;
  activeConceptId: string;
  lines: SpeechLine[];
  initialStepNotes?: Record<string, string>;
}): {
  notes: Record<string, string>;
  hasChanges: boolean;
} {
  if (!boardId || !activeConceptId) {
    return { notes: initialStepNotes ?? {}, hasChanges: false };
  }

  // 1. Board-scoped segment store
  if (!state.boardSegments.has(boardId)) {
    state.boardSegments.set(boardId, new Map());
  }
  const boardSegmentMap = state.boardSegments.get(boardId)!;

  // 2. Base notes from initial archive restore (immutable base layer)
  if (!state.restoredBaseNotes.has(boardId)) {
    state.restoredBaseNotes.set(boardId, new Map());
  }
  const boardBaseNotes = state.restoredBaseNotes.get(boardId)!;
  if (initialStepNotes) {
    for (const [cid, text] of Object.entries(initialStepNotes)) {
      // Only register as base note if no live speech segments have been recorded for this concept yet
      const hasLiveSegments = Array.from(boardSegmentMap.values()).some((s) => s.conceptId === cid);
      if (text?.trim() && !boardBaseNotes.has(cid) && !hasLiveSegments) {
        boardBaseNotes.set(cid, text.trim());
      }
    }
  }

  // 3. Activation watermark scoped strictly by (boardId, conceptId)
  const activationKey = `${boardId}::${activeConceptId}`;
  const activationLineId = state.conceptActivationWatermark.get(activationKey) ?? '';
  const activationIndex = activationLineId
    ? lines.findIndex((l) => l.id === activationLineId)
    : -1;

  // 4. Upsert incoming agent lines into boardSegmentMap:
  // - If segment already exists, update interim text without changing conceptId or order.
  // - If new segment, assign to activeConceptId strictly if it arrived after concept activation.
  lines.forEach((l) => {
    if (!l.mine && l.text?.trim()) {
      if (boardSegmentMap.has(l.id)) {
        const seg = boardSegmentMap.get(l.id)!;
        if (seg.text !== l.text.trim()) {
          seg.text = l.text.trim();
        }
      } else {
        const lIndex = lines.findIndex((ln) => ln.id === l.id);
        if (lIndex > activationIndex) {
          state.segmentSeq += 1;
          boardSegmentMap.set(l.id, {
            conceptId: activeConceptId,
            text: l.text.trim(),
            order: state.segmentSeq,
            at: l.at,
          });
        }
      }
    }
  });

  // 5. Reconstruct notes combining base notes + all retained segments (even if evicted from `lines`)
  const allConcepts = new Set([
    ...Array.from(boardBaseNotes.keys()),
    ...Array.from(boardSegmentMap.values()).map((s) => s.conceptId),
  ]);

  const updatedNotes: Record<string, string> = { ...(initialStepNotes ?? {}) };
  let hasChanges = false;

  allConcepts.forEach((cid) => {
    const baseText = boardBaseNotes.get(cid) ?? '';

    // Collect all retained segments assigned to this concept in chronological order
    const conceptSegments = Array.from(boardSegmentMap.values())
      .filter((s) => s.conceptId === cid)
      .sort((a, b) => a.order - b.order);

    const liveCombined = conceptSegments
      .map((s) => s.text.trim())
      .filter(Boolean)
      .join(' ');

    let finalNote = baseText;
    if (liveCombined) {
      finalNote = baseText ? `${baseText} ${liveCombined}`.trim() : liveCombined;
    }

    if (finalNote && finalNote !== updatedNotes[cid]) {
      updatedNotes[cid] = finalNote;
      hasChanges = true;
    }
  });

  return { notes: updatedNotes, hasChanges };
}
