/* Real Chrome tests of production Board components. Only the LiveKit transport is stubbed. */
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const { chromium } = require(path.join(os.tmpdir(), 'acharya-acceptance-tools/node_modules/playwright'));
const esbuild = require(path.join(os.tmpdir(), 'acharya-acceptance-tools/node_modules/esbuild'));
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'artifacts/acceptance-2026-10-11');
const results = [];
let browser, server;
function check(name, condition, details = '') { results.push({ name, pass: Boolean(condition), details }); console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${details ? ': ' + details : ''}`); }
async function scenario(name, fn) { try { await fn(); } catch (e) { check(name, false, e.message); } }

async function main() {
  fs.mkdirSync(out, { recursive: true });
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, reducedMotion: 'reduce' });
  const app = await context.newPage();
  const appErrors = [];
  app.on('pageerror', e => appErrors.push(e.message));
  await app.goto('http://localhost:3002', { waitUntil: 'networkidle' });
  check('Running application loads', await app.getByRole('heading', { name: 'Agent Acharya' }).isVisible());
  const styles = await app.locator('link[rel="stylesheet"]').evaluateAll(nodes => nodes.map(n => n.href));
  const htmlClass = await app.locator('html').getAttribute('class');
  await app.screenshot({ path: path.join(out, 'app-start.png'), fullPage: true });
  await app.setViewportSize({ width: 390, height: 844 });
  await app.screenshot({ path: path.join(out, 'app-mobile.png'), fullPage: true });
  check('Application mobile page has no horizontal overflow', await app.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  check('Application has no uncaught browser errors', appErrors.length === 0, appErrors.join('; '));

  await esbuild.build({ entryPoints: [path.join(__dirname, 'fixture.tsx')], outfile: path.join(out, 'fixture.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', nodePaths: [path.join(root, 'frontend/node_modules')], tsconfig: path.join(root, 'frontend/tsconfig.json'), define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'livekit-transport-fixture', setup(build) { build.onResolve({ filter: /^@livekit\/components-react$/ }, () => ({ path: path.join(__dirname, 'livekit-fixture.ts') })); } }] });
  const html = `<!doctype html><html class="${htmlClass || ''}"><head>${styles.map(s => `<link rel="stylesheet" href="${s}">`).join('')}<style>html,body,#root{margin:0;width:100%;height:100%}body{background:#fbfaf6}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
  server = http.createServer((req, res) => { if (req.url.startsWith('/fixture.js')) { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(out, 'fixture.js'))); } else { res.setHeader('Content-Type', 'text/html'); res.end(html); } });
  await new Promise(resolve => server.listen(3417, '127.0.0.1', resolve));
  const p = await context.newPage();
  const errors = [], dialogs = [];
  p.on('pageerror', e => { errors.push(e.message); console.log('BROWSER ERROR', e.message); });
  p.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
  await p.goto('http://127.0.0.1:3417', { waitUntil: 'networkidle' });
  await p.getByRole('navigation', { name: 'Lesson concepts' }).waitFor();
  // Wait for the production WriteIn animation before taking visual evidence.
  await p.waitForFunction(() => Array.from(document.querySelectorAll('clipPath[id^="wr-"] rect')).every(e => e.getBBox().width > 30), null, { timeout: 8000 });
  await p.locator('[title="Jump to Making sugar"]').click();
  await p.screenshot({ path: path.join(out, 'board-desktop.png'), fullPage: true });
  check('Archived notes restored in browser', await p.getByText(/WATER_NOTE_UNIQUE/).count() > 0 && await p.getByText(/LIGHT_NOTE_UNIQUE/).count() > 0);
  check('No generic empty explanation placeholders', !(await p.locator('body').innerText()).includes('Whiteboard notes'));
  const canvas = p.locator('svg.nova-board');
  const scroller = p.locator('div.overflow-y-auto').first();
  await p.locator('[title="Jump to Water uptake"]').click();
  const firstTop = await scroller.evaluate(e => e.scrollTop);
  await p.locator('[title="Jump to Making sugar"]').click();
  const lastTop = await scroller.evaluate(e => e.scrollTop);
  check('Roadmap navigation scrolls to selected concept', lastTop > firstTop + 50, `${firstTop} -> ${lastTop}`);

  const cp = { op: 'checkpoint', board: 'b1', conceptId: 'sugar', id: 'cp-sugar', speechId: 'speech-sugar', question: 'Which pigment absorbs light?', options: [{ id: 'roots', text: 'Roots' }, { id: 'chlorophyll', text: 'Chlorophyll' }], hints: ['Look for the green pigment in the leaves.', 'The pigment captures light energy for photosynthesis.'], answerKey: 'chlorophyll' };
  async function emit(op) { await p.evaluate(op => window.acceptance.emit(op), op); }
  await emit(cp);
  await emit({ op: 'checkpoint_ready', board: 'b1', conceptId: 'sugar', id: cp.id, speechId: cp.speechId });
  await p.getByRole('button', { name: 'Roots', exact: true }).waitFor();
  const inkBefore = await canvas.locator('path').count();
  await scenario('Chip submission', async () => {
    await p.getByRole('button', { name: 'Roots', exact: true }).click();
    check('Wrong chip gets incorrect result', (await p.locator('body').innerText()).includes('Try Again'));
    const packet = await p.evaluate(() => window.acceptance.sent.filter(m => m.type === 'checkpoint_response').at(-1));
    check('Chip sends checkpoint and stable option IDs', packet?.checkpointId === cp.id && packet?.optionId === 'roots', JSON.stringify(packet));
    check('Clicking chip does not draw on canvas', await canvas.locator('path').count() === inkBefore);
  });
  await scenario('Hints and retry', async () => {
    await p.screenshot({ path: path.join(out, 'checkpoint-wrong-answer.png'), fullPage: true });
    await p.getByRole('button', { name: /Hint/ }).click({ timeout: 4000 });
    await p.getByText('Look for the green pigment in the leaves.').waitFor({ timeout: 4000 });
    check('Hint appears for incorrect answer', true);
    await p.getByRole('button', { name: /Retry/ }).click();
    check('Hint remains available after retry', await p.getByRole('button', { name: /Hint/ }).count() > 0);
    await p.screenshot({ path: path.join(out, 'checkpoint-hint.png'), fullPage: true });
  });
  await scenario('Typed answer', async () => {
    const input = p.getByPlaceholder('Type an answer or speak...');
    await input.fill('Chlorophyll');
    await input.press('Enter');
    const packet = await p.evaluate(() => window.acceptance.sent.filter(m => m.type === 'checkpoint_response').at(-1));
    check('Typed answer reaches transport', packet?.modality === 'typed' && packet?.response === 'Chlorophyll', JSON.stringify(packet));
    await emit({ op: 'checkpoint_evaluated', board: 'b1', conceptId: 'sugar', checkpointId: cp.id, isCorrect: true, status: 'evaluated', feedback: 'Chlorophyll absorbs light.' });
    check('Backend feedback is displayed', (await p.locator('body').innerText()).includes('Chlorophyll absorbs light.'));
  });
  await scenario('Voice transcription finality', async () => {
    await emit({ ...cp, id: 'cp-voice', speechId: 'speech-voice' });
    await emit({ op: 'checkpoint_ready', board: 'b1', conceptId: 'sugar', id: 'cp-voice', speechId: 'speech-voice' });
    const before = await p.evaluate(() => window.acceptance.sent.filter(m => m.type === 'checkpoint_response').length);
    await p.evaluate(() => window.acceptance.setVoice('Chloro', false));
    await p.getByPlaceholder('Type an answer or speak...').waitFor();
    const interim = await p.evaluate(() => window.acceptance.sent.filter(m => m.type === 'checkpoint_response').length);
    check('Interim speech is not submitted', before === interim);
    await p.evaluate(() => window.acceptance.setVoice('Chlorophyll', true));
    await p.waitForFunction(() => window.acceptance.sent.some(m => m.checkpointId === 'cp-voice' && m.modality === 'voice'));
    check('Final speech submitted once', await p.evaluate(() => window.acceptance.sent.filter(m => m.checkpointId === 'cp-voice' && m.modality === 'voice').length) === 1);
  });
  await scenario('PDF export', async () => {
    const downloadOrDialog = Promise.race([p.waitForEvent('download', { timeout: 12000 }).then(d => ({ download: d })), p.waitForEvent('dialog', { timeout: 12000 }).then(d => ({ error: d.message() }))]);
    await p.getByRole('button', { name: 'Export board as presentation slides (PDF)' }).click();
    const result = await downloadOrDialog;
    if (result.download) { await result.download.saveAs(path.join(out, 'lesson-slides.pdf')); check('Production PDF export downloads', true); }
    else check('Production PDF export downloads', false, result.error);
  });
  const snapshotDiagnostic = await p.evaluate(() => window.acceptance.diagnoseSnapshot());
  fs.writeFileSync(path.join(out, 'snapshot-diagnostic.json'), JSON.stringify(snapshotDiagnostic, null, 2));
  console.log('SNAPSHOT DIAGNOSTIC', JSON.stringify(snapshotDiagnostic));
  await p.setViewportSize({ width: 390, height: 844 });
  await p.locator('[title="Jump to Making sugar"]').click();
  await p.screenshot({ path: path.join(out, 'board-mobile.png'), fullPage: true });
  check('Mobile document has no horizontal overflow', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const boardBounds = await p.locator('main').boundingBox(), footerBounds = await p.locator('footer').boundingBox();
  check('Reserved footer does not cover board viewport', boardBounds.y + boardBounds.height <= footerBounds.y + 1);
  await scenario('Media rejection in production component', async () => {
    await emit({ op: 'add', board: 'b1', after: 'sugar-diagram', element: { id: 'acceptance-image', kind: 'media', media: 'image', image_role: 'primary', caption: 'Supplementary leaf illustration' } });
    await p.evaluate(() => window.acceptance.media('acceptance-image'));
    const reject = p.getByText('Hide Unreadable');
    await reject.waitFor({ timeout: 4000 });
    await reject.click();
    const rejectedWithPen = await p.evaluate(() => window.acceptance.sent.some(m => m.type === 'media_rejected' && m.id === 'acceptance-image'));
    check('Image rejection works with default pen tool', rejectedWithPen);
    if (!rejectedWithPen) {
      await p.getByRole('button', { name: 'Scroll the board' }).click();
      await p.getByRole('button', { name: 'Erase my marks' }).click();
      await reject.click({ timeout: 4000 });
    }
    await p.getByText(/Illustration hidden by student/).first().waitFor({ timeout: 4000 });
    check('Image rejection hides media with hand tool', true);
    check('Rejection reports owning concept', await p.evaluate(() => window.acceptance.sent.some(m => m.type === 'media_rejected' && m.id === 'acceptance-image' && m.conceptId === 'sugar')));
  });
  await p.evaluate(() => window.acceptance.setTeacher('REOPENED_NOTE_UNIQUE: This explanation was saved during the browser run.'));
  await p.getByText(/REOPENED_NOTE_UNIQUE/).first().waitFor({ timeout: 4000 });
  await p.waitForFunction(async () => (await window.acceptance.archive())?.book?.pages?.b1?.stepNotes?.sugar?.includes('REOPENED_NOTE_UNIQUE'));
  fs.writeFileSync(path.join(out, 'archive-before-reopen.json'), JSON.stringify(await p.evaluate(() => window.acceptance.archive()), null, 2));
  // Reload with preserved IndexedDB, bypass fixture initialization.
  await p.goto('http://127.0.0.1:3417/?reload=1', { waitUntil: 'networkidle' });
  fs.writeFileSync(path.join(out, 'reopened-body.txt'), await p.locator('body').innerText());
  await scenario('Newly saved notes survive reload', async () => {
    await p.getByText(/REOPENED_NOTE_UNIQUE/).first().waitFor({ timeout: 4000 });
    check('Newly saved notes survive reload', true);
  });
  check('Image rejection survives archive reload', await p.getByText(/Illustration hidden by student/).count() > 0);
  await p.screenshot({ path: path.join(out, 'board-reopened.png'), fullPage: true });
  fs.writeFileSync(path.join(out, 'reopened-archive.json'), JSON.stringify(await p.evaluate(() => window.acceptance.archive()), null, 2));
  check('Fixture browser has no uncaught errors', errors.length === 0, errors.join('; '));
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ scope: 'Production components in real Chrome; LiveKit transport stubbed. Actual app landing page also checked. No microphone/LLM assessment.', results, errors, dialogs }, null, 2));
}
main().catch(e => { check('Acceptance runner', false, e.stack); fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ results }, null, 2)); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); if (server) server.close(); });
