/* Drives the real page in jsdom (test-only dependency, not shipped): NODE_PATH=<dir with jsdom>/node_modules node tests/ui-smoke.js */
'use strict';
const assert = require('assert');
const path = require('path');
const { JSDOM } = require('jsdom');

const CHARACTER_WIDTH = 7;
const CELL_PADDING = 8;

/** jsdom has no layout, so text is taken to be 7px per character and a cell as wide as its column. */
function pretendLayout(window) {
  const measure = (property, width) => Object.defineProperty(window.HTMLElement.prototype, property, { get: width, configurable: true });
  const textWidth = (element) => element.textContent.length * CHARACTER_WIDTH;
  measure('offsetWidth', function () { return textWidth(this); });
  measure('scrollWidth', function () { return textWidth(this) + CELL_PADDING; });
  measure('clientWidth', function () {
    const column = this.closest('table')?.querySelectorAll('col')[this.cellIndex];
    return column ? parseInt(column.style.width, 10) : 0;
  });
}

async function openPage() {
  const dom = await JSDOM.fromFile(path.join(__dirname, '..', 'index.html'), {
    runScripts: 'dangerously',
    resources: 'usable',
    beforeParse(window) {
      window.Element.prototype.scrollIntoView = () => {};
      pretendLayout(window);
    },
  });
  await new Promise((resolve) => dom.window.addEventListener('load', resolve));
  return dom.window;
}

function driver(window) {
  const { document } = window;
  const grid = document.getElementById('grid');
  const editor = document.getElementById('editor');
  const key = (target, name, extra = {}) =>
    target.dispatchEvent(new window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...extra }));
  const alerts = [];
  window.alert = (message) => alerts.push(message);
  const clipboard = { text: '', setData(type, text) { this.text = text; }, getData() { return this.text; } };
  const clip = (type) => {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    event.clipboardData = clipboard;
    document.dispatchEvent(event);
  };
  return {
    cell: (ref) => document.querySelector(`td[data-col="${ref.charCodeAt(0) - 65}"][data-row="${Number(ref.slice(1)) - 1}"]`),
    press: (name, extra) => key(grid, name, extra),
    /** Types into the active cell and confirms with Enter, which moves one cell down. */
    type(text) {
      this.typeThen(text, 'Enter');
    },
    /** Types over the active cell and then presses the given key in the editor. */
    typeThen(text, finalKey) {
      key(grid, text[0]);
      editor.value = text;
      key(editor, finalKey);
    },
    /** Opens the active cell with F2, changes its text and presses the given key in the editor. */
    correctThen(text, finalKey) {
      key(grid, 'F2');
      editor.value = text;
      key(editor, finalKey);
    },
    click(ref, extra = {}) {
      this.cell(ref).dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, ...extra }));
      document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
    },
    clickHeader(selector, extra = {}) {
      document.querySelector(selector).dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, ...extra }));
      document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
    },
    /** Drags the fill handle of the selection to the given cell. */
    fillTo(ref) {
      document.getElementById('fill-handle').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      this.cell(ref).dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
      document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
    },
    /** Hands a file to the Open button and waits until it is read. */
    async open(fileName, text) {
      const input = document.getElementById('file-input');
      Object.defineProperty(input, 'files', { value: [new window.File([text], fileName)], configurable: true });
      input.dispatchEvent(new window.Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    },
    tabs: () => [...document.querySelectorAll('#tab-list button')].map((tab) => tab.textContent + (tab.classList.contains('on') ? '*' : '')),
    showSheet: (name) => [...document.querySelectorAll('#tab-list button')].find((tab) => tab.textContent === name).click(),
    /** Answers the next question the page asks (prompt or confirm). */
    answer(reply) {
      window.prompt = () => reply;
      window.confirm = () => reply;
    },
    lastAlert: () => alerts[alerts.length - 1],
    printing(isPrinting) {
      window.dispatchEvent(new window.Event(isPrinting ? 'beforeprint' : 'afterprint'));
    },
    check(id, isOn) {
      const box = document.getElementById(id);
      box.checked = isOn;
      box.dispatchEvent(new window.Event('change', { bubbles: true }));
    },
    menu: (title) => [...document.querySelectorAll('.menu-title')].find((button) => button.textContent === title).click(),
    openMenus: () => [...document.querySelectorAll('.menu.open .menu-title')].map((button) => button.textContent),
    toggle: (property) => document.querySelector(`[data-toggle="${property}"]`).click(),
    unprinted: () => document.querySelectorAll('.unprinted').length,
    button: (id) => document.getElementById(id).click(),
    selected: () => document.querySelectorAll('td.sel').length,
    copy: () => clip('copy'),
    paste: () => clip('paste'),
    choose(id, value) {
      const control = document.getElementById(id);
      control.value = value;
      control.dispatchEvent(new window.Event('change', { bubbles: true }));
    },
    text: (id) => document.getElementById(id).textContent,
    value: (id) => document.getElementById(id).value,
  };
}

