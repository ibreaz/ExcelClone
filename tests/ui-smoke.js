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
      key(grid, text[0]);
      editor.value = text;
      key(editor, 'Enter');
    },
    click(ref, extra = {}) {
      this.cell(ref).dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, ...extra }));
      document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
    },
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
};

openPage().then((window) => {
  const ui = driver(window);
  let failed = 0;
  for (const [name, test] of Object.entries(tests)) {
    try { test(ui); console.log('ok   ' + name); } catch (error) { failed++; console.log('FAIL ' + name + '\n     ' + error.message); }
  }
  process.exit(failed ? 1 : 0);
});
