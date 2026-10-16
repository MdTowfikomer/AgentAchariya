import { describe, it, expect } from 'vitest';
import { findStepTarget, layoutBoard, targetText } from './layout';
import type { Step } from './types';

describe('Board layout unit tests', () => {
  it('correctly lays out an empty board', () => {
    const layout = layoutBoard([], 0, 1);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.steps).toHaveLength(0);
    expect(layout.els).toHaveLength(0);
  });

  it('lays out revealed steps with code and notes', () => {
    const steps: Step[] = [
      {
        id: 's1',
        title: 'Step 1: Introduction',
        elements: [
          {
            id: 'c1',
            kind: 'code',
            lines: ['int a = 10;', 'int b = 20;'],
            label: 'Variables',
          },
          {
            id: 'n1',
            kind: 'note',
            text: 'These store integer numbers.',
          },
        ],
      },
    ];

    const layout = layoutBoard(steps, 1, 1);
    expect(layout.steps).toHaveLength(1);
    expect(layout.els.length).toBeGreaterThanOrEqual(2);
    expect(layout.height).toBeGreaterThan(100);

    const desc = targetText(layout, 'c1#0');
    expect(desc).toBe('int a = 10;');
  });

  it('keeps a semantic illustration beside its diagram, before long annotations', () => {
    const steps: Step[] = [{
      id: 'photosynthesis',
      title: '',
      elements: [
        {
          id: 'diagram', kind: 'diagram', layout: 'hub', label: 'Chloroplast anatomy',
          nodes: [{ id: 'chloroplast', label: 'Chloroplast' }, { id: 'grana', label: 'Grana' }],
          edges: [{ from: 'chloroplast', to: 'grana' }],
        },
        {
          id: 'note', kind: 'note',
          text: 'A detailed explanation '.repeat(45),
        },
        {
          id: 'chloroplast', kind: 'illustration', svg: '<svg viewBox="0 0 200 200"/>',
          label: 'Chloroplast', role: 'Shows where light reactions happen', placement: 'side',
        },
      ],
    }];

    const layout = layoutBoard(steps, 1, 1);
    const diagram = layout.els.find((el) => el.el.id === 'diagram')!;
    const note = layout.els.find((el) => el.el.id === 'note')!;
    const illustration = layout.els.find((el) => el.el.id === 'chloroplast')!;

    expect(illustration.y).toBeLessThan(note.y + note.h);
    expect(illustration.x).toBeLessThan(note.x);
    expect(illustration.y).toBeGreaterThanOrEqual(diagram.y);
  });

  it('places a layers diagram in the visual column side-by-side with companion text instead of full width', () => {
    const steps: Step[] = [
      {
        id: 'osi',
        title: 'OSI 7-Layer Model',
        elements: [
          {
            id: 'osi-diagram',
            kind: 'diagram',
            layout: 'layers',
            label: 'OSI Stack',
            nodes: [
              { id: 'l7', label: '7. Application' },
              { id: 'l6', label: '6. Presentation' },
              { id: 'l5', label: '5. Session' },
              { id: 'l4', label: '4. Transport' },
              { id: 'l3', label: '3. Network' },
              { id: 'l2', label: '2. Data Link' },
              { id: 'l1', label: '1. Physical' },
            ],
            edges: [],
          },
          {
            id: 'osi-note',
            kind: 'note',
            text: 'Layer 7 interacts directly with software applications.',
          },
        ],
        say: 'Layer 7 interacts directly with software applications.',
      },
    ];

    const layout = layoutBoard(steps, 1, 1);
    const diagram = layout.els.find((el) => el.el.id === 'osi-diagram')!;
    const note = layout.els.find((el) => el.el.id === 'osi-note')!;

    // Diagram is constrained to left column (~48%), not blowing up to 1040px full width
    expect(diagram.w).toBeLessThanOrEqual(layout.colW * 0.52);
    // Note sits in the right companion column
    expect(note.x).toBeGreaterThan(diagram.x);
    expect(layout.steps[0].companionSlot).toBeDefined();
  });

  it('constrains media elements to visual column width and reserves companion slot when caption exists', () => {
    const steps: Step[] = [
      {
        id: 'img-step',
        title: 'Network Topology',
        elements: [
          {
            id: 'img1',
            kind: 'media',
            media: 'image',
            caption: 'Mesh network topology',
          },
        ],
      },
    ];

    const layout = layoutBoard(steps, 1, 1);
    const media = layout.els.find((el) => el.el.id === 'img1')!;

    // Media element is width-constrained, never blowing up to 1040px canvas
    expect(media.w).toBeLessThanOrEqual(520);
    // Companion slot is defined for speech / companion notes
    expect(layout.steps[0].companionSlot).toBeDefined();
    expect(layout.steps[0].companionSlot!.w).toBeGreaterThan(0);
    expect(layout.steps[0].companionSlot!.x).toBeGreaterThan(media.x);
  });

  it('strictly calculates card height into layout bounds so next step never overlaps', () => {
    const steps: Step[] = [
      {
        id: 'step1',
        title: 'Step 1: Graph Representation',
        elements: [
          {
            id: 'd1',
            kind: 'diagram',
            layout: 'flow',
            label: 'Adjacency List',
            nodes: [{ id: 'n1', label: 'Node 1' }, { id: 'n2', label: 'Node 2' }],
            edges: [{ from: 'n1', to: 'n2' }],
          },
          {
            id: 'n1',
            kind: 'note',
            text: 'An adjacency list stores neighbors for each node in a linked structure.',
          },
        ],
        say: 'We represent each vertex with a list of outgoing edges. This is memory efficient for sparse graphs and allows quick traversal.',
        check: 'Why do we prefer adjacency lists over matrices for sparse graphs?',
      },
      {
        id: 'step2',
        title: 'Step 2: Comparison',
        elements: [
          {
            id: 'd2',
            kind: 'diagram',
            layout: 'compare',
            label: 'Matrix vs List Comparison',
            nodes: [{ id: 'c1', label: 'Matrix: O(V^2)' }, { id: 'c2', label: 'List: O(V + E)' }],
            edges: [],
          },
        ],
      },
    ];

    const layout = layoutBoard(steps, 2, 1);
    const s1 = layout.steps[0];
    const s2 = layout.steps[1];

    expect(s1.companionSlot).toBeDefined();
    const card = s1.companionSlot!;
    const cardBottom = card.y + card.h;

    // The step total height must fully encompass the card
    expect(s1.y + s1.h).toBeGreaterThanOrEqual(cardBottom);
    // The next step must start strictly below the card bottom!
    expect(s2.y).toBeGreaterThan(cardBottom);
  });

  it('omits companion card when step has no explanation content', () => {
    const steps: Step[] = [
      {
        id: 'unexplained-step',
        title: '',
        elements: [
          {
            id: 'raw-img',
            kind: 'media',
            media: 'image',
          },
        ],
      },
    ];

    const layout = layoutBoard(steps, 1, 1);
    expect(layout.steps[0].companionSlot).toBeUndefined();
  });

  it('attaches stable conceptId to placed steps and placed elements', () => {
    const steps: Step[] = [
      {
        id: 'concept-bfs',
        conceptId: 'concept-bfs',
        title: 'Breadth First Search',
        elements: [
          {
            id: 'bfs-d',
            kind: 'diagram',
            nodes: [{ id: 'root', label: 'Root' }],
            edges: [],
          },
        ],
        say: 'BFS visits level by level using a queue.',
      },
    ];

    const layout = layoutBoard(steps, 1, 1);
    expect(layout.steps[0].conceptId).toBe('concept-bfs');
    expect(layout.els[0].conceptId).toBe('concept-bfs');
  });

  it('findStepTarget finds step bounds by stepId and conceptId for roadmap navigation', () => {
    const steps: Step[] = [
      {
        id: 's-intro',
        conceptId: 'concept-intro',
        title: 'Introduction',
        elements: [
          { id: 't1', kind: 'text', text: 'Welcome to OSI Model' },
        ],
      },
      {
        id: 's-l7',
        conceptId: 'concept-l7',
        title: 'Layer 7',
        elements: [
          { id: 'd7', kind: 'diagram', nodes: [{ id: 'n7', label: 'Application' }], edges: [] },
        ],
      },
    ];

    const layout = layoutBoard(steps, 2, 1);
    expect(layout.steps).toHaveLength(2);

    // 1. By step ID returns actual step bounds (not null)
    const target1 = findStepTarget(layout, 's-intro');
    expect(target1).toBeDefined();
    expect(target1).toEqual({
      x: layout.steps[0].x,
      y: layout.steps[0].y,
      w: layout.steps[0].w,
      h: layout.steps[0].h,
    });

    // 2. By concept ID returns step bounds
    const target2 = findStepTarget(layout, 'concept-l7');
    expect(target2).toBeDefined();
    expect(target2?.y).toBe(layout.steps[1].y);

    // 3. Fallback to direct element ID
    const targetEl = findStepTarget(layout, 't1');
    expect(targetEl).toBeDefined();
    expect(targetEl?.x).toBe(layout.els[0].x);

    // 4. Nonexistent returns undefined
    expect(findStepTarget(layout, 'nonexistent')).toBeUndefined();
  });

  describe('Mobile responsive single-column layout', () => {
    const sampleStep = (sayText: string): Step => ({
      id: 'step-photosynthesis',
      conceptId: 'photosynthesis',
      title: 'Photosynthesis Process',
      elements: [
        {
          id: 'diag-chloroplast',
          kind: 'diagram',
          layout: 'hub',
          label: 'Chloroplast Structure',
          nodes: [
            { id: 'chloroplast', label: 'Chloroplast' },
            { id: 'grana', label: 'Grana' },
            { id: 'stroma', label: 'Stroma' },
          ],
          edges: [
            { from: 'chloroplast', to: 'grana' },
            { from: 'chloroplast', to: 'stroma' },
          ],
        },
        {
          id: 'note-sunlight',
          kind: 'note',
          text: 'Sunlight is absorbed by chlorophyll inside the thylakoid membranes.',
        },
      ],
      say: sayText,
      check: 'What captures sunlight in plants?',
      checkOptions: [
        { id: 'opt-a', text: 'Chlorophyll' },
        { id: 'opt-b', text: 'Roots' },
      ],
      checkHints: ['Look at the green pigment inside the leaf chloroplasts.'],
    });

    const testWidths = [
      { name: 'small mobile (360px)', width: 360 },
      { name: 'standard mobile (390px)', width: 390 },
      { name: 'large mobile (430px)', width: 430 },
    ];

    testWidths.forEach(({ name, width }) => {
      it(`stacks diagram -> notes -> checkpoint sequentially on ${name} in English`, () => {
        const step = sampleStep(
          'Plants use sunlight, water, and carbon dioxide to create oxygen and energy in the form of sugar.'
        );
        const layout = layoutBoard([step], 1, 1, undefined, 'photosynthesis', false, undefined, undefined, width);

        // Layout adapts to mobile width
        expect(layout.width).toBe(width);
        const expectedColW = width - 16 * 2;
        expect(layout.colW).toBe(expectedColW);

        const diag = layout.els.find((e) => e.el.id === 'diag-chloroplast')!;
        const note = layout.els.find((e) => e.el.id === 'note-sunlight')!;
        const companion = layout.steps[0].companionSlot!;

        // Single-column: all share x = margin (16)
        expect(diag.x).toBe(16);
        expect(note.x).toBe(16);
        expect(companion.x).toBe(16);

        // Visual and companion take full colW, note wraps naturally within colW
        expect(diag.w).toBe(expectedColW);
        expect(note.w).toBeLessThanOrEqual(expectedColW);
        expect(companion.w).toBe(expectedColW);

        // Sequential order: Diagram -> Explanation Notes -> Checkpoint card
        expect(diag.y).toBeLessThan(note.y);
        expect(note.y).toBeLessThan(companion.y);

        // No overlap: element bottom <= next element top
        expect(diag.y + diag.h).toBeLessThanOrEqual(note.y);
        expect(note.y + note.h).toBeLessThanOrEqual(companion.y);
        expect(companion.y + companion.h).toBeLessThanOrEqual(layout.steps[0].y + layout.steps[0].h + 10);
      });

      it(`stacks diagram -> notes -> checkpoint on ${name} in Telugu`, () => {
        const teluguText =
          'మొక్కలు సూర్యరశ్మి, నీరు మరియు కార్బన్ డయాక్సైడ్ ఉపయోగించి గ్లూకోజ్ మరియు ఆక్సిజన్ తయారు చేస్తాయి.';
        const step = sampleStep(teluguText);
        const layout = layoutBoard([step], 1, 1, undefined, 'photosynthesis', false, undefined, undefined, width);

        expect(layout.width).toBe(width);
        const diag = layout.els.find((e) => e.el.id === 'diag-chloroplast')!;
        const note = layout.els.find((e) => e.el.id === 'note-sunlight')!;
        const companion = layout.steps[0].companionSlot!;

        expect(diag.x).toBe(16);
        expect(note.x).toBe(16);
        expect(companion.x).toBe(16);

        // Diagram -> Notes -> Checkpoint
        expect(diag.y).toBeLessThan(note.y);
        expect(note.y).toBeLessThan(companion.y);

        // Generates sufficient height for Telugu text without clipping
        expect(companion.h).toBeGreaterThan(200);
      });

      it(`stacks diagram -> notes -> checkpoint on ${name} in Hindi`, () => {
        const hindiText =
          'पौधे सूर्य के प्रकाश, पानी और कार्बन डाइऑक्साइड का उपयोग करके ऑक्सीजन और ग्लूकोज बनाते हैं।';
        const step = sampleStep(hindiText);
        const layout = layoutBoard([step], 1, 1, undefined, 'photosynthesis', false, undefined, undefined, width);

        expect(layout.width).toBe(width);
        const diag = layout.els.find((e) => e.el.id === 'diag-chloroplast')!;
        const note = layout.els.find((e) => e.el.id === 'note-sunlight')!;
        const companion = layout.steps[0].companionSlot!;

        expect(diag.x).toBe(16);
        expect(note.x).toBe(16);
        expect(companion.x).toBe(16);

        // Diagram -> Notes -> Checkpoint
        expect(diag.y).toBeLessThan(note.y);
        expect(note.y).toBeLessThan(companion.y);

        // Generates sufficient height for Hindi text without clipping
        expect(companion.h).toBeGreaterThan(200);
      });
    });

    it('preserves desktop two-column side-by-side layout when viewportWidth > 640 or omitted', () => {
      const step = sampleStep('Photosynthesis explanation');
      // When viewportWidth omitted:
      const desktopLayout1 = layoutBoard([step], 1, 1);
      expect(desktopLayout1.width).toBe(1120);
      const diag1 = desktopLayout1.els.find((e) => e.el.id === 'diag-chloroplast')!;
      const companion1 = desktopLayout1.steps[0].companionSlot!;
      // Side-by-side: companion is to the right of diagram
      expect(companion1.x).toBeGreaterThan(diag1.x);

      // When viewportWidth > 640 (e.g. 1024):
      const desktopLayout2 = layoutBoard([step], 1, 1, undefined, undefined, false, undefined, undefined, 1024);
      expect(desktopLayout2.width).toBe(1120);
      const diag2 = desktopLayout2.els.find((e) => e.el.id === 'diag-chloroplast')!;
      const companion2 = desktopLayout2.steps[0].companionSlot!;
      expect(companion2.x).toBeGreaterThan(diag2.x);
    });
  });
});

