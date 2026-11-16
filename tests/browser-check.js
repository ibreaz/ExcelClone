/* Uses the page in a real headless Chromium through Playwright (test-only tool) and saves a screenshot. See README. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PAGE_URL = 'file://' + path.join(__dirname, '..', 'index.html');
const OUT = path.join(__dirname, 'out');
const PDF = path.join(OUT, 'demo.pdf');
const PIXEL_TOLERANCE = 2;

const cell = (ref) => `td[data-col="${ref.charCodeAt(0) - 65}"][data-row="${Number(ref.slice(1)) - 1}"]`;

async function enter(page, ref, lines) {
  await page.click(cell(ref));
  for (const line of lines) {
    await page.keyboard.type(line);
    await page.keyboard.press('Enter');
  }
}

async function centreOf(locator) {
  const box = await locator.boundingBox();
  return [box.x + box.width / 2, box.y + box.height / 2];
}

const centre = (page, ref) => centreOf(page.locator(cell(ref)));

const RESIZER_C = '.resizer[data-col="2"]';
const widthOf = async (page, ref) => (await page.locator(cell(ref)).boundingBox()).width;

const openMenu = (page, title) => page.click(`.menu-title:text-is("${title}")`);

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
    await openMenu(page, 'Format');
    await page.selectOption('#number-format', 'eur');
    await openMenu(page, 'Format');
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
    const [x, y] = await centreOf(page.locator(RESIZER_C));
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
    const textFitsCell = () => page.locator(cell('C1')).evaluate((td) => (td.querySelector('span') ?? td).getBoundingClientRect().width <= td.clientWidth);
    assert.ok(await textFitsCell(), 'the label is wider than its column');
    assert.ok(await widthOf(page, 'C1') < 300, 'the column is much wider than its content');
    await page.reload();
    assert.ok(await textFitsCell(), 'the width was lost on reload');
  },
};

const pageCount = (pdfFile) => (fs.readFileSync(pdfFile, 'latin1').match(/\/Type\s*\/Page\b(?!s)/g) || []).length;
const tabNames = (page) => page.$$eval('#tab-list button', (tabs) => tabs.map((tab) => tab.textContent));
const cssOf = (page, ref, property) => page.locator(cell(ref)).evaluate((td, name) => getComputedStyle(td)[name], property);

async function dragFillHandleTo(page, ref) {
  await page.mouse.move(...await centreOf(page.locator('#fill-handle')));
  await page.mouse.down();
  await page.mouse.move(...await centre(page, ref), { steps: 6 });
  await page.mouse.up();
}

// Checks on the demo workbook, which a first start shows.
const demoTests = {
  'a first start shows the demo workbook': async (page) => {
    assert.deepStrictEqual(await tabNames(page), ['Features', 'Summary 2026', 'Limits']);
    assert.strictEqual(await page.textContent(cell('D9')), '1,907.25 €');
  },
  'long text runs over its neighbours with no grid lines under it; a number too wide shows ####': async (page) => {
    const title = page.locator(cell('A1'));
    assert.ok(await title.evaluate((td) => td.querySelector('.spill').getBoundingClientRect().width > td.getBoundingClientRect().width));
    assert.strictEqual(await cssOf(page, 'A1', 'borderRightColor'), 'rgba(0, 0, 0, 0)');
    assert.ok(await page.locator('td', { hasText: /^####$/ }).count() >= 1, 'no #### cell');
  },
  'negative amounts are red and the balance has a line above it': async (page) => {
    assert.strictEqual(await cssOf(page, 'D5', 'color'), 'rgb(192, 0, 0)');
    assert.notStrictEqual(await cssOf(page, 'D4', 'color'), 'rgb(192, 0, 0)');
    assert.strictEqual(await cssOf(page, 'D9', 'borderTopStyle'), 'solid');
  },
  'the other sheets open from their tabs and read from the first one': async (page) => {
    await page.click('#tab-list button:text-is("Summary 2026")');
    assert.strictEqual(await page.textContent(cell('B3')), '1,907.25 €');
    await page.click('#tab-list button:text-is("Features")');
  },
  'printing: several pages, no menus or headers, and the screen is back to normal afterwards': async (page) => {
    await page.pdf({ path: PDF, format: 'A4' });
    assert.ok(pageCount(PDF) >= 2, `pages: ${pageCount(PDF)}`);
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    const [date, description, lastUsed] = await Promise.all(['A4', 'B4', 'D4'].map((ref) => page.locator(cell(ref)).boundingBox()));
    assert.ok(date.x < PIXEL_TOLERANCE && date.width > 100, `column A is not at the left edge: ${JSON.stringify(date)}`);
    assert.ok(Math.abs(description.x - (date.x + date.width)) <= PIXEL_TOLERANCE, 'column B does not follow column A');
    assert.ok(lastUsed.width > 50, 'the last used column is not printed');
    assert.strictEqual(await page.locator('.menubar').isVisible(), false);
    assert.strictEqual(await page.locator('thead .letters').isVisible(), false);
    assert.strictEqual(await page.locator(cell('E4')).isVisible(), false);
    await page.screenshot({ path: path.join(OUT, 'print.png') });
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await page.emulateMedia({ media: null });
    assert.strictEqual(await page.locator('.unprinted').count(), 0);
    assert.strictEqual(await page.locator(cell('A1')).evaluate((td) => td.closest('tbody') !== null), true);
  },
};

Object.assign(tests, {
  'text and fill colour are chosen in the Format menu, which then closes': async (page) => {
    await page.click(cell('A2'));
    await openMenu(page, 'Format');
    await page.fill('#text-color', '#ff0000');
    assert.strictEqual(await cssOf(page, 'A2', 'color'), 'rgb(255, 0, 0)');
    assert.strictEqual(await page.locator('.menu.open').count(), 0);
    await openMenu(page, 'Format');
    await page.fill('#fill-color', '#ffff00');
    assert.strictEqual(await cssOf(page, 'A2', 'backgroundColor'), 'rgb(255, 255, 0)');
  },
  'the colour boxes of the Format menu show the colours of the active cell': async (page) => {
    await page.click(cell('A2'));
    assert.deepStrictEqual([await page.inputValue('#text-color'), await page.inputValue('#fill-color')], ['#ff0000', '#ffff00']);
    await page.click(cell('F9'));
    assert.deepStrictEqual([await page.inputValue('#text-color'), await page.inputValue('#fill-color')], ['#000000', '#ffffff']);
  },
  'one colour choice is one undo step, even when the picker reports many colours on the way': async (page) => {
    await page.click(cell('F9'));
    await page.keyboard.type('x');
    await page.keyboard.press('Enter');
    await page.click(cell('F9'));
    await page.locator('#text-color').evaluate((input) => {
      for (const colour of ['#110000', '#220000', '#330000']) {
        input.value = colour;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    assert.strictEqual(await cssOf(page, 'F9', 'color'), 'rgb(51, 0, 0)');
    await page.keyboard.press('Control+Z');
    assert.strictEqual(await cssOf(page, 'F9', 'color'), 'rgb(34, 34, 34)');
    assert.strictEqual(await page.textContent(cell('F9')), 'x');
  },
  'a menu opens under its title, and hovering the next title switches to it': async (page) => {
    await openMenu(page, 'Edit');
    const title = await page.locator('.menu.open .menu-title').boundingBox();
    const items = await page.locator('.menu.open .menu-items').boundingBox();
    assert.ok(Math.abs(items.y - (title.y + title.height)) <= PIXEL_TOLERANCE && items.height > 100, JSON.stringify(items));
    await page.hover('.menu-title:text-is("Sheet")');
    assert.strictEqual(await page.textContent('.menu.open .menu-title'), 'Sheet');
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.locator('.menu.open').count(), 0);
  },
  'dragging the fill handle continues 1, 2 downwards and upwards': async (page) => {
    await enter(page, 'H4', ['1', '2']);
    await page.click(cell('H4'));
    await page.keyboard.press('Shift+ArrowDown');
    await dragFillHandleTo(page, 'H8');
    await dragFillHandleTo(page, 'H2');
    const shown = await Promise.all(['H2', 'H3', 'H6', 'H7', 'H8'].map((ref) => page.textContent(cell(ref))));
    assert.deepStrictEqual(shown, ['-1', '0', '3', '4', '5']);
  },
  'Edit > Insert rows above pushes a total down and it still adds up': async (page) => {
    const before = await page.textContent(cell('A4'));
    await page.click('tbody th:text-is("3")');
    assert.strictEqual(await page.locator('td.sel').count(), 26);
    await openMenu(page, 'Edit');
    await page.click('#insert-row');
    assert.strictEqual(await page.textContent(cell('A5')), before);
    await page.keyboard.press('Control+Z');
  },
  'a new sheet reads from the first one; renaming the first one keeps the formula working': async (page) => {
    await page.click('#add-sheet');
    await page.keyboard.type('=Sheet1!A4');
    await page.keyboard.press('Enter');
    const total = await page.textContent(cell('A1'));
    assert.strictEqual(total, '1250.5');
    await page.click('#tab-list button:text-is("Sheet1")');
    nextAnswer = 'Year 2026';
    await openMenu(page, 'Sheet');
    await page.click('#rename-sheet');
    await page.click('#tab-list button:text-is("Sheet2")');
    await page.click(cell('A1'));
    assert.strictEqual(await page.inputValue('#formula-bar'), "='Year 2026'!A4");
    assert.strictEqual(await page.textContent(cell('A1')), total);
    await page.click('#tab-list button:text-is("Year 2026")');
  },
  'a page break shows as a dashed line and the print settings stick to the sheet': async (page) => {
    await page.click(cell('A3'));
    await openMenu(page, 'Print');
    await page.click('#page-break');
    assert.strictEqual(await cssOf(page, 'B3', 'borderTopStyle'), 'dashed');
    await openMenu(page, 'Print');
    await page.check('#repeat-header');
    await page.reload();
    assert.strictEqual(await cssOf(page, 'B3', 'borderTopStyle'), 'dashed');
    assert.strictEqual(await page.isChecked('#repeat-header'), true);
  },
});

let nextAnswer; // what the next prompt of the page is answered with

async function runAll(page, group) {
  let failed = 0;
  for (const [name, test] of Object.entries(group)) {
    try { await test(page); console.log('ok   ' + name); } catch (error) { failed++; console.log('FAIL ' + name + '\n     ' + error.message.split('\n')[0]); }
  }
  return failed;
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1300, height: 700 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept(nextAnswer));
  await page.goto(PAGE_URL);
  let failed = await runAll(page, demoTests);
  await page.screenshot({ path: path.join(OUT, 'demo.png') });
  await openMenu(page, 'Format');
  await page.screenshot({ path: path.join(OUT, 'menu.png') });
  await page.keyboard.press('Escape');
  await openMenu(page, 'File');
  await page.click('#new-sheet');
  failed += await runAll(page, tests);
  await page.screenshot({ path: path.join(OUT, 'sheet.png') });
  await browser.close();
  if (pageErrors.length) console.log('PAGE ERRORS: ' + pageErrors.join(' | '));
  process.exit(failed || pageErrors.length ? 1 : 0);
})();
