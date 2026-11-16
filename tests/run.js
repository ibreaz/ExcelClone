/* Behaviour tests for the model (no browser needed): node tests/run.js */
'use strict';
const assert = require('assert');
require('../js/formula.js');
require('../js/sheet.js');
require('../js/format.js');
const { Sheet, formatValue, shiftRefs } = globalThis.XL;
const ROW = 'row';
const COL = 'col';

function sheetOf(cells) {
  const sheet = new Sheet();
  for (const [key, raw] of Object.entries(cells)) sheet.setRaw(key, raw);
  return sheet;
}

/** The text a user would see in the cell. */
function shown(sheet, key) {
  return formatValue(sheet.value(key), sheet.style(key));
}

const tests = {
  'arithmetic follows operator precedence and parentheses': () => {
    const sheet = sheetOf({ A1: '=1+2*3', A2: '=(1+2)*3', A3: '=2^3-10/4', A4: '=-A1+50%' });
    assert.deepStrictEqual(['A1', 'A2', 'A3', 'A4'].map((k) => sheet.value(k)), [7, 9, 5.5, -6.5]);
  },
  'a formula follows the cells it refers to when they change': () => {
    const sheet = sheetOf({ A1: '10', A2: '=A1*2', A3: '=a2+$A$1' });
    sheet.setRaw('A1', '20');
    assert.strictEqual(sheet.value('A3'), 60);
  },
  'range functions ignore text and empty cells': () => {
    const sheet = sheetOf({ A1: '10', A2: 'rent', A4: '30', B1: '=SUM(A1:A4)', B2: '=AVERAGE(A1:A4)', B3: '=COUNT(A1:A4)', B4: '=MAX(A1:A4;100)-MIN(A1:A4)' });
    assert.deepStrictEqual(['B1', 'B2', 'B3', 'B4'].map((k) => sheet.value(k)), [40, 20, 2, 90]);
  },
  'IF evaluates only the chosen branch': () => {
    const sheet = sheetOf({ A1: '0', A2: '=IF(A1=0, "n/a", 10/A1)', A3: '=IF(A1<>0, 1)' });
    assert.strictEqual(sheet.value('A2'), 'n/a');
    assert.strictEqual(sheet.value('A3'), false);
  },
  'ROUND rounds half away from zero': () => {
    const sheet = sheetOf({ A1: '=ROUND(1.005, 2)', A2: '=ROUND(-2.5)', A3: '=ABS(-3)' });
    assert.deepStrictEqual(['A1', 'A2', 'A3'].map((k) => sheet.value(k)), [1.01, -3, 3]);
  },
  'text is concatenated and compared without case': () => {
    const sheet = sheetOf({ A1: 'Total', A2: '="Sub" & A1 & 1', A3: '=A1="TOTAL"' });
    assert.strictEqual(sheet.value('A2'), 'SubTotal1');
    assert.strictEqual(sheet.value('A3'), true);
  },
  'mistakes show an error code instead of breaking the sheet': () => {
    const sheet = sheetOf({ A1: '=1/0', A2: '=NOPE(1)', A3: '=1+', A4: '="x"*2', A5: '=A5+1', A6: '=B6', B6: '=A6', A7: '=A1+1', A8: '=C1:C3+1' });
    assert.deepStrictEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'].map((k) => shown(sheet, k)),
      ['#DIV/0!', '#NAME?', '#ERROR!', '#VALUE!', '#CYCLE!', '#CYCLE!', '#DIV/0!', '#VALUE!']);
  },
  'a sheet survives a save and reload': () => {
    const sheet = sheetOf({ A1: '5', A2: '=A1*2' });
    sheet.setStyle('A2', { bold: true });
    const copy = new Sheet();
    copy.load(sheet.serialize());
    assert.strictEqual(copy.value('A2'), 10);
    assert.deepStrictEqual(copy.style('A2'), { bold: true });
  },
  'column widths are saved with the sheet, and a first-format save still opens': () => {
    const sheet = sheetOf({ A1: '5' });
    sheet.setColWidth(2, 180);
    const copy = new Sheet();
    copy.load(sheet.serialize());
    assert.strictEqual(copy.colWidth(2), 180);
    assert.strictEqual(copy.colWidth(0), undefined);
    copy.load('[["B1",{"raw":"7","style":{}}]]');
    assert.strictEqual(copy.value('B1'), 7);
    assert.throws(() => copy.load('{"other":1}'));
  },
  'inserting a row moves the cells below it and formulas keep pointing at the same data': () => {
    const sheet = sheetOf({ A1: '10', A2: '20', A3: '=SUM(A1:A2)', B1: '=$A$2*2' });
    sheet.restructure(ROW, 1, 2);
    assert.strictEqual(sheet.raw('A4'), '20');
    assert.strictEqual(sheet.raw('A5'), '=SUM(A1:A4)');
    assert.strictEqual(sheet.raw('B1'), '=$A$4*2');
    assert.strictEqual(sheet.value('A5'), 30);
  },
  'deleting a row inside a summed range shrinks the range': () => {
    const sheet = sheetOf({ A1: '10', A2: '20', A3: '30', A4: '=SUM(A1:A3)', B1: '=SUM(A3:A1)' });
    sheet.restructure(ROW, 2, -1);
    assert.strictEqual(sheet.raw('A3'), '=SUM(A1:A2)');
    assert.strictEqual(sheet.raw('B1'), '=SUM(A2:A1)');
    sheet.restructure(ROW, 0, -1);
    assert.strictEqual(sheet.raw('A2'), '=SUM(A1:A1)');
    assert.strictEqual(sheet.value('A2'), 20);
  },
  'deleting the cell or the whole range a formula uses shows #REF!': () => {
    const sheet = sheetOf({ A1: '10', A2: '20', C1: '=A1+B5', C2: '=SUM(A1:A2)', C3: '=SUM(A1:B9)' });
    sheet.restructure(COL, 0, -1);
    assert.deepStrictEqual(['B1', 'B2', 'B3'].map((k) => sheet.raw(k)), ['=#REF!+A5', '=SUM(#REF!)', '=SUM(A1:A9)']);
    assert.strictEqual(shown(sheet, 'B1'), '#ERROR!');
  },
  'inserting and deleting columns moves the column widths along': () => {
    const sheet = sheetOf({ B1: 'x' });
    sheet.setColWidth(1, 150);
    sheet.restructure(COL, 0, 1);
    assert.strictEqual(sheet.colWidth(2), 150);
    assert.strictEqual(sheet.raw('C1'), 'x');
    sheet.restructure(COL, 2, -1);
    assert.strictEqual(sheet.colWidth(2), undefined);
    assert.strictEqual(sheet.cells.size, 0);
  },
  'numbers are shown without floating point noise': () => {
    assert.strictEqual(shown(sheetOf({ A1: '=0.1+0.2' }), 'A1'), '0.3');
  },
  'number formats group thousands and add the unit': () => {
    const text = (format, decimals) => formatValue(-1234567.891, { format, decimals });
    assert.deepStrictEqual([text('number'), text('eur'), text('usd', 0), text('ron', 1)],
      ['-1,234,567.89', '-1,234,567.89 €', '$-1,234,568', '-1,234,567.9 lei']);
    assert.strictEqual(formatValue(0.1234, { format: 'percent', decimals: 1 }), '12.3%');
    assert.strictEqual(formatValue(-0.001, { format: 'number' }), '0.00');
  },
  'clearing content keeps the style, clearing both removes the cell': () => {
    const sheet = sheetOf({ A1: '5' });
    sheet.setStyle('A1', { bold: true, italic: true });
    sheet.setStyle('A1', { italic: undefined });
    sheet.setRaw('A1', '');
    assert.deepStrictEqual(sheet.style('A1'), { bold: true });
    sheet.clearStyle('A1');
    assert.strictEqual(sheet.cells.size, 0);
  },
};

if (shiftRefs) {
  Object.assign(tests, {
    'copied formulas move relative references and keep absolute ones': () => {
      assert.strictEqual(shiftRefs('=A1+$B$2+C$3+$D4+SUM(A1:B2)', 1, 2), '=B3+$B$2+D$3+$D6+SUM(B3:C4)');
    },
    'copied formulas leave text and function names alone': () => {
      assert.strictEqual(shiftRefs('="A1" & LOG10(A1)', 1, 1), '="A1" & LOG10(B2)');
      assert.strictEqual(shiftRefs('plain A1', 1, 1), 'plain A1');
    },
    'a reference pushed off the sheet becomes #REF!': () => {
      assert.strictEqual(shiftRefs('=A1+B2', -1, 0), '=#REF!+A2');
    },
  });
}

let failed = 0;
for (const [name, test] of Object.entries(tests)) {
  try { test(); console.log('ok   ' + name); } catch (error) { failed++; console.log('FAIL ' + name + '\n     ' + error.message); }
}
console.log(`${Object.keys(tests).length - failed}/${Object.keys(tests).length} passed`);
process.exit(failed ? 1 : 0);
