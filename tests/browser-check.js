/* Uses the page in a real headless Chromium through Playwright (test-only tool) and saves a screenshot. See README. */
'use strict';
const assert = require('assert');
const path = require('path');
const { chromium } = require('playwright');

const PAGE_URL = 'file://' + path.join(__dirname, '..', 'index.html');
const SCREENSHOT = path.join(__dirname, 'out', 'sheet.png');
const PIXEL_TOLERANCE = 2;

const cell = (ref) => `td[data-col="${ref.charCodeAt(0) - 65}"][data-row="${Number(ref.slice(1)) - 1}"]`;

async function enter(page, ref, lines) {
  await page.click(cell(ref));
  for (const line of lines) {
    await page.keyboard.type(line);
    await page.keyboard.press('Enter');
  }
}

async function centre(page, ref) {
  const box = await page.locator(cell(ref)).boundingBox();
  return [box.x + box.width / 2, box.y + box.height / 2];
}

const RESIZER_C = '.resizer[data-col="2"]';
const widthOf = async (page, ref) => (await page.locator(cell(ref)).boundingBox()).width;

const tests = {
  'typing in a cell starts editing with the first key, and Enter moves down': async (page) => {
    await enter(page, 'A1', ['Income', '1000', '250.5', '=SUM(A2:A3)']);
    assert.strictEqual(await page.textContent(cell('A4')), '1250.5');
    assert.strictEqual(await page.inputValue('#name-box'), 'A5');
  },
  'the in-cell editor sits exactly on the cell': async (page) => {
    await page.dblclick(cell('C6'));
    const expected = await page.locator(cell('C6')).boundingBox();
    const actual = await page.locator('#editor').boundingBox();
    await page.keyboard.press('Escape');
    for (const side of ['x', 'y', 'height']) {
      assert.ok(Math.abs(expected[side] - actual[side]) <= PIXEL_TOLERANCE, `${side}: cell ${expected[side]}, editor ${actual[side]}`);
    }
  },
  'dragging the mouse selects a block and the status bar totals it': async (page) => {
    await page.mouse.move(...await centre(page, 'A2'));
    await page.mouse.down();
    await page.mouse.move(...await centre(page, 'B4'), { steps: 5 });
    await page.mouse.up();
    assert.strictEqual(await page.locator('td.sel').count(), 6);
    assert.match(await page.textContent('#status'), /Sum: 2,501\.00/);
  },
  'toolbar formatting applies to the selection': async (page) => {
    await page.selectOption('#number-format', 'eur');
    await page.click('[data-toggle="bold"]');
    assert.strictEqual(await page.textContent(cell('A4')), '1,250.50 €');
    assert.strictEqual(await page.locator(cell('A4')).evaluate((td) => getComputedStyle(td).fontWeight), '700');
  },
  'Ctrl+C and Ctrl+V copy a formula to the next column with moved references': async (page) => {
    await enter(page, 'B2', ['40', '2']);
    await page.click(cell('A4'));
    await page.keyboard.press('Control+C');
    await page.click(cell('B4'));
    await page.keyboard.press('Control+V');
    assert.strictEqual(await page.inputValue('#formula-bar'), '=SUM(B2:B3)');
    assert.strictEqual(await page.textContent(cell('B4')), '42.00 €');
  },
  'Ctrl+Z takes the paste back': async (page) => {
    await page.keyboard.press('Control+Z');
    assert.strictEqual(await page.textContent(cell('B4')), '');
    await page.keyboard.press('Control+Y');
  },
  'the sheet is still there after a reload': async (page) => {
    await page.reload();
    assert.strictEqual(await page.textContent(cell('A4')), '1,250.50 €');
  },
  'far cells scroll into view clear of the sticky headers': async (page) => {
    await page.click(cell('A4'));
    for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowDown');
    for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowUp');
    const active = await page.locator('td.active').boundingBox();
    const header = await page.locator('thead th').first().boundingBox();
    assert.ok(active.y >= header.y + header.height - PIXEL_TOLERANCE, `cell top ${active.y} is under the header`);
  },
  'dragging a column border resizes the column, and undo puts it back': async (page) => {
    const before = await widthOf(page, 'C1');
    const [x, y] = await (async () => { const b = await page.locator(RESIZER_C).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; })();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 80, y, { steps: 4 });
    await page.mouse.up();
    assert.strictEqual(await widthOf(page, 'C1'), before + 80);
    assert.strictEqual(await widthOf(page, 'B1'), before);
    await page.click(cell('A1'));
    await page.keyboard.press('Control+Z');
    assert.strictEqual(await widthOf(page, 'C1'), before);
  },
  'double-clicking a column border fits the column to its longest content': async (page) => {
    await enter(page, 'C1', ['A long label that does not fit', 'short']);
    await page.dblclick(RESIZER_C);
    const c1 = page.locator(cell('C1'));
    assert.ok(await c1.evaluate((td) => td.scrollWidth <= td.clientWidth), 'the label is still cut');
    assert.ok(await widthOf(page, 'C1') < 300, 'the column is much wider than its content');
    await page.reload();
    assert.ok(await c1.evaluate((td) => td.scrollWidth <= td.clientWidth), 'the width was lost on reload');
  },
};

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1100, height: 520 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(PAGE_URL);
  let failed = 0;
  for (const [name, test] of Object.entries(tests)) {
    try { await test(page); console.log('ok   ' + name); } catch (error) { failed++; console.log('FAIL ' + name + '\n     ' + error.message.split('\n')[0]); }
  }
  await page.click(cell('B2'));
  await page.screenshot({ path: SCREENSHOT });
  await browser.close();
  if (pageErrors.length) console.log('PAGE ERRORS: ' + pageErrors.join(' | '));
  process.exit(failed || pageErrors.length ? 1 : 0);
})();