const tests = {
  'a first start shows the demo workbook; File > New workbook empties it': (ui) => {
    assert.deepStrictEqual(ui.tabs(), ['Features*', 'Summary 2026', 'Limits']);
    assert.strictEqual(ui.cell('D9').textContent, '1,907.25 €');
    ui.answer(true);
    ui.button('new-sheet');
    assert.deepStrictEqual(ui.tabs(), ['Sheet1*']);
    assert.strictEqual(ui.cell('D9').textContent, '');
  },
  'a menu opens from its title and closes after a choice, a click elsewhere or another title': (ui) => {
    const open = () => ui.openMenus().join();
    ui.menu('Format');
    assert.strictEqual(open(), 'Format');
    ui.menu('Print');
    assert.strictEqual(open(), 'Print');
    ui.click('A1');
    assert.strictEqual(open(), '');
    ui.menu('Format');
    ui.toggle('bold');
    assert.strictEqual(open(), '');
    assert.strictEqual(ui.cell('A1').style.fontWeight, 'bold');
    ui.menu('Format');
    ui.choose('border', 'none');
    assert.strictEqual(open(), '');
    ui.toggle('bold');
  },
  'typed numbers and a formula show their result, and the formula bar shows the formula': (ui) => {
    ui.type('1000');
    ui.type('250.5');
    ui.type('=SUM(A1:A2)');
    assert.strictEqual(ui.cell('A3').textContent, '1250.5');
    ui.click('A3');
    assert.strictEqual(ui.value('formula-bar'), '=SUM(A1:A2)');
    assert.strictEqual(ui.value('name-box'), 'A3');
  },
  'selecting several numbers shows their sum in the status bar': (ui) => {
    ui.click('A1');
    ui.click('A2', { shiftKey: true });
    assert.match(ui.text('status'), /Sum: 1,250\.50.*Count: 2/);
  },
  'a currency format and bold change how the cell looks, not its value': (ui) => {
    ui.click('A3');
    ui.choose('number-format', 'eur');
    ui.press('b', { ctrlKey: true });
    assert.strictEqual(ui.cell('A3').textContent, '1,250.50 €');
    assert.strictEqual(ui.cell('A3').style.fontWeight, 'bold');
    assert.strictEqual(ui.value('formula-bar'), '=SUM(A1:A2)');
  },
  'a copied formula is pasted with moved references and its formatting': (ui) => {
    ui.click('B1');
    ui.type('1');
    ui.click('A3');
    ui.copy();
    ui.click('B3');
    ui.paste();
    assert.strictEqual(ui.value('formula-bar'), '=SUM(B1:B2)');
    assert.strictEqual(ui.cell('B3').textContent, '1.00 €');
    assert.strictEqual(ui.cell('B3').style.fontWeight, 'bold');
  },
  'undo takes back the last change and redo restores it': (ui) => {
    ui.press('z', { ctrlKey: true });
    assert.strictEqual(ui.cell('B3').textContent, '');
    ui.press('y', { ctrlKey: true });
    assert.strictEqual(ui.cell('B3').textContent, '1.00 €');
  },
  'Delete empties the selected cells and dependent formulas follow': (ui) => {
    ui.click('A1');
    ui.press('Delete');
    assert.strictEqual(ui.cell('A3').textContent, '250.50 €');
  },
  'after typing, an arrow key saves the cell and moves that way': (ui) => {
    ui.click('E5');
    ui.typeThen('7', 'ArrowRight');
    assert.strictEqual(ui.cell('E5').textContent, '7');
    assert.strictEqual(ui.value('name-box'), 'F5');
    ui.typeThen('8', 'ArrowUp');
    assert.strictEqual(ui.cell('F5').textContent, '8');
    assert.strictEqual(ui.value('name-box'), 'F4');
  },
  'after F2, left and right stay in the cell for corrections, up and down save and move': (ui) => {
    ui.click('E5');
    ui.correctThen('70', 'ArrowLeft');
    assert.strictEqual(ui.cell('E5').textContent, '7');
    assert.strictEqual(ui.value('name-box'), 'E5');
    ui.typeThen('', 'ArrowDown');
    assert.strictEqual(ui.value('name-box'), 'E6');
    ui.click('E5');
    ui.press('Delete');
    ui.click('F5');
    ui.press('Delete');
  },
  'clicking a column or row header selects all of it, Shift+click several': (ui) => {
    ui.clickHeader('th[data-col="1"]');
    assert.strictEqual(ui.selected(), 100);
    assert.strictEqual(ui.value('name-box'), 'B1');
    ui.clickHeader('th[data-row="2"]');
    ui.clickHeader('th[data-row="3"]', { shiftKey: true });
    assert.strictEqual(ui.selected(), 52);
  },
  'inserting a row pushes the total down and it still adds up; deleting brings it back': (ui) => {
    ui.click('A1');
    ui.type('100');
    ui.clickHeader('th[data-row="1"]');
    ui.button('insert-row');
    assert.strictEqual(ui.cell('A2').textContent, '');
    assert.strictEqual(ui.cell('A4').textContent, '350.50 €');
    ui.click('A4');
    assert.strictEqual(ui.value('formula-bar'), '=SUM(A1:A3)');
    ui.clickHeader('th[data-row="1"]');
    ui.button('delete-row');
    assert.strictEqual(ui.cell('A3').textContent, '350.50 €');
  },
  'deleting a column moves the next one into its place': (ui) => {
    ui.clickHeader('th[data-col="0"]');
    ui.button('delete-col');
    assert.strictEqual(ui.cell('A3').textContent, '1.00 €');
    ui.click('A3');
    assert.strictEqual(ui.value('formula-bar'), '=SUM(A1:A2)');
  },
  'dragging the fill handle down copies a formula with moved references': (ui) => {
    ui.click('G1');
    ui.type('5');
    ui.type('=G1*2');
    ui.click('G2');
    ui.fillTo('G4');
    assert.deepStrictEqual(['G3', 'G4'].map((ref) => ui.cell(ref).textContent), ['20', '40']);
    assert.strictEqual(ui.selected(), 3);
    ui.click('G4');
    assert.strictEqual(ui.value('formula-bar'), '=G3*2');
  },
  'dragging the fill handle right repeats a selected block': (ui) => {
    ui.click('G1');
    ui.click('G2', { shiftKey: true });
    ui.fillTo('I2');
    assert.deepStrictEqual(['H1', 'H2', 'I1', 'I2'].map((ref) => ui.cell(ref).textContent), ['5', '10', '5', '10']);
  },
  'a typed date is shown as a date and can be counted with': (ui) => {
    ui.click('K1');
    ui.type('2026-01-31');
    ui.type('01.03.2026');
    ui.type('=K2-K1');
    ui.type('=K1+1');
    assert.deepStrictEqual(['K1', 'K2', 'K3', 'K4'].map((ref) => ui.cell(ref).textContent), ['2026-01-31', '01.03.2026', '29', '2026-02-01']);
    ui.click('K4');
    ui.choose('number-format', 'date-dmy');
    assert.strictEqual(ui.cell('K4').textContent, '01.02.2026');
  },
  'long text runs over the empty cells beside it, up to the next filled cell': (ui) => {
    ui.click('M1');
    ui.type('a text much longer than one cell');
    const spill = () => ui.cell('M1').querySelector('.spill');
    assert.strictEqual(spill().style.width, 96 * 14 - 8 + 'px');
    ui.click('O1');
    ui.type('stop');
    assert.strictEqual(spill().style.width, 96 * 2 - 8 + 'px');
    ui.click('N1');
    ui.type('next');
    assert.strictEqual(spill(), null);
    assert.strictEqual(ui.cell('M1').textContent, 'a text much longer than one cell');
  },
  'a border and red negatives change the look of the selected cells': (ui) => {
    ui.click('M3');
    ui.type('-5');
    ui.click('M3');
    ui.choose('border', 'top-bottom');
    ui.toggle('negativeRed');
    const style = ui.cell('M3').style;
    assert.deepStrictEqual([style.borderTop, style.borderBottom, style.borderLeft].map((line) => line.startsWith('1px solid')), [true, true, false]);
    assert.strictEqual(style.color, 'rgb(192, 0, 0)');
    ui.typeThen('5', 'Enter');
    assert.strictEqual(style.color, '');
  },
  'a second sheet can use the first one, and is renamed and deleted from the tab bar': (ui) => {
    ui.click('M5');
    ui.type('40');
    ui.button('add-sheet');
    assert.deepStrictEqual(ui.tabs(), ['Sheet1', 'Sheet2*']);
    ui.type('=Sheet1!M5+2');
    assert.strictEqual(ui.cell('A1').textContent, '42');
    ui.showSheet('Sheet1');
    assert.strictEqual(ui.cell('M5').textContent, '40');
    ui.answer('Year');
    ui.button('rename-sheet');
    ui.showSheet('Sheet2');
    ui.click('A1');
    assert.strictEqual(ui.value('formula-bar'), '=Year!M5+2');
    ui.answer('year');
    ui.button('rename-sheet');
    assert.match(ui.lastAlert(), /already a sheet/);
    ui.answer(true);
    ui.button('delete-sheet');
    assert.deepStrictEqual(ui.tabs(), ['Year*']);
    ui.press('z', { ctrlKey: true });
    assert.deepStrictEqual(ui.tabs(), ['Year', 'Sheet2*']);
  },
  'opening a CSV file adds it as a new sheet; a broken file changes nothing': async (ui) => {
    await ui.open('bank 2026.csv', 'Date;Amount\n2026-01-05;12.5\n');
    assert.deepStrictEqual(ui.tabs(), ['Year', 'Sheet2', 'bank 2026*']);
    assert.deepStrictEqual(['A2', 'B2'].map((ref) => ui.cell(ref).textContent), ['2026-01-05', '12.5']);
    await ui.open('broken.json', 'not a workbook');
    assert.match(ui.lastAlert(), /not a workbook/);
    assert.deepStrictEqual(ui.tabs(), ['Year', 'Sheet2', 'bank 2026*']);
  },
  'printing leaves out the rows and columns after the last used cell': (ui) => {
    ui.printing(true);
    assert.deepStrictEqual(['B2', 'C2', 'A3'].map((ref) => ui.cell(ref).classList.contains('unprinted')), [false, true, false]);
    assert.strictEqual(ui.cell('A3').parentElement.classList.contains('unprinted'), true);
    ui.printing(false);
    assert.strictEqual(ui.unprinted(), 0);
  },
  'a number too wide for its cell shows #### and keeps its value in the tooltip': (ui) => {
    ui.click('D1');
    ui.type('12345678901234567890');
    assert.strictEqual(ui.cell('D1').textContent, '####');
    assert.strictEqual(ui.cell('D1').title, '12345678901200000000');
    ui.click('D1');
    ui.typeThen('12', 'Enter');
    assert.deepStrictEqual([ui.cell('D1').textContent, ui.cell('D1').title], ['12', '']);
  },
  'the grid lines under text that runs over its neighbours are hidden, and only those': (ui) => {
    ui.click('D3');
    ui.type('x'.repeat(30));
    assert.deepStrictEqual(['D3', 'E3', 'F3', 'G3'].map((ref) => ui.cell(ref).classList.contains('covered')), [true, true, false, false]);
    ui.click('E3');
    ui.type('stop');
    assert.strictEqual(ui.cell('D3').classList.contains('covered'), false);
  },
  'the sheet shown is moved and copied from the tab bar': (ui) => {
    ui.button('move-left');
    assert.deepStrictEqual(ui.tabs(), ['Year', 'bank 2026*', 'Sheet2']);
    ui.button('copy-sheet');
    assert.deepStrictEqual(ui.tabs(), ['Year', 'bank 2026', 'bank 2026 copy*', 'Sheet2']);
    assert.strictEqual(ui.cell('B2').textContent, '12.5');
    ui.showSheet('Sheet2');
    ui.click('A1');
    ui.type("='bank 2026 copy'!B2*2");
    assert.strictEqual(ui.cell('A1').textContent, '25');
  },
  'print settings: sideways page, row 1 on every page, and a page break at the chosen row': (ui) => {
    const table = ui.cell('A1').closest('table');
    ui.click('A2');
    ui.type('second row');
    ui.click('A2');
    ui.button('page-break');
    ui.check('landscape', true);
    ui.check('repeat-header', true);
    assert.strictEqual(ui.cell('A2').parentElement.classList.contains('page-break'), true);
    ui.printing(true);
    assert.match(ui.text('page-style'), /landscape/);
    assert.strictEqual(ui.cell('A1').closest('thead'), table.tHead);
    ui.printing(false);
    assert.strictEqual(ui.text('page-style'), '');
    assert.strictEqual(table.tBodies[0].rows[0], ui.cell('A1').parentElement);
    ui.button('page-break');
    assert.strictEqual(ui.cell('A2').parentElement.classList.contains('page-break'), false);
  },
  'filling two numbers continues the series, also upwards; a date continues day by day': (ui) => {
    ui.click('H4');
    ui.type('10');
    ui.type('20');
    ui.click('H4');
    ui.click('H5', { shiftKey: true });
    ui.fillTo('H7');
    ui.fillTo('H2');
    assert.deepStrictEqual(['H2', 'H3', 'H6', 'H7'].map((ref) => ui.cell(ref).textContent), ['-10', '0', '30', '40']);
    ui.click('J1');
    ui.type('30.12.2026');
    ui.click('J1');
    ui.fillTo('L1');
    assert.deepStrictEqual(['K1', 'L1'].map((ref) => ui.cell(ref).textContent), ['31.12.2026', '01.01.2027']);
  },
  'filling to the left copies a formula with its references moved': (ui) => {
    ui.click('L3');
    ui.type('=L1+1');
    ui.click('L3');
    ui.fillTo('K3');
    assert.strictEqual(ui.cell('K3').textContent, '01.01.2027');
    ui.click('K3');
    assert.strictEqual(ui.value('formula-bar'), '=K1+1');
  },
};

openPage().then(async (window) => {
  const ui = driver(window);
  let failed = 0;
  for (const [name, test] of Object.entries(tests)) {
    try { await test(ui); console.log('ok   ' + name); } catch (error) { failed++; console.log('FAIL ' + name + '\n     ' + error.message); }
  }
  process.exit(failed ? 1 : 0);
});
