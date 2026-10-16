import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Board } from '../../frontend/components/nova/board/board';
import { EMPTY, FIRST_BOOK } from '../../frontend/components/nova/board/board-state';
import { saveBoard, loadBoard } from '../../frontend/components/nova/board/archive';
import { emit, sent, media } from './livekit-fixture';
import { snapshotRegion } from '../../frontend/components/nova/board/marks';

const CHAT = 'acceptance-disposable-photosynthesis';
const steps: any[] = [
  { id: 'water', conceptId: 'water', title: 'Water uptake', say: 'WATER_NOTE_UNIQUE: Water enters through the roots and travels to the leaves.', elements: [{ id: 'water-diagram', kind: 'diagram', layout: 'flow', nodes: [{ id: 'roots', label: 'Roots' }, { id: 'stem', label: 'Stem' }, { id: 'leaves', label: 'Leaves' }], edges: [{ from: 'roots', to: 'stem', label: 'water' }, { from: 'stem', to: 'leaves', label: 'water' }] }] },
  { id: 'light', conceptId: 'light', title: 'Capturing light', say: 'LIGHT_NOTE_UNIQUE: Chlorophyll absorbs light. మొక్కలు సూర్యకాంతిని ఉపయోగిస్తాయి. पौधे सूर्य के प्रकाश का उपयोग करते हैं।', elements: [{ id: 'light-diagram', kind: 'diagram', layout: 'flow', nodes: [{ id: 'sun', label: 'Sunlight' }, { id: 'chlorophyll', label: 'Chlorophyll' }], edges: [{ from: 'sun', to: 'chlorophyll', label: 'light energy' }] }] },
  { id: 'sugar', conceptId: 'sugar', title: 'Making sugar', say: 'SUGAR_NOTE_UNIQUE: The plant uses light energy to make sugars. Explain the role of the leaf in your own words.', elements: [{ id: 'sugar-diagram', kind: 'diagram', layout: 'flow', nodes: [{ id: 'co2', label: 'Carbon dioxide' }, { id: 'sugar', label: 'Sugar' }], edges: [{ from: 'co2', to: 'sugar', label: 'carbon fixation' }] }] },
];
const book = { ...FIRST_BOOK, pages: { b1: { ...EMPTY, title: 'Photosynthesis acceptance lesson', steps, revealed: 3, stepNotes: { water: steps[0].say, light: steps[1].say, sugar: steps[2].say } } } };

function Fixture() {
  const [lines, setLines] = useState<any[]>([]);
  const [speaking, setSpeaking] = useState(false);
  (window as any).acceptance = {
    emit, sent, media,
    setVoice(text: string, final: boolean, id = 'voice-answer') { setLines([{ id, mine: true, text, final, at: Date.now() }]); },
    setTeacher(text: string) { setLines(previous => [...previous, { id: 'new-teacher-note', mine: false, text, final: true, at: Date.now() }]); },
    setSpeaking,
    async archive() { return loadBoard(CHAT); },
    async diagnoseSnapshot() {
      const svg = document.querySelector('svg.nova-board') as SVGSVGElement;
      const original = HTMLCanvasElement.prototype.toDataURL;
      const errors: string[] = [];
      HTMLCanvasElement.prototype.toDataURL = function (...args: any[]) {
        try { return original.apply(this, args as any); }
        catch (error: any) { errors.push(`${error.name}: ${error.message}`); throw error; }
      };
      try {
        const full = await snapshotRegion(svg, { x: 0, y: 0, w: 1120, h: 630 }, 1920, 1);
        const clone = svg.cloneNode(true) as SVGSVGElement;
        clone.querySelectorAll('foreignObject').forEach(e => e.remove());
        const svgOnly = await snapshotRegion(clone, { x: 0, y: 0, w: 1120, h: 630 }, 1920, 1);
        return { fullSucceeded: Boolean(full), svgOnlySucceeded: Boolean(svgOnly), errors };
      } finally { HTMLCanvasElement.prototype.toDataURL = original; }
    },
  };
  return <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden' }}>
    <main style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}><Board chatId={CHAT} restore lines={lines} isSpeaking={speaking} isListening={!speaking} roomState="connected" /></main>
    <footer data-testid="fixture-footer" style={{ flexShrink: 0, padding: '14px 24px', borderTop: '1px solid #ddd', background: '#fbfaf6' }}>Reserved footer fixture · Audio transport simulated · No live voice session</footer>
  </div>;
}

async function main() {
  if (!new URLSearchParams(location.search).has('reload')) await saveBoard(CHAT, { book, research: [] });
  createRoot(document.getElementById('root')!).render(<Fixture />);
}
void main();
