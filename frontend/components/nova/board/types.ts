/**
 * The shared whiteboard's vocabulary. Mirrors backend/src/board.py.
 *
 * Every drawable thing has a TARGET address, used both by Nova ("highlight
 * arr1#3") and by the student's marks ("they circled code1#2"):
 *
 *   arr1        a whole element
 *   arr1#3      cell/item/line 3 (0-based)
 *   tbl1#2.1    table row 2, column 1
 *   tree1#n4    tree node n4
 */

export type Pointer = { name: string; index: number };
export type TreeNode = { id: string; label: string; parent?: string };

export type El =
  | { id: string; kind: 'text'; text: string; label?: string }
  | { id: string; kind: 'code'; lines: string[]; lang?: string; label?: string }
  | { id: string; kind: 'array'; values: string[]; pointers?: Pointer[]; label?: string }
  | {
      id: string;
      kind: 'chain';
      values: string[];
      arrows?: boolean;
      vertical?: boolean;
      label?: string;
    }
  | { id: string; kind: 'tree'; nodes: TreeNode[]; label?: string }
  | { id: string; kind: 'table'; headers?: string[]; rows: string[][]; label?: string }
  | {
      id: string;
      kind: 'diagram';
      layout?: 'flow' | 'cycle' | 'hub' | 'timeline' | 'layers' | 'compare';
      /** Semantic intent retained even when it maps to an existing layout. */
      diagramType?: 'flowchart' | 'cycle' | 'timeline' | 'concept_map' | 'anatomy' | 'comparison' | 'network' | 'layers' | 'technical_diagram' | 'graph' | 'hierarchy';
      nodes: {
        id: string;
        label: string;
        icon?: string;
        note?: string;
        color?: string;
        group?: string;
        description?: string;
        bullets?: string[];
      }[];
      edges: { from: string; to: string; label?: string }[];
      label?: string;
    }
  | { id: string; kind: 'list'; items: string[]; label?: string }
  // An SVG illustration (icon or generated drawing) placed on the board.
  | {
      id: string;
      kind: 'illustration';
      svg: string;
      label?: string;
      color?: string;
      /** Why it belongs on this board; never a spacer or decoration. */
      role?: string;
      placement?: 'side' | 'integrated' | 'below' | 'full';
      /** Part bounds use the SVG viewBox and make a composition teachable. */
      parts?: { id: string; label: string; x: number; y: number; w: number; h: number }[];
      actions?: { action: 'SHOW' | 'HIGHLIGHT' | 'LABEL' | 'CONNECT' | 'FLOW' | 'PULSE' | 'ZOOM' | 'ANIMATE'; target?: string; label?: string }[];
      /** Explanation point → independently targetable SVG component. */
      links?: { point: string; target: string }[];
    }
  // A generated infographic or clip; the bytes arrive separately (topic nova-media).
  | { id: string; kind: 'media'; media: 'image' | 'video'; caption?: string; label?: string; image_role?: 'primary' | 'explanation'; image_topic?: string }
  // Nova's improvised handwritten note, pointing back at what it explains.
  | { id: string; kind: 'note'; text: string; target?: string; label?: string };

export interface CheckpointOption {
  id: string;
  text: string;
}

export type Step = {
  id: string;
  title?: string;
  elements: El[];
  say?: string;
  check?: string;
  checkOptions?: Array<string | CheckpointOption>;
  checkHints?: string[];
  checkCriteria?: string;
  checkAnswerKey?: string;
  conceptId?: string;
};

export type Lesson = { title: string; steps: Step[] };

/** Agent -> browser, topic "nova-board". */
export type BoardOp =
  | { op: 'planning'; topic: string }
  | { op: 'lesson'; lesson: Lesson }
  | { op: 'reveal'; step: number }
  | { op: 'add'; element: El; after?: string }
  | { op: 'array'; id: string; values?: string[]; pointers?: Pointer[] }
  | { op: 'highlight'; target: string; color?: string }
  | { op: 'arrow'; from: string; to: string; label?: string }
  | { op: 'point'; target: string }
  | { op: 'unmark' }
  | { op: 'clear' }
  | { op: 'step_note'; conceptId: string; text: string; board?: string }
  | { op: 'board_new'; title?: string }
  | { op: 'board_open' }
  | { op: 'media_fail'; id: string }
  | { op: 'media_reject'; id: string; board?: string }
  | {
      op: 'checkpoint';
      conceptId?: string;
      question?: string;
      options?: Array<string | CheckpointOption>;
      hints?: string[];
      criteria?: string;
      answerKey?: string;
      board?: string;
      id?: string;
      speechId?: string;
    }
  | {
      op: 'checkpoint_active';
      conceptId?: string;
      question?: string;
      options?: Array<string | CheckpointOption>;
      hints?: string[];
      criteria?: string;
      answerKey?: string;
      board?: string;
      id?: string;
      speechId?: string;
    }
  | { op: 'checkpoint_ready'; conceptId?: string; board?: string; id?: string; speechId?: string; at?: number }
  | { op: 'checkpoint_playback_done'; conceptId?: string; board?: string; id?: string; speechId?: string; at?: number }
  | {
      op: 'checkpoint_response';
      checkpointId: string;
      conceptId?: string;
      board?: string;
      modality: 'voice' | 'typed' | 'chip';
      response: string;
      optionId?: string;
      at?: number;
    }
  | {
      op: 'checkpoint_evaluated';
      id?: string;
      checkpointId?: string;
      conceptId?: string;
      board?: string;
      isCorrect: boolean;
      feedback?: string;
      criteriaMet?: boolean;
      optionId?: string;
      at?: number;
    }
  | { op: 'checkpoint_complete'; conceptId?: string; board?: string; id?: string };

export type ImageStatusOp = {
  op: 'image_status';
  id: string;
  board: string;
  role: 'primary' | 'explanation';
  status: 'generating' | 'done' | 'failed' | 'cancelled' | 'rejected';
};

/** Browser -> agent, text stream topic "nova-board-student". */
export type StudentMark = {
  type: 'mark';
  id: string;
  /** Which board page the mark was drawn on. */
  board?: string;
  ask: boolean;
  shape: 'circle' | 'underline' | 'scribble';
  targets: { target: string; text: string }[];
  /** JPEG data URL of the marked region, so Nova sees handwriting too. */
  image?: string;
};

export type StudentCheckpointResponse = {
  type: 'checkpoint_response';
  checkpointId: string;
  conceptId?: string;
  board?: string;
  modality: 'voice' | 'typed' | 'chip';
  response: string;
  optionId?: string;
};

export type Rect = { x: number; y: number; w: number; h: number };
