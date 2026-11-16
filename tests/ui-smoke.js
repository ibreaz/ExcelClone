/* Drives the real page in jsdom (test-only dependency, not shipped): NODE_PATH=<dir with jsdom>/node_modules node tests/ui-smoke.js */
'use strict';
const assert = require('assert');
const path = require('path');
const { JSDOM } = require('jsdom');

async function openPage() {
  const dom = await JSDOM.fromFile(path.join(__dirname, '..', 'index.html'), {
    runScripts: 'dangerously',
    resources: 'usable',
    beforeParse(window) { window.Element.prototype.scrollIntoView = () => {}; }, // jsdom has no layout
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
    assert.deepStrictEqual(['K1', 'K2', 'K3', 'K4'].map((ref) => ui.cell(ref).textContent), ['2026-01-31', '01.03.2026', '29', '20485']);
    ui.click('K4');
    ui.choose('number-format', 'date-dmy');
    assert.strictEqual(ui.cell('K4').textContent, '01.02.2026');
  },
};

openPage().then((window) => {
  const ui = driver(window);
  let failed = 0;
  for (const [name, test] of Object.entries(tests)) {
    try { test(ui); console.log('ok   ' + name); } catch (error) { failed++; console.log('FAIL ' + name + '\n     ' + error.message); }
  }
  process.exit(failed ? 1 : 0);
});
