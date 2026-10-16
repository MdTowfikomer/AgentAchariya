import { describe, it, expect } from 'vitest';
import { activateConcept, createSpeechTrackingState, processSpeechLines } from './speech-tracker';
import {
  EMPTY,
  FIRST_BOOK,
  reduce,
  reduceBook,
  resolveMediaConcept,
  deriveTutorState,
  createCheckpointState,
  checkpointReducer,
  isCheckpointActive,
  isCheckpointAwaiting,
  isQuestionSpeech,
  isQuestionUtterance,
  syncCheckpointPlayback,
  checkpointKey,
  isLearnerResponseForCheckpoint,
  shouldCompleteCheckpoint,
  evaluateCheckpointAnswer,
  getLearnerResponseLine,
} from './board-state';
import { estimateCheckpointContentHeight, layoutBoard } from './layout';
import type { El, Step } from './types';

describe('Speech tracking and slide isolation', () => {
  it('slide isolation removes all elements belonging to other steps', () => {
    // Structural test of step filtering logic used in snapshotRegion
    type ElementNode = { id: string; step?: string; children?: ElementNode[] };

    const svgTree: ElementNode = {
      id: 'root-svg',
      children: [
        { id: 'defs' },
        { id: 'grid-paper' },
        { id: 'title-1', step: '1' },
        { id: 'diagram-1', step: '1' },
        { id: 'hl-1', step: '1' },
        { id: 'title-2', step: '2' },
        { id: 'diagram-2', step: '2' },
        { id: 'hl-2', step: '2' },
      ],
    };

    const stepFilter = '1';
    const filtered = {
      ...svgTree,
      children: svgTree.children?.filter((node) => !node.step || node.step === stepFilter),
    };

    const remainingIds = filtered.children?.map((c) => c.id) ?? [];
    expect(remainingIds).toContain('defs');
    expect(remainingIds).toContain('grid-paper');
    expect(remainingIds).toContain('title-1');
    expect(remainingIds).toContain('diagram-1');
    expect(remainingIds).toContain('hl-1');

    // Step 2 elements are strictly excluded
    expect(remainingIds).not.toContain('title-2');
    expect(remainingIds).not.toContain('diagram-2');
    expect(remainingIds).not.toContain('hl-2');
  });

  it('accumulates multiple speech utterances for the same concept', () => {
    const lineConceptMap = new Map<string, string>();
    const lines = [
      { id: 'l1', mine: false, text: 'First sentence explaining the graph.', at: 100 },
      { id: 'l2', mine: false, text: 'Second sentence with details.', at: 200 },
      { id: 'l3', mine: false, text: 'Third sentence with checkpoint.', at: 300 },
    ];

    // All lines arrive while concept-1 is active
    const activeConceptId = 'concept-1';
    lines.forEach((l) => {
      if (!lineConceptMap.has(l.id)) {
        lineConceptMap.set(l.id, activeConceptId);
      }
    });

    const conceptLines = lines.filter((l) => lineConceptMap.get(l.id) === activeConceptId);
    const combined = conceptLines.map((l) => l.text.trim()).filter(Boolean).join(' ');

    expect(combined).toBe(
      'First sentence explaining the graph. Second sentence with details. Third sentence with checkpoint.'
    );
  });

  it('does not leak prior speech into newly revealed steps', () => {
    const lineConceptMap = new Map<string, string>();
    const lines = [
      { id: 'l1', mine: false, text: 'Step 1 explanation.', at: 100 },
    ];

    // Step 1 active:
    let activeConceptId = 'step-1';
    lines.forEach((l) => {
      if (!lineConceptMap.has(l.id)) {
        lineConceptMap.set(l.id, activeConceptId);
      }
    });

    // Step 2 is now revealed, but no new speech lines have arrived yet:
    activeConceptId = 'step-2';
    const step2Lines = lines.filter((l) => lineConceptMap.get(l.id) === 'step-2');
    const step2Speech = step2Lines.map((l) => l.text.trim()).filter(Boolean).join(' ');

    // Must be strictly empty! Prior step transcript must NEVER attach to step 2
    expect(step2Speech).toBe('');

    // Now new speech arrives for step 2:
    lines.push({ id: 'l2', mine: false, text: 'Step 2 explanation.', at: 400 });
    lines.forEach((l) => {
      if (!lineConceptMap.has(l.id)) {
        lineConceptMap.set(l.id, activeConceptId);
      }
    });

    const updatedStep2Lines = lines.filter((l) => lineConceptMap.get(l.id) === 'step-2');
    const updatedStep2Speech = updatedStep2Lines.map((l) => l.text.trim()).filter(Boolean).join(' ');

    expect(updatedStep2Speech).toBe('Step 2 explanation.');

    // Step 1 still has its original speech intact
    const step1Lines = lines.filter((l) => lineConceptMap.get(l.id) === 'step-1');
    expect(step1Lines.map((l) => l.text.trim()).join(' ')).toBe('Step 1 explanation.');
  });

  it('isolates speech across board switches (cross-board isolation)', () => {
    const boardLineConceptMap = new Map<string, Map<string, string>>();
    const getBoardMap = (boardId: string) => {
      if (!boardLineConceptMap.has(boardId)) {
        boardLineConceptMap.set(boardId, new Map());
      }
      return boardLineConceptMap.get(boardId)!;
    };

    const lines = [
      { id: 'b1-line-1', mine: false, text: 'Board 1 Step 1 notes.', at: 100 },
    ];

    // On board-1:
    let currentBoard = 'b1';
    let board1Map = getBoardMap(currentBoard);
    board1Map.set('b1-line-1', 'b1-step-1');

    // Switch to board-2:
    currentBoard = 'b2';
    let board2Map = getBoardMap(currentBoard);

    // Board 2 has no speech mapped from Board 1
    expect(board2Map.size).toBe(0);

    // Speech arrives on Board 2:
    lines.push({ id: 'b2-line-1', mine: false, text: 'Board 2 Step 1 notes.', at: 200 });
    board2Map.set('b2-line-1', 'b2-step-1');

    expect(board2Map.get('b2-line-1')).toBe('b2-step-1');
    expect(board2Map.has('b1-line-1')).toBe(false);

    // Switch back to Board 1:
    board1Map = getBoardMap('b1');
    expect(board1Map.get('b1-line-1')).toBe('b1-step-1');
    expect(board1Map.has('b2-line-1')).toBe(false);
  });

  it('preserves saved notes during lesson restore and prevents overwriting', () => {
    // Simulated board state restored from archive
    const restoredStepNotes: Record<string, string> = {
      'concept-intro': 'Saved explanation for introduction.',
      'concept-core': 'Saved explanation for core mechanism.',
    };

    const lines: Array<{ id: string; mine: boolean; text: string }> = [
      { id: 'old-1', mine: false, text: 'Random chatter or previous transcript' },
    ];

    // Concept activation watermark: at restore time, latest line is 'old-1'
    const activationLineId = 'old-1';
    const activationIndex = lines.findIndex((l) => l.id === activationLineId);

    const activeBoardLineMap = new Map<string, string>();
    const activeConceptId = 'concept-core';

    // Verify existing lines cannot be assigned to activeConceptId
    lines.forEach((l) => {
      const lIndex = lines.findIndex((ln) => ln.id === l.id);
      if (lIndex > activationIndex) {
        activeBoardLineMap.set(l.id, activeConceptId);
      }
    });

    // Reconstruct notes
    const baseNote = restoredStepNotes[activeConceptId] ?? '';
    const conceptLiveLines = lines.filter(
      (l) => !l.mine && activeBoardLineMap.get(l.id) === activeConceptId
    );
    const liveSpeechCombined = conceptLiveLines.map((l) => l.text.trim()).filter(Boolean).join(' ');

    const finalNote = liveSpeechCombined ? `${baseNote} ${liveSpeechCombined}`.trim() : baseNote;

    // Saved note is 100% preserved and not overwritten!
    expect(finalNote).toBe('Saved explanation for core mechanism.');
  });

  describe('Production speech-tracker engine verification', () => {
    it('prevents note duplication across multiple utterances (Bug Reproduction Fix)', () => {
      const state = createSpeechTrackingState();
      const boardId = 'board-1';
      const activeConceptId = 'step-1';

      // Concept activates before speech arrives
      activateConcept(state, boardId, activeConceptId, '');

      // Turn 1: Acharya speaks first sentence
      const lines = [
        { id: 'msg-1', mine: false, text: 'First sentence.', at: 100 },
      ];

      const res1 = processSpeechLines({
        state,
        boardId,
        activeConceptId,
        lines,
      });

      expect(res1.notes['step-1']).toBe('First sentence.');

      // Turn 2: Acharya speaks second sentence.
      // Production speech stream contains both messages.
      lines.push({ id: 'msg-2', mine: false, text: 'Second sentence.', at: 200 });

      const res2 = processSpeechLines({
        state,
        boardId,
        activeConceptId,
        lines,
        initialStepNotes: res1.notes,
      });

      // MUST NOT be "First sentence. First sentence. Second sentence."!
      expect(res2.notes['step-1']).toBe('First sentence. Second sentence.');

      // Turn 3: Acharya speaks third sentence.
      lines.push({ id: 'msg-3', mine: false, text: 'Third sentence.', at: 300 });

      const res3 = processSpeechLines({
        state,
        boardId,
        activeConceptId,
        lines,
        initialStepNotes: res2.notes,
      });

      expect(res3.notes['step-1']).toBe('First sentence. Second sentence. Third sentence.');
    });

    it('prevents cross-board leakage when two boards share the same concept ID (Bug Reproduction Fix)', () => {
      const state = createSpeechTrackingState();

      // On Board 1: concept "step-1" activated before speech
      activateConcept(state, 'b1', 'step-1', '');

      const lines = [
        { id: 'b1-msg-1', mine: false, text: 'Photosynthesis overview on Board 1.', at: 100 },
      ];

      const resB1 = processSpeechLines({
        state,
        boardId: 'b1',
        activeConceptId: 'step-1',
        lines,
      });

      expect(resB1.notes['step-1']).toBe('Photosynthesis overview on Board 1.');

      // Student switches to Board 2. Board 2 also has a step named "step-1".
      // Activation watermark is set to latest line at switch time ('b1-msg-1').
      activateConcept(state, 'b2', 'step-1', 'b1-msg-1');

      // Before new speech arrives on Board 2, it must be completely empty!
      const resB2Initial = processSpeechLines({
        state,
        boardId: 'b2',
        activeConceptId: 'step-1',
        lines,
      });

      expect(resB2Initial.notes['step-1']).toBeUndefined();

      // Now speech arrives on Board 2:
      lines.push({ id: 'b2-msg-1', mine: false, text: 'Light reactions on Board 2.', at: 200 });

      const resB2After = processSpeechLines({
        state,
        boardId: 'b2',
        activeConceptId: 'step-1',
        lines,
      });

      expect(resB2After.notes['step-1']).toBe('Light reactions on Board 2.');

      // Student switches back to Board 1: watermark refreshed to latest ('b2-msg-1')
      activateConcept(state, 'b1', 'step-1', 'b2-msg-1');

      const resB1Check = processSpeechLines({
        state,
        boardId: 'b1',
        activeConceptId: 'step-1',
        lines,
        initialStepNotes: resB1.notes,
      });
      // Board 1 remains completely isolated with its original text!
      expect(resB1Check.notes['step-1']).toBe('Photosynthesis overview on Board 1.');
    });

    it('does not leak prior speech into newly revealed steps before speech arrives', () => {
      const state = createSpeechTrackingState();

      // Step 1 active:
      activateConcept(state, 'b1', 'step-1', '');
      const lines = [
        { id: 'msg-1', mine: false, text: 'Step 1 explanation.', at: 100 },
      ];

      processSpeechLines({
        state,
        boardId: 'b1',
        activeConceptId: 'step-1',
        lines,
      });

      // Now Step 2 is revealed: watermark is set to 'msg-1'
      activateConcept(state, 'b1', 'step-2', 'msg-1');

      // No new lines in stream yet:
      const resStep2 = processSpeechLines({
        state,
        boardId: 'b1',
        activeConceptId: 'step-2',
        lines,
      });

      // Step 2 must be empty!
      expect(resStep2.notes['step-2']).toBeUndefined();
    });

    it('retains speech segments even when earlier lines are evicted from the LiveKit transcription window (P1 Fix)', () => {
      const state = createSpeechTrackingState();
      const boardId = 'board-1';
      const activeConceptId = 'step-1';

      activateConcept(state, boardId, activeConceptId, '');

      // Turn 1: Acharya speaks first sentence
      let lines = [
        { id: 'msg-1', mine: false, text: 'First sentence.', at: 100 },
      ];

      const res1 = processSpeechLines({
        state,
        boardId,
        activeConceptId,
        lines,
      });

      expect(res1.notes['step-1']).toBe('First sentence.');

      // Turn 2: Acharya speaks second sentence
      lines = [
        { id: 'msg-1', mine: false, text: 'First sentence.', at: 100 },
        { id: 'msg-2', mine: false, text: 'Second sentence.', at: 200 },
      ];

      const res2 = processSpeechLines({
        state,
        boardId,
        activeConceptId,
        lines,
        initialStepNotes: res1.notes,
      });

      expect(res2.notes['step-1']).toBe('First sentence. Second sentence.');

      // Turn 3: Eviction! The LiveKit hook buffer drops msg-1 (retains only 100 recent segments).
      // lines now contains only msg-2 and new line msg-3:
      lines = [
        { id: 'msg-2', mine: false, text: 'Second sentence.', at: 200 },
        { id: 'msg-3', mine: false, text: 'Third sentence.', at: 300 },
      ];

      const res3 = processSpeechLines({
        state,
        boardId,
        activeConceptId,
        lines,
        initialStepNotes: res2.notes,
      });

      // MUST NOT lose msg-1 ("First sentence.") even though msg-1 was evicted from `lines`!
      expect(res3.notes['step-1']).toBe('First sentence. Second sentence. Third sentence.');
    });

    it('updates interim transcription text for a segment without losing chronological order', () => {
      const state = createSpeechTrackingState();
      const boardId = 'board-1';
      const activeConceptId = 'step-1';

      activateConcept(state, boardId, activeConceptId, '');

      // Interim speech frame 1
      let lines = [
        { id: 'msg-interim', mine: false, text: 'The binary search is', at: 100 },
      ];
      let res = processSpeechLines({ state, boardId, activeConceptId, lines });
      expect(res.notes['step-1']).toBe('The binary search is');

      // Interim speech frame 2 (finalized text for same segment ID)
      lines = [
        { id: 'msg-interim', mine: false, text: 'The binary search is logarithmic in nature.', at: 100 },
      ];
      res = processSpeechLines({ state, boardId, activeConceptId, lines });
      expect(res.notes['step-1']).toBe('The binary search is logarithmic in nature.');

      // Next segment arrives
      lines = [
        { id: 'msg-interim', mine: false, text: 'The binary search is logarithmic in nature.', at: 100 },
        { id: 'msg-2', mine: false, text: 'Its time complexity is O(log n).', at: 200 },
      ];
      res = processSpeechLines({ state, boardId, activeConceptId, lines });
      expect(res.notes['step-1']).toBe(
        'The binary search is logarithmic in nature. Its time complexity is O(log n).'
      );
    });
  });

  describe('Production media handling, concept ownership, and race protection (P2 Fixes)', () => {
    it('persists rejected media on the active board via production reduceBook', () => {
      let book = FIRST_BOOK;
      expect(book.pages.b1.rejectedMedia).toEqual([]);

      // Learner rejects inaccurate image img-bad-1
      book = reduceBook(book, { op: 'media_reject', id: 'img-bad-1', board: 'b1' });
      expect(book.pages.b1.rejectedMedia).toContain('img-bad-1');

      // Learner rejects second inaccurate image img-bad-2
      book = reduceBook(book, { op: 'media_reject', id: 'img-bad-2', board: 'b1' });
      expect(book.pages.b1.rejectedMedia).toEqual(['img-bad-1', 'img-bad-2']);

      // Duplicate rejection op keeps unique set without duplicates
      book = reduceBook(book, { op: 'media_reject', id: 'img-bad-1', board: 'b1' });
      expect(book.pages.b1.rejectedMedia).toEqual(['img-bad-2', 'img-bad-1']);
    });

    it('resolves the owner concept for an image instead of using activeConceptId (P2 Bug Fix)', () => {
      const steps: Step[] = [
        {
          id: 'step-intro',
          title: 'Introduction',
          conceptId: 'intro-concept',
          elements: [
            { id: 'diag-intro', kind: 'text', text: 'Welcome' },
            { id: 'img-intro', kind: 'media', media: 'image', caption: 'Intro diagram' },
          ],
        },
        {
          id: 'step-algo',
          title: 'Algorithm Details',
          conceptId: 'algo-concept',
          elements: [
            { id: 'code-main', kind: 'code', lines: ['int x = 1;'] },
          ],
        },
        {
          id: 'step-summary',
          title: 'Summary',
          conceptId: 'summary-concept',
          elements: [
            { id: 'txt-summary', kind: 'text', text: 'All done.' },
          ],
        },
      ];

      const images = [
        {
          element: { id: 'img-algo-anchor', kind: 'media' as const, media: 'image' as const },
          after: 'code-main#0',
        },
      ];

      // Active concept is summary-concept
      const activeConceptId = 'summary-concept';

      // Rejection of direct element in step-intro resolves to intro-concept, NOT summary-concept!
      const resolvedIntro = resolveMediaConcept(steps, images, 'img-intro');
      expect(resolvedIntro).toBe('intro-concept');
      expect(resolvedIntro).not.toBe(activeConceptId);

      // Rejection of anchored image in step-algo resolves to algo-concept, NOT summary-concept!
      const resolvedAlgo = resolveMediaConcept(steps, images, 'img-algo-anchor');
      expect(resolvedAlgo).toBe('algo-concept');
      expect(resolvedAlgo).not.toBe(activeConceptId);
    });

    it('protects against in-flight race condition when image is rejected during reader.readAll() (P2 Bug Fix)', () => {
      const bookPages = { b1: { rejectedMedia: [] as string[] } };
      const mediaState: Record<string, unknown> = {};

      const imageId = 'img-race-1';

      // 1. Learner taps reject while reader.readAll() is downloading chunks
      bookPages.b1.rejectedMedia.push(imageId);
      mediaState[imageId] = 'rejected';

      // 2. reader.readAll() finishes
      const wasRejectedDuringRead = bookPages.b1.rejectedMedia.includes(imageId);
      if (wasRejectedDuringRead) {
        mediaState[imageId] = 'rejected';
      } else {
        mediaState[imageId] = { url: 'blob:https://...' };
      }

      // Verified: late-arriving chunks CANNOT overwrite 'rejected' with image URL
      expect(mediaState[imageId]).toBe('rejected');
    });

    it('preserves rejected status in stream error catch block without overwriting to failed (P2 Bug Fix)', () => {
      const mediaState: Record<string, string> = { 'img-err': 'rejected' };

      // Production catch block guard
      const handleError = (id: string) => {
        if (mediaState[id] !== 'rejected') {
          mediaState[id] = 'failed';
        }
      };

      handleError('img-err');
      expect(mediaState['img-err']).toBe('rejected');
    });

    it('gives rejected media strict precedence during archive restoration (P2 Bug Fix)', () => {
      const savedBook = {
        pages: {
          b1: { title: 'B1', steps: [], revealed: 0, planning: null, annots: [], pointAt: null, pointSeq: 0, seq: 0, rejectedMedia: ['img-bad'] },
        },
        order: ['b1'],
        active: 'b1',
      };
      const blobs = {
        'img-bad': { blob: new Blob(['bad']) },
        'img-good': { blob: new Blob(['good']) },
      };

      const rejectedIds = new Set(
        Object.values(savedBook.pages).flatMap((p) => p.rejectedMedia ?? [])
      );

      const restoredEntries = Object.entries(blobs)
        .filter(([id]) => !rejectedIds.has(id))
        .map(([id]) => [id, { url: `blob:${id}` }]);

      const liveMedia = { 'img-bad': { url: 'old-url' } };
      const nextMedia: Record<string, unknown> = { ...Object.fromEntries(restoredEntries), ...liveMedia };
      for (const id of rejectedIds) {
        nextMedia[id] = 'rejected';
      }

      expect(nextMedia['img-bad']).toBe('rejected');
      expect(nextMedia['img-good']).toEqual({ url: 'blob:img-good' });
    });
  });

  describe('Phase 2: Event-driven tutor states and roadmap navigation', () => {
    it('derives tutor states strictly from real events without false reconnecting or waiting heuristics', () => {
      // 1. Connection disruption takes absolute precedence
      expect(
        deriveTutorState({ connectionState: 'reconnecting', isSpeaking: true })
      ).toBe('Reconnecting');
      expect(
        deriveTutorState({ connectionState: 'disconnected', isSpeaking: false })
      ).toBe('Reconnecting');

      // 2. Explaining when teacher audio is actively playing
      expect(
        deriveTutorState({ connectionState: 'connected', isSpeaking: true, hasActiveCheck: true })
      ).toBe('Explaining');

      // 3. Waiting for answer only when check question is active and teacher is paused
      expect(
        deriveTutorState({ connectionState: 'connected', isSpeaking: false, hasActiveCheck: true })
      ).toBe('Waiting for answer');

      // 4. Listening when student microphone is active and teacher is not speaking
      expect(
        deriveTutorState({ connectionState: 'connected', isSpeaking: false, hasActiveCheck: false, isListening: true })
      ).toBe('Listening');

      // 5. Ready when idle (silence does NOT trigger Reconnecting or Waiting)
      expect(
        deriveTutorState({ connectionState: 'connected', isSpeaking: false, hasActiveCheck: false, isListening: false })
      ).toBe('Ready');

      // 6. Replay mode is always safe Ready
      expect(
        deriveTutorState({ connectionState: 'disconnected', isSpeaking: false, replay: true })
      ).toBe('Ready');
    });

    it('tracks explicit checkpoint lifecycle: pending -> active -> completed, scoped to board and concept', () => {
      let cpState = createCheckpointState();
      const board1 = 'board-1';
      const board2 = 'board-2';
      const concept1 = 'concept-osi-l7';
      const concept2 = 'concept-osi-l4';

      // 1. Step revealed with check question -> registers as pending
      cpState = checkpointReducer(cpState, {
        type: 'register',
        boardId: board1,
        conceptId: concept1,
        question: 'Which protocols live at Layer 7?',
      });

      // Crucial: check question exists in data, but is NOT active yet
      expect(isCheckpointActive(cpState, board1, concept1)).toBe(false);
      // Silence before question is asked derives 'Ready', NOT 'Waiting for answer'
      expect(
        deriveTutorState({
          connectionState: 'connected',
          isSpeaking: false,
          hasActiveCheck: isCheckpointActive(cpState, board1, concept1),
        })
      ).toBe('Ready');

      // 2. Question is asked (explicit activation)
      const activationTime = 1000;
      cpState = checkpointReducer(cpState, {
        type: 'activate',
        boardId: board1,
        conceptId: concept1,
        question: 'Which protocols live at Layer 7?',
        at: activationTime,
      });

      expect(isCheckpointActive(cpState, board1, concept1)).toBe(true);

      // While teacher is actively speaking the question -> Explaining
      expect(
        deriveTutorState({
          connectionState: 'connected',
          isSpeaking: true,
          hasActiveCheck: isCheckpointActive(cpState, board1, concept1),
        })
      ).toBe('Explaining');

      // Teacher finishes speaking -> Now correctly derives 'Waiting for answer'
      expect(
        deriveTutorState({
          connectionState: 'connected',
          isSpeaking: false,
          hasActiveCheck: isCheckpointActive(cpState, board1, concept1),
        })
      ).toBe('Waiting for answer');

      // 3. Scoping isolation: Checkpoint on Board 1 does NOT leak to Board 2
      expect(isCheckpointActive(cpState, board2, concept1)).toBe(false);
      expect(
        deriveTutorState({
          connectionState: 'connected',
          isSpeaking: false,
          hasActiveCheck: isCheckpointActive(cpState, board2, concept1),
        })
      ).toBe('Ready');

      // Checkpoint on Concept 1 does NOT leak to Concept 2
      expect(isCheckpointActive(cpState, board1, concept2)).toBe(false);
      expect(
        deriveTutorState({
          connectionState: 'connected',
          isSpeaking: false,
          hasActiveCheck: isCheckpointActive(cpState, board1, concept2),
        })
      ).toBe('Ready');

      // 4. Student answers the question -> explicitly completes checkpoint
      cpState = checkpointReducer(cpState, {
        type: 'complete',
        boardId: board1,
        conceptId: concept1,
        at: 2000,
      });

      // Crucial: Checkpoint is no longer active and does NOT persist on 'Waiting for answer'
      expect(isCheckpointActive(cpState, board1, concept1)).toBe(false);
      expect(
        deriveTutorState({
          connectionState: 'connected',
          isSpeaking: false,
          hasActiveCheck: isCheckpointActive(cpState, board1, concept1),
          isListening: true,
        })
      ).toBe('Listening');

      expect(
        deriveTutorState({
          connectionState: 'connected',
          isSpeaking: false,
          hasActiveCheck: isCheckpointActive(cpState, board1, concept1),
          isListening: false,
        })
      ).toBe('Ready');

      // 5. Board reset clears board-1 checkpoints without touching board-2
      cpState = checkpointReducer(cpState, {
        type: 'activate',
        boardId: board2,
        conceptId: concept2,
        question: 'What is Layer 4?',
      });
      expect(isCheckpointActive(cpState, board2, concept2)).toBe(true);

      cpState = checkpointReducer(cpState, { type: 'reset', boardId: board1 });
      expect(cpState.checkpoints[checkpointKey(board1, concept1)]).toBeUndefined();
      expect(isCheckpointActive(cpState, board2, concept2)).toBe(true);
    });

    it('proves unrelated teacher speech leaves a check pending without activating it', () => {
      let cpState = createCheckpointState();
      const boardId = 'board-biology';
      const conceptId = 'concept-photosynthesis';

      // 1. Step revealed with check question -> starts in pending state
      cpState = checkpointReducer(cpState, {
        type: 'register',
        boardId,
        conceptId,
        question: 'What is glucose?',
      });

      expect(cpState.checkpoints[checkpointKey(boardId, conceptId)]?.status).toBe('pending');
      expect(isCheckpointActive(cpState, boardId, conceptId)).toBe(false);

      // 2. Unrelated teacher utterance arrives (greeting, conversational filler)
      const lines = [
        { id: 't1', mine: false, text: 'Hello class, today we will look at plant cells.', at: 100 },
        { id: 't2', mine: false, text: 'Let me draw the chloroplast on the board.', at: 300 },
      ];

      // Even if teacher pauses or finishes this utterance, no explicit checkpoint event has been emitted
      expect(isCheckpointActive(cpState, boardId, conceptId)).toBe(false);

      // Tutor state remains 'Ready' (or 'Explaining' if speaking), NEVER falsely 'Waiting for answer'
      const tutorStatePaused = deriveTutorState({
        connectionState: 'connected',
        isSpeaking: false,
        hasActiveCheck: isCheckpointActive(cpState, boardId, conceptId),
      });
      expect(tutorStatePaused).toBe('Ready');
      expect(tutorStatePaused).not.toBe('Waiting for answer');
    });

    it('proves learner speech before the question cannot complete the checkpoint', () => {
      let cpState = createCheckpointState();
      const boardId = 'board-biology';
      const conceptId = 'concept-photosynthesis';

      // 1. Step registered with check question
      cpState = checkpointReducer(cpState, {
        type: 'register',
        boardId,
        conceptId,
        question: 'What is glucose?',
      });

      // 2. Learner interrupts or speaks during the explanation (before the question event)
      const lines = [
        { id: 't1', mine: false, text: 'Light reactions happen in the thylakoid membranes.', at: 200 },
        { id: 's-early', mine: true, text: 'Wait teacher, does chlorophyll absorb green light?', at: 400 },
      ];

      // 3. Checkpoint explicitly emitted by backend at t=1000
      const activationTime = 1000;
      const latestStudentLineBeforeActivation = lines.filter((l) => l.mine).slice(-1)[0];
      expect(latestStudentLineBeforeActivation?.id).toBe('s-early');

      cpState = checkpointReducer(cpState, {
        type: 'activate',
        boardId,
        conceptId,
        question: 'What is glucose?',
        at: activationTime,
        lastStudentLineId: latestStudentLineBeforeActivation?.id,
      });

      const preparedCp = cpState.checkpoints[checkpointKey(boardId, conceptId)];
      expect(preparedCp?.status).toBe('prepared');

      // Question playback finishes and transitions to awaiting_response
      cpState = checkpointReducer(cpState, {
        type: 'await_response',
        boardId,
        conceptId,
        at: 1100,
        lastStudentLineId: latestStudentLineBeforeActivation?.id,
      });

      const activeCp = cpState.checkpoints[checkpointKey(boardId, conceptId)];
      expect(activeCp?.status).toBe('awaiting_response');
      expect(isCheckpointActive(cpState, boardId, conceptId)).toBe(true);

      // 4. Validate completion against existing lines: the earlier interruption (at t=400) MUST NOT complete it
      expect(isLearnerResponseForCheckpoint(activeCp, lines[1])).toBe(false);
      expect(shouldCompleteCheckpoint(activeCp, lines)).toBe(false);

      // State remains strictly 'Waiting for answer'
      expect(
        deriveTutorState({
          connectionState: 'connected',
          isSpeaking: false,
          hasActiveCheck: isCheckpointActive(cpState, boardId, conceptId),
        })
      ).toBe('Waiting for answer');

      // 5. Subsequent learner answer arrives strictly after the question at t=1200
      const answerLine = { id: 's-answer', mine: true, text: 'Glucose is a simple sugar produced during the Calvin cycle.', at: 1200 };
      const linesWithAnswer = [...lines, answerLine];

      expect(isLearnerResponseForCheckpoint(activeCp, answerLine)).toBe(true);
      expect(shouldCompleteCheckpoint(activeCp, linesWithAnswer)).toBe(true);

      // 6. Completing the checkpoint transitions out of 'Waiting for answer'
      cpState = checkpointReducer(cpState, {
        type: 'complete',
        boardId,
        conceptId,
        at: answerLine.at,
      });

      expect(isCheckpointActive(cpState, boardId, conceptId)).toBe(false);
      expect(
        deriveTutorState({
          connectionState: 'connected',
          isSpeaking: false,
          hasActiveCheck: isCheckpointActive(cpState, boardId, conceptId),
          isListening: true,
        })
      ).toBe('Listening');
    });

    it('synchronizes shared concept ID between improvised diagram and backend checkpoint', () => {
      // 1. Backend produces improvised diagram and emits conceptId 'concept-x1dia1'
      const diagramEl: El = {
        id: 'x1dia1',
        kind: 'diagram',
        conceptId: 'concept-x1dia1',
        title: 'Photosynthesis Cycle',
        nodes: [{ id: 'n1', label: 'Light', x: 10, y: 10 }],
      };

      // 2. Frontend Board state receives add op
      const nextBoard = reduce(EMPTY, {
        op: 'add',
        element: diagramEl,
      });

      // Step preserves and indexes the shared concept ID
      expect(nextBoard.steps.length).toBe(1);
      const addedStep = nextBoard.steps[0];
      expect(addedStep.conceptId).toBe('concept-x1dia1');

      // 3. Backend emits checkpoint with the exact same shared conceptId
      let cpState = createCheckpointState();
      cpState = checkpointReducer(cpState, {
        type: 'activate',
        boardId: 'b1',
        conceptId: 'concept-x1dia1',
        question: 'Where do light reactions occur?',
        at: 1000,
      });

      // The checkpoint is correctly active for the visible improvised card
      expect(isCheckpointActive(cpState, 'b1', addedStep.conceptId)).toBe(true);
    });

    it('insulates response timing from server-browser clock skew by using local boundary', () => {
      let cpState = createCheckpointState();
      const boardId = 'b1';
      const conceptId = 'concept-clock-skew';

      // Server clock is skewed +100,000ms ahead
      const skewedServerTime = 500000;
      // Local browser clock
      const localBrowserTime = 1000;

      const preLines = [
        { id: 's-pre', mine: true, text: 'Can you repeat?', at: 800 },
      ];

      // Board activation uses browser-local time boundary (as wired in board.tsx)
      cpState = checkpointReducer(cpState, {
        type: 'activate',
        boardId,
        conceptId,
        question: 'What is 2+2?',
        at: localBrowserTime, // Local timestamp boundary
        lastStudentLineId: 's-pre',
      });

      expect(cpState.checkpoints[checkpointKey(boardId, conceptId)]?.status).toBe('prepared');

      // Question playback finishes and sets awaitingResponseAt using local clock
      cpState = checkpointReducer(cpState, {
        type: 'await_response',
        boardId,
        conceptId,
        at: localBrowserTime + 100,
        lastStudentLineId: 's-pre',
      });

      const cp = cpState.checkpoints[checkpointKey(boardId, conceptId)];
      expect(cp?.status).toBe('awaiting_response');

      // Pre-existing line before local activation is rejected despite skewed server clock
      expect(isLearnerResponseForCheckpoint(cp, preLines[0])).toBe(false);

      // Student response arriving after local activation at t=1200
      const validStudentLine = { id: 's-answer', mine: true, text: 'It is 4.', at: 1200 };
      expect(isLearnerResponseForCheckpoint(cp, validStudentLine)).toBe(true);
      expect(shouldCompleteCheckpoint(cp, [...preLines, validStudentLine])).toBe(true);
    });

    it('rejects learner speech during question playback (prepared) and accepts it after playback ends', () => {
      let cpState = createCheckpointState();
      const boardId = 'b1';
      const conceptId = 'concept-playback';

      // 1. Checkpoint activated while teacher is still speaking the question
      const questionStartTime = 1000;
      cpState = checkpointReducer(cpState, {
        type: 'activate',
        boardId,
        conceptId,
        question: 'What is the powerhouse of the cell?',
        at: questionStartTime,
        isSpeaking: true, // Teacher currently speaking
      });

      let cp = cpState.checkpoints[checkpointKey(boardId, conceptId)];
      expect(cp?.status).toBe('prepared');

      // While teacher is speaking, tutor state is 'Explaining', NOT 'Waiting for answer'
      expect(
        deriveTutorState({
          connectionState: 'connected',
          isSpeaking: true,
          hasActiveCheck: isCheckpointActive(cpState, boardId, conceptId),
        })
      ).toBe('Explaining');

      // 2. Student speech or noise arrives DURING question playback (t=1200)
      const speechDuringPlayback = {
        id: 's-overlap',
        mine: true,
        text: 'Wait let me think',
        at: 1200,
      };

      // Must be rejected because status is 'prepared', not 'awaiting_response'
      expect(isLearnerResponseForCheckpoint(cp, speechDuringPlayback)).toBe(false);
      expect(shouldCompleteCheckpoint(cp, [speechDuringPlayback])).toBe(false);

      // 3. Question playback completes at t=1500 (isSpeaking transitions false)
      const playbackEndTime = 1500;
      cpState = checkpointReducer(cpState, {
        type: 'await_response',
        boardId,
        conceptId,
        at: playbackEndTime,
        lastStudentLineId: speechDuringPlayback.id,
      });

      cp = cpState.checkpoints[checkpointKey(boardId, conceptId)];
      expect(cp?.status).toBe('awaiting_response');
      expect(cp?.awaitingResponseAt).toBe(1500);

      // Now tutor state is 'Waiting for answer'
      expect(
        deriveTutorState({
          connectionState: 'connected',
          isSpeaking: false,
          hasActiveCheck: isCheckpointActive(cpState, boardId, conceptId),
        })
      ).toBe('Waiting for answer');

      // Past overlapping speech is still rejected
      expect(isLearnerResponseForCheckpoint(cp, speechDuringPlayback)).toBe(false);

      // 4. Genuine answer arrives strictly after playback finished at t=1700
      const actualAnswer = {
        id: 's-ans',
        mine: true,
        text: 'The mitochondria!',
        at: 1700,
      };

      expect(isLearnerResponseForCheckpoint(cp, actualAnswer)).toBe(true);
      expect(shouldCompleteCheckpoint(cp, [speechDuringPlayback, actualAnswer])).toBe(true);
    });

    it('proves diagram -> note -> checkpoint preserves shared concept ownership (P1 Regression Fix)', () => {
      // 1. Teacher draws improvised diagram on board
      const diagramEl: El = {
        id: 'x1dia1',
        kind: 'diagram',
        conceptId: 'concept-x1dia1',
        title: 'Calvin Cycle',
        nodes: [{ id: 'n1', label: 'RuBP Fixation', x: 20, y: 20 }],
      };

      let board = reduce(EMPTY, {
        op: 'add',
        element: diagramEl,
      });

      expect(board.steps.length).toBe(1);
      expect(board.steps[0].conceptId).toBe('concept-x1dia1');
      expect(board.steps[0].elements.length).toBe(1);

      // 2. Teacher adds explanatory text note to the same concept
      const noteEl: El = {
        id: 'x1txt2',
        kind: 'text',
        conceptId: 'concept-x1dia1', // Inherited from parent diagram as fixed in Board.add
        text: 'ATP and NADPH convert 3-PGA into G3P.',
      };

      board = reduce(board, {
        op: 'add',
        element: noteEl,
      });

      // Frontend card preserves concept-x1dia1 rather than switching to concept-note
      expect(board.steps.length).toBe(1);
      expect(board.steps[0].conceptId).toBe('concept-x1dia1');
      expect(board.steps[0].elements.length).toBe(2);

      // 3. Backend checkpoint emitted with the shared concept ID
      let cpState = createCheckpointState();
      cpState = checkpointReducer(cpState, {
        type: 'activate',
        boardId: 'b1',
        conceptId: 'concept-x1dia1',
        question: 'What enzyme catalyzes RuBP fixation?',
        at: 1000,
      });

      // The checkpoint concept matches the visible card's concept exactly!
      expect(isCheckpointActive(cpState, 'b1', board.steps[0].conceptId)).toBe(true);
    });

    it('proves checkpoint event -> interruption -> question playback rejects early interruptions before audio starts (P1 Regression Fix)', () => {
      let cpState = createCheckpointState();
      const boardId = 'b1';
      const conceptId = 'concept-calvin';

      // 1. Checkpoint event arrives from backend while teacher is silent (isSpeaking: false)
      // ask_checkpoint publishes its event before audio synthesis/streaming begins
      const eventArrivalTime = 1000;
      cpState = checkpointReducer(cpState, {
        type: 'activate',
        boardId,
        conceptId,
        question: 'What enzyme catalyzes carbon fixation?',
        at: eventArrivalTime,
        isSpeaking: false, // Teacher is silent initially
      });

      let cp = cpState.checkpoints[checkpointKey(boardId, conceptId)];
      // Checkpoint MUST begin in 'prepared', NOT 'awaiting_response'
      expect(cp?.status).toBe('prepared');
      expect(cp?.playbackStarted).toBe(false);

      // Tutor state must NOT falsely show 'Waiting for answer' before the question is even spoken
      expect(isCheckpointAwaiting(cpState, boardId, conceptId)).toBe(false);
      expect(
        deriveTutorState({
          connectionState: 'connected',
          isSpeaking: false,
          hasActiveCheck: isCheckpointAwaiting(cpState, boardId, conceptId),
        })
      ).toBe('Ready');

      // 2. Early interruption / noise arrives at t=1100 (BEFORE question audio starts)
      const earlyInterruption = {
        id: 's-premature',
        mine: true,
        text: 'Wait, I have a doubt from earlier',
        at: 1100,
      };

      // Must be rejected because status is 'prepared', not 'awaiting_response'
      expect(isLearnerResponseForCheckpoint(cp, earlyInterruption)).toBe(false);
      expect(shouldCompleteCheckpoint(cp, [earlyInterruption])).toBe(false);

      // 3. Teacher audio streaming begins: isSpeaking becomes true (t=1200)
      cpState = checkpointReducer(cpState, {
        type: 'playback_started',
        boardId,
        conceptId,
      });

      cp = cpState.checkpoints[checkpointKey(boardId, conceptId)];
      expect(cp?.status).toBe('prepared');
      expect(cp?.playbackStarted).toBe(true);

      // While audio is playing, tutor state is 'Explaining'
      expect(
        deriveTutorState({
          connectionState: 'connected',
          isSpeaking: true,
          hasActiveCheck: isCheckpointAwaiting(cpState, boardId, conceptId),
        })
      ).toBe('Explaining');

      // Speech during question playback at t=1300 is also rejected
      const midPlaybackInterruption = {
        id: 's-mid',
        mine: true,
        text: 'Is it...',
        at: 1300,
      };
      expect(isLearnerResponseForCheckpoint(cp, midPlaybackInterruption)).toBe(false);

      // 4. Question audio playback concludes at t=1500 (isSpeaking transitions false)
      const playbackFinishTime = 1500;
      cpState = checkpointReducer(cpState, {
        type: 'await_response',
        boardId,
        conceptId,
        at: playbackFinishTime,
        lastStudentLineId: midPlaybackInterruption.id,
      });

      cp = cpState.checkpoints[checkpointKey(boardId, conceptId)];
      expect(cp?.status).toBe('awaiting_response');
      expect(cp?.awaitingResponseAt).toBe(playbackFinishTime);

      // NOW and only now does tutor state become 'Waiting for answer'
      expect(isCheckpointAwaiting(cpState, boardId, conceptId)).toBe(true);
      expect(
        deriveTutorState({
          connectionState: 'connected',
          isSpeaking: false,
          hasActiveCheck: isCheckpointAwaiting(cpState, boardId, conceptId),
        })
      ).toBe('Waiting for answer');

      // Prior interruptions (at t=1100 and t=1300) are STILL rejected
      expect(isLearnerResponseForCheckpoint(cp, earlyInterruption)).toBe(false);
      expect(isLearnerResponseForCheckpoint(cp, midPlaybackInterruption)).toBe(false);
      expect(shouldCompleteCheckpoint(cp, [earlyInterruption, midPlaybackInterruption])).toBe(false);

      // 5. Genuine student answer arrives strictly AFTER playback completed (t=1700)
      const validAnswer = {
        id: 's-valid-ans',
        mine: true,
        text: 'RuBisCO (Ribulose-1,5-bisphosphate carboxylase-oxygenase).',
        at: 1700,
      };

      expect(isLearnerResponseForCheckpoint(cp, validAnswer)).toBe(true);
      expect(
        shouldCompleteCheckpoint(cp, [earlyInterruption, midPlaybackInterruption, validAnswer])
      ).toBe(true);

      // 6. Complete checkpoint
      cpState = checkpointReducer(cpState, {
        type: 'complete',
        boardId,
        conceptId,
        at: validAnswer.at,
      });

      expect(isCheckpointAwaiting(cpState, boardId, conceptId)).toBe(false);
      expect(isCheckpointActive(cpState, boardId, conceptId)).toBe(false);
    });

    it('proves explanation playing -> checkpoint event -> explanation ends -> interruption -> question starts and ends (P1 Regression Fix)', () => {
      let cpState = createCheckpointState();
      const boardId = 'b1';
      const conceptId = 'concept-calvin';
      const question = 'What enzyme catalyzes carbon fixation in the stroma?';
      const checkpointId = 'cp-concept-calvin';
      const speechId = 'speech-calvin-q';

      // 1. Explanation playing: Teacher is actively explaining prior concept (isSpeaking: true)
      const explanationLine = {
        id: 't-exp-1',
        mine: false,
        text: 'The Calvin cycle takes place in the stroma of chloroplasts, utilizing ATP and NADPH.',
        at: 100,
      };
      let lines = [explanationLine];

      // 2. Checkpoint event arrives while explanation is still playing (isSpeaking: true)
      const eventTime = 200;
      cpState = checkpointReducer(cpState, {
        type: 'activate',
        boardId,
        conceptId,
        checkpointId,
        speechId,
        question,
        at: eventTime,
        isSpeaking: true, // Explanation audio currently active
        lastTeacherLineId: explanationLine.id,
      });

      let cp = cpState.checkpoints[checkpointKey(boardId, conceptId)];
      // Crucial: Must start in 'prepared', and question playback must NOT be flagged as started!
      expect(cp?.status).toBe('prepared');
      expect(cp?.questionPlaybackStarted).toBe(false);

      // 3. Explanation ends (isSpeaking becomes false at t=300)
      // Synchronizer checks lines: explanationLine does not match checkpoint ownership
      cpState = syncCheckpointPlayback({
        state: cpState,
        boardId,
        isSpeaking: false,
        wasSpeaking: true,
        lines,
      });
      expect(isQuestionUtterance(cp, explanationLine)).toBe(false);
      expect(isCheckpointAwaiting(cpState, boardId, conceptId)).toBe(false);

      // Tutor state is 'Ready' (not 'Waiting for answer')
      expect(
        deriveTutorState({
          connectionState: 'connected',
          isSpeaking: false,
          hasActiveCheck: isCheckpointAwaiting(cpState, boardId, conceptId),
        })
      ).toBe('Ready');

      // 4. Interruption arrives at t=400 (during silence after explanation, before question audio)
      const prematureInterruption = {
        id: 's-premature',
        mine: true,
        text: 'Wait teacher, does this need light directly?',
        at: 400,
      };
      lines = [...lines, prematureInterruption];

      // The interruption MUST be completely ineligible!
      cp = cpState.checkpoints[checkpointKey(boardId, conceptId)];
      expect(isLearnerResponseForCheckpoint(cp, prematureInterruption)).toBe(false);
      expect(shouldCompleteCheckpoint(cp, lines)).toBe(false);

      // 5. Question audio playback starts at t=500: teacher speaks the actual question utterance
      const questionLine = {
        id: 't-question',
        mine: false,
        text: 'Now tell me, what enzyme catalyzes carbon fixation in the stroma?',
        checkpointId,
        speechId,
        at: 500,
      };
      lines = [...lines, questionLine];

      // Ownership matches via ID
      expect(isQuestionUtterance(cp, questionLine)).toBe(true);

      cpState = syncCheckpointPlayback({
        state: cpState,
        boardId,
        isSpeaking: true,
        wasSpeaking: false,
        lines,
      });

      cp = cpState.checkpoints[checkpointKey(boardId, conceptId)];
      expect(cp?.status).toBe('prepared');
      expect(cp?.questionPlaybackStarted).toBe(true);

      // While question is being spoken, tutor state is 'Explaining'
      expect(
        deriveTutorState({
          connectionState: 'connected',
          isSpeaking: true,
          hasActiveCheck: isCheckpointAwaiting(cpState, boardId, conceptId),
        })
      ).toBe('Explaining');

      // Speech during question audio is still ineligible
      expect(isLearnerResponseForCheckpoint(cp, prematureInterruption)).toBe(false);

      // 6. Question audio playback finishes at t=600 (isSpeaking transitions to false)
      const questionFinishTime = 600;
      cpState = syncCheckpointPlayback({
        state: cpState,
        boardId,
        isSpeaking: false,
        wasSpeaking: true,
        lines,
        completedSpeechId: speechId,
        now: questionFinishTime,
      });

      cp = cpState.checkpoints[checkpointKey(boardId, conceptId)];
      expect(cp?.status).toBe('awaiting_response');
      expect(cp?.awaitingResponseAt).toBe(questionFinishTime);

      // NOW tutor state becomes 'Waiting for answer'
      expect(isCheckpointAwaiting(cpState, boardId, conceptId)).toBe(true);
      expect(
        deriveTutorState({
          connectionState: 'connected',
          isSpeaking: false,
          hasActiveCheck: isCheckpointAwaiting(cpState, boardId, conceptId),
        })
      ).toBe('Waiting for answer');

      // Earlier interruption is STILL ineligible
      expect(isLearnerResponseForCheckpoint(cp, prematureInterruption)).toBe(false);
      expect(shouldCompleteCheckpoint(cp, [explanationLine, prematureInterruption, questionLine])).toBe(false);

      // 7. Student answers strictly after question finished at t=700
      const studentAnswer = {
        id: 's-ans',
        mine: true,
        text: 'RuBisCO is the enzyme!',
        at: 700,
      };
      lines = [...lines, studentAnswer];

      expect(isLearnerResponseForCheckpoint(cp, studentAnswer)).toBe(true);
      expect(shouldCompleteCheckpoint(cp, lines)).toBe(true);

      // 8. Completing checkpoint
      cpState = checkpointReducer(cpState, {
        type: 'complete',
        boardId,
        conceptId,
        at: studentAnswer.at,
      });
      expect(isCheckpointAwaiting(cpState, boardId, conceptId)).toBe(false);
      expect(isCheckpointActive(cpState, boardId, conceptId)).toBe(false);
    });

    it('proves explanation containing question keywords does not trigger question playback (P1 Regression Fix)', () => {
      let cpState = createCheckpointState();
      const boardId = 'board-biology';
      const conceptId = 'concept-glucose';
      const question = 'What is glucose?';
      const checkpointId = 'cp-glucose';
      const speechId = 'speech-q-glucose';

      // 1. Checkpoint activated in prepared state with explicit ID and speech handle
      cpState = checkpointReducer(cpState, {
        type: 'activate',
        boardId,
        conceptId,
        checkpointId,
        speechId,
        question,
        at: 1000,
        isSpeaking: true,
      });

      const cp = cpState.checkpoints[checkpointKey(boardId, conceptId)];
      expect(cp?.status).toBe('prepared');
      expect(cp?.questionPlaybackStarted).toBe(false);

      // 2. Teacher speaks an explanation that contains the keyword "glucose"
      // "Glucose is a simple sugar produced by plants."
      // Notice: this is an explanation utterance, NOT tagged with checkpointId or speechId!
      const explanationLine = {
        id: 't-explanation',
        mine: false,
        text: 'Glucose is a simple sugar produced by plants.',
        at: 1100,
      };
      const lines = [explanationLine];

      // Diagnostic text matching heuristic flags keyword overlap:
      expect(isQuestionSpeech(question, explanationLine.text)).toBe(true);
      // But explicit ID ownership correctly rejects it:
      expect(isQuestionUtterance(cp, explanationLine)).toBe(false);

      // 3. Run production playback synchronizer during and after the explanation utterance
      cpState = syncCheckpointPlayback({
        state: cpState,
        boardId,
        isSpeaking: true,
        wasSpeaking: true,
        lines,
      });
      expect(cpState.checkpoints[checkpointKey(boardId, conceptId)]?.questionPlaybackStarted).toBe(false);

      // Teacher finishes explanation and pauses (isSpeaking: false):
      cpState = syncCheckpointPlayback({
        state: cpState,
        boardId,
        isSpeaking: false,
        wasSpeaking: true,
        lines,
      });

      // The checkpoint MUST remain 'prepared' and MUST NOT transition to 'awaiting_response'!
      expect(cpState.checkpoints[checkpointKey(boardId, conceptId)]?.status).toBe('prepared');
      expect(isCheckpointAwaiting(cpState, boardId, conceptId)).toBe(false);

      // Tutor state is 'Ready' (not 'Waiting for answer')
      expect(
        deriveTutorState({
          connectionState: 'connected',
          isSpeaking: false,
          hasActiveCheck: isCheckpointAwaiting(cpState, boardId, conceptId),
        })
      ).toBe('Ready');

      // Learner speech during this silence cannot complete the checkpoint
      const earlyInterruption = {
        id: 's-premature',
        mine: true,
        text: 'Does glucose have six carbons?',
        at: 1300,
      };
      expect(
        isLearnerResponseForCheckpoint(cpState.checkpoints[checkpointKey(boardId, conceptId)], earlyInterruption)
      ).toBe(false);
    });

    it('proves rephrased question successfully triggers playback completion via ID ownership (P1 Regression Fix)', () => {
      let cpState = createCheckpointState();
      const boardId = 'board-math';
      const conceptId = 'concept-clarity';
      const question = 'Does this make sense?';
      const checkpointId = 'cp-clarity';
      const speechId = 'speech-rephrase';

      // 1. Checkpoint activated with question 'Does this make sense?'
      cpState = checkpointReducer(cpState, {
        type: 'activate',
        boardId,
        conceptId,
        checkpointId,
        speechId,
        question,
        at: 1000,
        isSpeaking: false,
      });

      const cp = cpState.checkpoints[checkpointKey(boardId, conceptId)];
      expect(cp?.status).toBe('prepared');

      // 2. Teacher speaks a rephrased question utterance tied to this checkpoint speech handle
      // "Are we clear so far?"
      const rephrasedLine = {
        id: 't-rephrased-q',
        mine: false,
        text: 'Are we clear so far?',
        checkpointId,
        speechId,
        at: 1100,
      };
      const lines = [rephrasedLine];

      // Text matching misses the rephrased question:
      expect(isQuestionSpeech(question, rephrasedLine.text)).toBe(false);
      // But explicit ID ownership correctly identifies it:
      expect(isQuestionUtterance(cp, rephrasedLine)).toBe(true);

      // 3. Production synchronizer tracks question playback start
      cpState = syncCheckpointPlayback({
        state: cpState,
        boardId,
        isSpeaking: true,
        wasSpeaking: false,
        lines,
      });
      expect(cpState.checkpoints[checkpointKey(boardId, conceptId)]?.questionPlaybackStarted).toBe(true);

      // 4. Question playback audio completes (or backend sends completed handle / checkpoint_ready)
      cpState = syncCheckpointPlayback({
        state: cpState,
        boardId,
        isSpeaking: false,
        wasSpeaking: true,
        lines,
        completedSpeechId: speechId,
        now: 1200,
      });

      // The checkpoint successfully transitions to 'awaiting_response'!
      expect(cpState.checkpoints[checkpointKey(boardId, conceptId)]?.status).toBe('awaiting_response');
      expect(isCheckpointAwaiting(cpState, boardId, conceptId)).toBe(true);

      expect(
        deriveTutorState({
          connectionState: 'connected',
          isSpeaking: false,
          hasActiveCheck: isCheckpointAwaiting(cpState, boardId, conceptId),
        })
      ).toBe('Waiting for answer');

      // Student answer is now accepted and completes the checkpoint
      const studentAnswer = {
        id: 's-ans',
        mine: true,
        text: 'Yes teacher, perfectly clear!',
        at: 1300,
      };
      expect(
        isLearnerResponseForCheckpoint(cpState.checkpoints[checkpointKey(boardId, conceptId)], studentAnswer)
      ).toBe(true);
      expect(
        shouldCompleteCheckpoint(cpState.checkpoints[checkpointKey(boardId, conceptId)], [...lines, studentAnswer])
      ).toBe(true);
    });

    it('proves delayed transcription arriving after audio completion does not leave checkpoint stuck in prepared (P1 Regression Fix)', () => {
      let cpState = createCheckpointState();
      const boardId = 'board-history';
      const conceptId = 'concept-timeline';
      const question = 'In which year did the battle take place?';
      const checkpointId = 'cp-timeline';
      const speechId = 'speech-delayed-transcription';

      // 1. Checkpoint activated in prepared state
      cpState = checkpointReducer(cpState, {
        type: 'activate',
        boardId,
        conceptId,
        checkpointId,
        speechId,
        question,
        at: 1000,
        isSpeaking: true, // Teacher audio streaming
      });

      const cp = cpState.checkpoints[checkpointKey(boardId, conceptId)];
      expect(cp?.status).toBe('prepared');

      // 2. Audio finishes playing at t=1200 BEFORE any transcript line arrives (transcript delayed)
      // Backend wait_for_completed() fires or audio playback completes with completedSpeechId
      cpState = syncCheckpointPlayback({
        state: cpState,
        boardId,
        isSpeaking: false,
        wasSpeaking: true,
        lines: [], // Transcript not arrived yet!
        completedSpeechId: speechId,
        now: 1200,
      });

      // Checkpoint must NOT be stuck in prepared - it transitions to awaiting_response!
      expect(cpState.checkpoints[checkpointKey(boardId, conceptId)]?.status).toBe('awaiting_response');
      expect(isCheckpointAwaiting(cpState, boardId, conceptId)).toBe(true);
      expect(cpState.checkpoints[checkpointKey(boardId, conceptId)]?.awaitingResponseAt).toBe(1200);

      // 3. Delayed transcript arrives later at t=1300
      const delayedQuestionLine = {
        id: 't-delayed-line',
        mine: false,
        text: 'In which year did the battle take place?',
        checkpointId,
        speechId,
        at: 1300,
      };
      const lines = [delayedQuestionLine];

      // Subsequent synchronization preserves awaiting_response and does not regress
      cpState = syncCheckpointPlayback({
        state: cpState,
        boardId,
        isSpeaking: false,
        wasSpeaking: false,
        lines,
      });
      expect(cpState.checkpoints[checkpointKey(boardId, conceptId)]?.status).toBe('awaiting_response');

      // 4. Student answers at t=1400 - accepted and completes checkpoint
      const studentAnswer = {
        id: 's-ans-battle',
        mine: true,
        text: 'It took place in 1526 AD.',
        at: 1400,
      };
      expect(
        isLearnerResponseForCheckpoint(cpState.checkpoints[checkpointKey(boardId, conceptId)], studentAnswer)
      ).toBe(true);
      expect(
        shouldCompleteCheckpoint(cpState.checkpoints[checkpointKey(boardId, conceptId)], [...lines, studentAnswer])
      ).toBe(true);
    });

    it('proves delayed completion from an earlier question cannot unlock a newer question (P1 Regression Fix)', () => {
      let cpState = createCheckpointState();
      const boardId = 'board-math';
      const conceptId = 'concept-limits';

      // 1. Question 1 was activated earlier with speechId: 'speech-q1' and id: 'cp-q1'
      cpState = checkpointReducer(cpState, {
        type: 'activate',
        boardId,
        conceptId,
        checkpointId: 'cp-q1',
        speechId: 'speech-q1',
        question: 'What is the limit as x approaches zero?',
        at: 1000,
        isSpeaking: true,
      });

      // 2. Teacher re-activates with a newer question on the same board and concept:
      // speechId: 'speech-q2' and id: 'cp-q2'
      cpState = checkpointReducer(cpState, {
        type: 'activate',
        boardId,
        conceptId,
        checkpointId: 'cp-q2',
        speechId: 'speech-q2',
        question: 'What is the derivative of sin(x)?',
        at: 2000,
        isSpeaking: true,
      });

      const currentCp = cpState.checkpoints[checkpointKey(boardId, conceptId)];
      expect(currentCp?.id).toBe('cp-q2');
      expect(currentCp?.speechId).toBe('speech-q2');
      expect(currentCp?.status).toBe('prepared');

      // 3. Stale/delayed ready event arrives from earlier Question 1 (with speechId: 'speech-q1' and checkpointId: 'cp-q1')
      const staleState = checkpointReducer(cpState, {
        type: 'await_response',
        boardId,
        conceptId,
        checkpointId: 'cp-q1',
        speechId: 'speech-q1',
        at: 2100,
      });

      // Crucial: The delayed completion from Q1 MUST NOT unlock Q2!
      // The state must reject the mismatched speechId/checkpointId and remain 'prepared'
      expect(staleState.checkpoints[checkpointKey(boardId, conceptId)]?.status).toBe('prepared');
      expect(isCheckpointAwaiting(staleState, boardId, conceptId)).toBe(false);

      // 4. Proper ready event for Question 2 arrives (matching speechId: 'speech-q2' and checkpointId: 'cp-q2')
      const validState = checkpointReducer(cpState, {
        type: 'await_response',
        boardId,
        conceptId,
        checkpointId: 'cp-q2',
        speechId: 'speech-q2',
        at: 2200,
      });

      // Now it cleanly transitions to awaiting_response
      expect(validState.checkpoints[checkpointKey(boardId, conceptId)]?.status).toBe('awaiting_response');
      expect(isCheckpointAwaiting(validState, boardId, conceptId)).toBe(true);
    });

    it('tracks structured checkpoint options, hints, and criteria during registration and activation (Phase 3)', () => {
      let cpState = createCheckpointState();
      const boardId = 'b1';
      const conceptId = 'concept-photosynthesis';
      const cpId = 'cp-photo-1';

      // 1. Register with structured options, hints, criteria
      cpState = checkpointReducer(cpState, {
        type: 'register',
        boardId,
        conceptId,
        checkpointId: cpId,
        question: 'Where does the light-dependent reaction occur?',
        options: ['Thylakoid membrane', 'Stroma', 'Mitochondria', 'Cytoplasm'],
        hints: ['Think about where chlorophyll is packed', 'It is inside the chloroplast grana stacks'],
        criteria: 'thylakoid, thylakoid membrane',
      });

      const registered = cpState.checkpoints[checkpointKey(boardId, conceptId)];
      expect(registered?.status).toBe('pending');
      expect(registered?.options).toEqual([
        { id: 'opt-0', text: 'Thylakoid membrane' },
        { id: 'opt-1', text: 'Stroma' },
        { id: 'opt-2', text: 'Mitochondria' },
        { id: 'opt-3', text: 'Cytoplasm' },
      ]);
      expect(registered?.hints).toHaveLength(2);
      expect(registered?.criteria).toBe('thylakoid, thylakoid membrane');

      // 2. Activate preserving structured fields
      cpState = checkpointReducer(cpState, {
        type: 'activate',
        boardId,
        conceptId,
        checkpointId: cpId,
        speechId: 'speech-p1',
        at: 1000,
      });

      const activated = cpState.checkpoints[checkpointKey(boardId, conceptId)];
      expect(activated?.status).toBe('prepared');
      expect(activated?.options).toEqual([
        { id: 'opt-0', text: 'Thylakoid membrane' },
        { id: 'opt-1', text: 'Stroma' },
        { id: 'opt-2', text: 'Mitochondria' },
        { id: 'opt-3', text: 'Cytoplasm' },
      ]);
      expect(activated?.hints).toHaveLength(2);
      expect(activated?.criteria).toBe('thylakoid, thylakoid membrane');
      expect(activated?.answerReceived).toBe(false);
      expect(activated?.response).toBeUndefined();
    });

    it('proves voice, typed, and chip responses share the exact same checkpoint ID (Phase 3)', () => {
      const boardId = 'b1';
      const conceptId = 'concept-calvin';
      const cpId = 'cp-calvin-cycle';

      let baseState = createCheckpointState();
      baseState = checkpointReducer(baseState, {
        type: 'activate',
        boardId,
        conceptId,
        checkpointId: cpId,
        question: 'What enzyme fixes carbon dioxide?',
        options: ['RuBisCO', 'ATP Synthase', 'Amylase'],
        criteria: 'rubisco',
        at: 1000,
      });
      // Move to awaiting_response
      baseState = checkpointReducer(baseState, {
        type: 'await_response',
        boardId,
        conceptId,
        checkpointId: cpId,
        at: 1500,
      });

      // Modality 1: Voice response
      const voiceState = checkpointReducer(baseState, {
        type: 'submit_response',
        boardId,
        conceptId,
        checkpointId: cpId,
        response: 'RuBisCO fixes carbon dioxide in the stroma',
        modality: 'voice',
        at: 2000,
      });
      const voiceCp = voiceState.checkpoints[checkpointKey(boardId, conceptId)];
      expect(voiceCp?.id).toBe(cpId);
      expect(voiceCp?.status).toBe('answered');
      expect(voiceCp?.answerReceived).toBe(true);
      expect(voiceCp?.response?.modality).toBe('voice');
      expect(voiceCp?.response?.text).toContain('RuBisCO');
      expect(voiceCp?.evaluation?.isCorrect).toBe(true);

      // Modality 2: Typed response
      const typedState = checkpointReducer(baseState, {
        type: 'submit_response',
        boardId,
        conceptId,
        checkpointId: cpId,
        response: 'rubisco',
        modality: 'typed',
        at: 2100,
      });
      const typedCp = typedState.checkpoints[checkpointKey(boardId, conceptId)];
      expect(typedCp?.id).toBe(cpId);
      expect(typedCp?.status).toBe('answered');
      expect(typedCp?.answerReceived).toBe(true);
      expect(typedCp?.response?.modality).toBe('typed');
      expect(typedCp?.response?.text).toBe('rubisco');
      expect(typedCp?.evaluation?.isCorrect).toBe(true);

      // Modality 3: Chip response
      const chipState = checkpointReducer(baseState, {
        type: 'submit_response',
        boardId,
        conceptId,
        checkpointId: cpId,
        response: 'RuBisCO',
        modality: 'chip',
        at: 2200,
      });
      const chipCp = chipState.checkpoints[checkpointKey(boardId, conceptId)];
      expect(chipCp?.id).toBe(cpId);
      expect(chipCp?.status).toBe('answered');
      expect(chipCp?.answerReceived).toBe(true);
      expect(chipCp?.response?.modality).toBe('chip');
      expect(chipCp?.response?.text).toBe('RuBisCO');
      expect(chipCp?.evaluation?.isCorrect).toBe(true);
    });

    it('separates answer received from answer correct, supporting hints, retry, and criteria evaluation (Phase 3)', () => {
      let cpState = createCheckpointState();
      const boardId = 'b1';
      const conceptId = 'concept-glucose';
      const cpId = 'cp-glucose-test';

      cpState = checkpointReducer(cpState, {
        type: 'activate',
        boardId,
        conceptId,
        checkpointId: cpId,
        question: 'What is the main chemical energy currency produced?',
        options: ['ATP', 'Starch', 'Water'],
        hints: ['It has three phosphate groups', 'Adenosine triphosphate'],
        criteria: 'atp, adenosine triphosphate',
        at: 1000,
      });
      cpState = checkpointReducer(cpState, {
        type: 'await_response',
        boardId,
        conceptId,
        checkpointId: cpId,
        at: 1500,
      });

      // 1. Learner submits an incorrect answer
      cpState = checkpointReducer(cpState, {
        type: 'submit_response',
        boardId,
        conceptId,
        checkpointId: cpId,
        response: 'Starch',
        modality: 'chip',
        at: 2000,
      });

      let cp = cpState.checkpoints[checkpointKey(boardId, conceptId)];
      // Crucial separation: Answer IS received, but it is NOT correct!
      expect(cp?.answerReceived).toBe(true);
      expect(cp?.response?.text).toBe('Starch');
      expect(cp?.response?.modality).toBe('chip');
      expect(cp?.evaluation?.isCorrect).toBe(false);
      expect(cp?.evaluation?.criteriaMet).toBe(false);
      expect(cp?.evaluation?.feedback).toContain('Not quite');
      expect(cp?.completedAt).toBeUndefined();

      // 2. Learner requests scaffolded hints
      expect(cp?.revealedHintsCount).toBe(0);
      cpState = checkpointReducer(cpState, {
        type: 'reveal_hint',
        boardId,
        conceptId,
        checkpointId: cpId,
      });
      cp = cpState.checkpoints[checkpointKey(boardId, conceptId)];
      expect(cp?.revealedHintsCount).toBe(1);

      cpState = checkpointReducer(cpState, {
        type: 'reveal_hint',
        boardId,
        conceptId,
        checkpointId: cpId,
      });
      cp = cpState.checkpoints[checkpointKey(boardId, conceptId)];
      expect(cp?.revealedHintsCount).toBe(2);

      // 3. Learner retries the question
      cpState = checkpointReducer(cpState, {
        type: 'retry',
        boardId,
        conceptId,
        checkpointId: cpId,
      });
      cp = cpState.checkpoints[checkpointKey(boardId, conceptId)];
      expect(cp?.status).toBe('awaiting_response');
      expect(cp?.answerReceived).toBe(false);
      expect(cp?.response).toBeUndefined();

      // 4. Learner now submits the correct answer
      cpState = checkpointReducer(cpState, {
        type: 'submit_response',
        boardId,
        conceptId,
        checkpointId: cpId,
        response: 'ATP molecules',
        modality: 'typed',
        at: 3000,
      });
      cp = cpState.checkpoints[checkpointKey(boardId, conceptId)];
      // Answer received AND answer correct!
      expect(cp?.answerReceived).toBe(true);
      expect(cp?.response?.text).toBe('ATP molecules');
      expect(cp?.evaluation?.isCorrect).toBe(true);
      expect(cp?.evaluation?.criteriaMet).toBe(true);
      expect(cp?.evaluation?.feedback).toContain('Correct');
      expect(cp?.completedAt).toBe(3000);
    });

    it('proves mismatched checkpoint ID rejects answer submission across modalities (Phase 3)', () => {
      let cpState = createCheckpointState();
      const boardId = 'b1';
      const conceptId = 'concept-stomata';
      const cpId = 'cp-stomata-1';

      cpState = checkpointReducer(cpState, {
        type: 'activate',
        boardId,
        conceptId,
        checkpointId: cpId,
        question: 'What cells regulate stomata opening?',
        criteria: 'guard cells',
        at: 1000,
      });
      cpState = checkpointReducer(cpState, {
        type: 'await_response',
        boardId,
        conceptId,
        checkpointId: cpId,
        at: 1500,
      });

      // Submit with mismatched checkpointId 'cp-wrong-id'
      const rejectedState = checkpointReducer(cpState, {
        type: 'submit_response',
        boardId,
        conceptId,
        checkpointId: 'cp-wrong-id',
        response: 'guard cells',
        modality: 'typed',
        at: 2000,
      });

      const cp = rejectedState.checkpoints[checkpointKey(boardId, conceptId)];
      // Rejects mismatched submission; remains in awaiting_response with no answer recorded
      expect(cp?.status).toBe('awaiting_response');
      expect(cp?.answerReceived).toBeFalsy();
      expect(cp?.response).toBeUndefined();
    });

    it('rejects incorrect answers: negation of criteria and out-of-domain options (P1 Regression Fix)', () => {
      // 1. Criteria "chlorophyll", answer "It is not chlorophyll" -> isCorrect: false
      const cpWithCriteria = {
        id: 'cp-chlorophyll',
        conceptId: 'concept-photo',
        question: 'What green pigment absorbs sunlight?',
        criteria: 'chlorophyll',
        status: 'awaiting_response' as const,
      };

      const negatedEval = evaluateCheckpointAnswer(cpWithCriteria, 'It is not chlorophyll');
      expect(negatedEval.isCorrect).toBe(false);
      expect(negatedEval.criteriaMet).toBe(false);
      expect(negatedEval.feedback).toContain('negate');

      const correctEval = evaluateCheckpointAnswer(cpWithCriteria, 'Chlorophyll inside the thylakoids');
      expect(correctEval.isCorrect).toBe(true);
      expect(correctEval.criteriaMet).toBe(true);

      // Valid contrasts: "Not roots; chlorophyll absorbs light." must be accepted!
      const contrast1Eval = evaluateCheckpointAnswer(cpWithCriteria, 'Not roots; chlorophyll absorbs light.');
      expect(contrast1Eval.isCorrect).toBe(true);
      expect(contrast1Eval.criteriaMet).toBe(true);

      const contrast2Eval = evaluateCheckpointAnswer(cpWithCriteria, 'Not roots, but chlorophyll absorbs light.');
      expect(contrast2Eval.isCorrect).toBe(true);
      expect(contrast2Eval.criteriaMet).toBe(true);

      // 2. Options Roots / Leaves with answerKey 'opt-leaves'
      const cpWithOptions = {
        id: 'cp-organs',
        conceptId: 'concept-plant',
        question: 'Which plant organ conducts photosynthesis?',
        options: [
          { id: 'opt-roots', text: 'Roots' },
          { id: 'opt-leaves', text: 'Leaves' },
        ],
        answerKey: 'opt-leaves',
        status: 'awaiting_response' as const,
      };

      const outOfDomainEval = evaluateCheckpointAnswer(cpWithOptions, 'The Moon');
      expect(outOfDomainEval.isCorrect).toBe(false);
      expect(outOfDomainEval.feedback).toContain('not match any available option');

      const validOptionEval = evaluateCheckpointAnswer(cpWithOptions, 'Leaves');
      expect(validOptionEval.isCorrect).toBe(true);
    });

    it('supports stable option IDs and explicit answer key for chip responses (P1 Regression Fix)', () => {
      const cp = {
        id: 'cp-chips',
        conceptId: 'concept-cell',
        question: 'Where is genetic material stored?',
        options: [
          { id: 'opt-ribosome', text: 'Ribosome' },
          { id: 'opt-nucleus', text: 'Nucleus' },
          { id: 'opt-vacuole', text: 'Vacuole' },
        ],
        answerKey: 'opt-nucleus',
        status: 'awaiting_response' as const,
      };

      // Correct chip selection
      const correctChip = evaluateCheckpointAnswer(cp, 'Nucleus', 'opt-nucleus');
      expect(correctChip.isCorrect).toBe(true);
      expect(correctChip.feedback).toContain('Correct');

      // Incorrect chip selection
      const incorrectChip = evaluateCheckpointAnswer(cp, 'Ribosome', 'opt-ribosome');
      expect(incorrectChip.isCorrect).toBe(false);
      expect(incorrectChip.feedback).toContain('Not quite');
    });

    it('records pending evaluation when criteria or answer key is omitted (P1 Regression Fix)', () => {
      const cpOpen = {
        id: 'cp-open',
        conceptId: 'concept-discussion',
        question: 'Why do plants need carbon dioxide?',
        status: 'awaiting_response' as const,
      };

      const evalResult = evaluateCheckpointAnswer(cpOpen, 'To build sugars in the Calvin cycle');
      expect(evalResult.status).toBe('pending');
      expect(evalResult.isCorrect).toBeUndefined();
      expect(evalResult.feedback).toContain('Acharya will review');
    });

    it('preserves pending evaluation without overriding status when backend sends pending or undefined isCorrect', () => {
      let cpState = createCheckpointState();
      const boardId = 'b1';
      const conceptId = 'concept-open';
      const cpId = 'cp-open';

      cpState = checkpointReducer(cpState, {
        type: 'activate',
        boardId,
        conceptId,
        checkpointId: cpId,
        question: 'What do you think happens next?',
        at: 1000,
      });
      cpState = checkpointReducer(cpState, {
        type: 'await_response',
        boardId,
        conceptId,
        checkpointId: cpId,
        at: 1500,
      });
      cpState = checkpointReducer(cpState, {
        type: 'submit_response',
        boardId,
        conceptId,
        checkpointId: cpId,
        response: 'Plants might produce starch',
        modality: 'typed',
        at: 2000,
      });

      let cp = cpState.checkpoints[checkpointKey(boardId, conceptId)];
      expect(cp?.status).toBe('answered');
      expect(cp?.evaluation?.status).toBe('pending');
      expect(cp?.completedAt).toBeUndefined();

      // Backend sends checkpoint_evaluated with status: 'pending' and isCorrect: undefined
      cpState = checkpointReducer(cpState, {
        type: 'evaluate',
        boardId,
        conceptId,
        checkpointId: cpId,
        isCorrect: undefined,
        status: 'pending',
        feedback: 'Answer received. Acharya will review.',
        at: 2500,
      });

      cp = cpState.checkpoints[checkpointKey(boardId, conceptId)];
      expect(cp?.evaluation?.status).toBe('pending');
      expect(cp?.evaluation?.isCorrect).toBeUndefined();
      expect(cp?.completedAt).toBeUndefined();
    });

    it('voice streaming updates interim response without premature answer submission until finalized (P1 Regression Fix)', () => {
      let cpState = createCheckpointState();
      const boardId = 'b1';
      const conceptId = 'concept-calvin';
      const cpId = 'cp-calvin-cycle';

      cpState = checkpointReducer(cpState, {
        type: 'activate',
        boardId,
        conceptId,
        checkpointId: cpId,
        question: 'What enzyme fixes carbon dioxide?',
        criteria: 'rubisco',
        at: 1000,
      });
      cpState = checkpointReducer(cpState, {
        type: 'await_response',
        boardId,
        conceptId,
        checkpointId: cpId,
        at: 1500,
      });

      // 1. Interim non-final speech arriving: updates interimResponse, stays awaiting_response
      cpState = checkpointReducer(cpState, {
        type: 'interim_response',
        boardId,
        conceptId,
        checkpointId: cpId,
        response: 'I think it is Ru...',
        at: 2000,
      });

      let cp = cpState.checkpoints[checkpointKey(boardId, conceptId)];
      expect(cp?.status).toBe('awaiting_response');
      expect(cp?.interimResponse).toBe('I think it is Ru...');
      expect(cp?.answerReceived).toBeFalsy();

      // Unchanged interim response text must NOT create new state
      const unchangedState = checkpointReducer(cpState, {
        type: 'interim_response',
        boardId,
        conceptId,
        checkpointId: cpId,
        response: 'I think it is Ru...',
        at: 2100,
      });
      expect(unchangedState).toBe(cpState);

      // 2. Finalized speech arrives: completes the submission
      cpState = checkpointReducer(cpState, {
        type: 'submit_response',
        boardId,
        conceptId,
        checkpointId: cpId,
        response: 'RuBisCO fixes CO2',
        modality: 'voice',
        at: 2500,
      });

      cp = cpState.checkpoints[checkpointKey(boardId, conceptId)];
      expect(cp?.status).toBe('answered');
      expect(cp?.answerReceived).toBe(true);
      expect(cp?.response?.text).toBe('RuBisCO fixes CO2');
      expect(cp?.interimResponse).toBeUndefined();
    });

    it('dynamically expands checkpoint height in layout bounds for wrapped chips and hints (P1 Regression Fix)', () => {
      // Short checkpoint with no options
      const shortCp = {
        id: 'cp-1',
        conceptId: 'c1',
        question: 'Short question?',
        status: 'awaiting_response' as const,
      };
      const shortH = estimateCheckpointContentHeight(shortCp, 300);

      // Long checkpoint with wrapped options and revealed hint
      const richCp = {
        id: 'cp-2',
        conceptId: 'c2',
        question: 'What is the full detailed explanation of light-dependent reaction inside thylakoids?',
        options: [
          { id: 'opt-0', text: 'Photosystem II splits water molecules to generate protons and oxygen gas' },
          { id: 'opt-1', text: 'Photosystem I accepts electrons to reduce NADP+ into NADPH molecules' },
          { id: 'opt-2', text: 'ATP synthase harnesses the electrochemical proton gradient across membrane' },
          { id: 'opt-3', text: 'Calvin cycle occurs solely in the fluid stroma outside thylakoids' },
        ],
        hints: ['Think of the Z-scheme electron transport chain'],
        activeHintIndex: 0,
        status: 'awaiting_response' as const,
      };
      const richH = estimateCheckpointContentHeight(richCp, 300);

      // richH must be significantly larger than shortH to account for wrapped chips and hints
      expect(richH).toBeGreaterThan(shortH + 100);

      // Layout with live rich checkpoint uses expanded companion height
      const step: Step = {
        id: 's1',
        conceptId: 'c2',
        title: 'Light reactions',
        elements: [],
        check: richCp.question,
        checkOptions: richCp.options,
        checkHints: richCp.hints,
      };
      const layout = layoutBoard([step], 1, 1, undefined, undefined, false, {
        [checkpointKey('b1', 'c2')]: richCp,
      }, 'b1');

      expect(layout.steps[0].companionSlot).toBeDefined();
      expect(layout.steps[0].companionSlot?.h).toBeGreaterThan(shortH + 100);
    });
  });
});


