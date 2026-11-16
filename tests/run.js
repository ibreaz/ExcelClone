/* Behaviour tests for the model (no browser needed): node tests/run.js */
'use strict';
const assert = require('assert');
require('../js/formula.js');
require('../js/sql.js');
require('../js/sheet.js');
require('../js/format.js');
require('../js/workbook.js');
require('../js/csv.js');
require('../js/fill.js');
const fs = require('fs');
const demo = require('../demo/build-demo.js');
const { Workbook, parseCsv, csvLine, seriesOf } = globalThis.XL;
const { Sheet, FormulaError, formatValue, shiftRefs, FUNCTION_NAMES, NUMBER_FORMATS, BORDER_SIDES, ERRORS } = globalThis.XL;
const ROW = 'row';
const COL = 'col';

const STYLE_PROPERTIES = ['bold', 'italic', 'underline', 'align', 'color', 'fill', 'decimals', 'border', 'negativeRed'];

function demoBook() {
  const book = new Workbook();
  book.load(demo.build());
  return book;
}

/** A workbook from { sheetName: { cell: content } }; the first sheet is the one shown. */
function bookOf(sheets) {
  const book = new Workbook();
  Object.entries(sheets).forEach(([name, cells], index) => {
    const sheet = index === 0 ? book.active : book.add(name);
    if (index === 0) book.rename(0, name);
    for (const [key, raw] of Object.entries(cells)) sheet.setRaw(key, raw);
  });
  book.select(0);
  return book;
}

const ORDERS = {
  A1: 'nr', B1: 'client', C1: 'date', D1: 'amount',
  A2: '1', B2: 'Acme', C2: '2026-01-05', D2: '1200',
  A3: '2', B3: 'Borealis', C3: '2026-01-09', D3: '450',
  A4: '3', B4: 'acme', C4: '2026-02-17', D4: '300',
  A5: '4', B5: 'Cetus', C5: '2026-02-20', D5: '980',
};

/** A sheet with the ORDERS table at A1:D5 (amounts in euro) and one query at F1; returns the cells the query fills, as shown. */
function queried(query, extraCells = {}) {
  const sheet = sheetOf({ ...ORDERS, ...extraCells, F1: query });
  ['D2', 'D3', 'D4', 'D5'].forEach((key) => sheet.setStyle(key, { format: 'eur' }));
  const lines = [];
  for (let row = 1; shown(sheet, 'F' + row) !== ''; row++) {
    lines.push(['F', 'G', 'H', 'I'].map((column) => shown(sheet, column + row)).filter((text) => text !== '').join(' | '));
  }
  return lines;
}

function sheetOf(cells) {
  const sheet = new Sheet();
  for (const [key, raw] of Object.entries(cells)) sheet.setRaw(key, raw);
  return sheet;
}

/** The text a user would see in the cell. */
function shown(sheet, key) {
  return formatValue(sheet.value(key), sheet.shownStyle(key));
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
    const sheet = sheetOf({ A1: 'Total', A2: '="Sub" & A1 & 1', A3: '=A1="TOTAL"', A4: '="is " & (0.1+0.2)' });
    assert.strictEqual(sheet.value('A4'), 'is 0.3');
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
    assert.strictEqual(shown(sheet, 'B1'), '#REF!');
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
  'typed dates are real dates that can be compared, subtracted and taken apart': () => {
    const sheet = sheetOf({ A1: '2026-02-27', A2: '02.03.2026', A3: '=A2-A1', A4: '=DATE(YEAR(A1), MONTH(A1)+1, DAY(A1))', A5: '=A1<A2', A6: '2026-02-30', A7: '=TODAY()-TODAY()', A8: '=YEAR(TODAY())>=2026' });
    sheet.setStyle('A4', { format: 'date-dmy' });
    assert.deepStrictEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'].map((k) => shown(sheet, k)),
      ['2026-02-27', '02.03.2026', '3', '27.03.2026', 'TRUE', '2026-02-30', '0', 'TRUE']);
  },
  'a typed date keeps the number format the cell already has': () => {
    const sheet = new Sheet();
    sheet.setStyle('A1', { format: 'date-dmy' });
    sheet.setRaw('A1', '2026-12-31');
    assert.strictEqual(shown(sheet, 'A1'), '31.12.2026');
  },
  'SUMIF and COUNTIF pick rows by text or by comparison': () => {
    const sheet = sheetOf({ A1: 'Food', A2: 'Rent', A3: 'food', B1: '10', B2: '500', B3: '25',
      C1: '=SUMIF(A1:A3, "Food", B1:B3)', C2: '=SUMIF(B1:B3, ">=25")', C3: '=COUNTIF(A1:A3, "<>Food")', C4: '=COUNTIF(B1:B4, 10)', C5: '=SUMIF(A1:A3, "Food", B1:B2)' });
    assert.deepStrictEqual(['C1', 'C2', 'C3', 'C4', 'C5'].map((k) => shown(sheet, k)), ['35', '525', '1', '1', '#VALUE!']);
  },
  'AND, OR, NOT and COUNTA combine conditions and count filled cells': () => {
    const sheet = sheetOf({ A1: '5', A2: 'x', B1: '=AND(A1>1, A1<10)', B2: '=OR(A1>9, A1=0)', B3: '=NOT(B2)', B4: '=COUNTA(A1:A4)', B5: '=IF(AND(B1, NOT(B2)), "ok", "no")' });
    assert.deepStrictEqual(['B1', 'B2', 'B3', 'B4', 'B5'].map((k) => shown(sheet, k)), ['TRUE', 'FALSE', 'TRUE', '2', 'ok']);
  },
  'the demo file is what its builder produces': () => {
    assert.strictEqual(fs.readFileSync(demo.DEMO_FILE, 'utf8'), demo.build(), 'run: node demo/build-demo.js');
    assert.strictEqual(fs.readFileSync(demo.DEMO_SCRIPT, 'utf8'), demo.buildScript(), 'run: node demo/build-demo.js');
  },
  'the demo uses every function, number format and kind of cell formatting': () => {
    const book = demoBook();
    const cells = book.sheets.flatMap((sheet) => [...sheet.cells.values()]);
    const formulas = cells.map((cell) => cell.raw).filter((raw) => raw.startsWith('=')).join(' ');
    const unused = (names, isUsed) => names.filter((name) => !isUsed(name));
    assert.deepStrictEqual(unused(FUNCTION_NAMES, (name) => formulas.includes(name + '(')), []);
    assert.deepStrictEqual(unused(NUMBER_FORMATS, (format) => cells.some((cell) => cell.style.format === format)), []);
    assert.deepStrictEqual(unused(STYLE_PROPERTIES, (property) => cells.some((cell) => property in cell.style)), []);
    assert.deepStrictEqual(unused(Object.keys(BORDER_SIDES), (border) => cells.some((cell) => cell.style.border === border)), []);
    assert.ok(Object.keys(book.active.widths).length > 0, 'no resized column');
    assert.ok(book.find(demo.LIMITS).usedRange().lastRow > 3, 'no list of limits');
    assert.ok(book.allNames().length >= 2 && book.allNames().some((area) => new RegExp(`\\b${area.name}\\b`, 'i').test(formulas)), 'no name used in a formula');
    assert.ok(book.sheets.length > 1 && /'[^']+'!/.test(formulas), 'no formula that uses a sheet with a space in its name');
    const printed = (isSet) => book.sheets.some((sheet) => isSet(sheet.print));
    assert.ok(printed((print) => print.landscape) && printed((print) => print.repeatHeader) && printed((print) => print.breaks.length > 0), 'a print setting is not shown');
  },
  'the demo shows every error code, and only in rows labelled as errors': () => {
    const book = demoBook();
    const sheet = book.find(demo.FEATURES);
    const withErrors = book.names.filter((name) => [...book.find(name).cells.keys()].some((key) => book.find(name).value(key) instanceof FormulaError));
    assert.deepStrictEqual(withErrors, [demo.FEATURES]);
    const errors = [...sheet.cells.keys()].filter((key) => sheet.value(key) instanceof FormulaError);
    const label = (key) => sheet.raw('A' + key.replace(/\D/g, ''));
    assert.deepStrictEqual(errors.filter((key) => !label(key).startsWith(demo.ERROR_LABEL)), []);
    assert.deepStrictEqual(Object.values(ERRORS).filter((code) => !errors.some((key) => shown(sheet, key) === code)), []);
  },
  'a formula can use cells and ranges of another sheet and follows their changes': () => {
    const book = bookOf({ Year: { A1: '=Jan!B1+SUM(jan!A1:A2)', A2: '=Missing!A1' }, Jan: { A1: '10', A2: '20', B1: '=A1*2' } });
    assert.strictEqual(book.active.value('A1'), 50);
    book.find('Jan').setRaw('A1', '100');
    assert.strictEqual(book.active.value('A1'), 320);
    assert.strictEqual(shown(book.active, 'A2'), '#REF!');
  },
  'formulas that refer to each other across sheets show a cycle': () => {
    const book = bookOf({ One: { A1: '=Two!A1' }, Two: { A1: '=One!A1+1' } });
    assert.strictEqual(shown(book.active, 'A1'), '#CYCLE!');
  },
  'renaming a sheet updates the formulas that name it; deleting it leaves #REF!': () => {
    const book = bookOf({ Year: { A1: '=Jan!A1 & " Jan!A1"' }, Jan: { A1: 'x' } });
    book.rename(1, 'January');
    assert.strictEqual(book.active.raw('A1'), '=January!A1 & " Jan!A1"');
    assert.strictEqual(book.active.value('A1'), 'x Jan!A1');
    book.remove(1);
    assert.strictEqual(shown(book.active, 'A1'), '#REF!');
  },
  'sheet names must be simple and unique, and the last sheet stays': () => {
    const book = bookOf({ Year: {}, Jan: {} });
    assert.throws(() => book.rename(1, "it's"));
    assert.throws(() => book.rename(1, ' padded '));
    assert.throws(() => book.rename(1, 'YEAR'));
    assert.throws(() => book.add('jan'));
    book.remove(0);
    assert.throws(() => book.remove(0));
    assert.deepStrictEqual(book.names, ['Jan']);
  },
  'a sheet name with spaces is written in quotes in formulas, also after a rename': () => {
    const book = bookOf({ Year: { A1: "='Jan 2026'!A1+SUM('jan 2026'!A1:A2)", A2: '=Feb!A1' }, 'Jan 2026': { A1: '10', A2: '20' }, Feb: { A1: '1' } });
    assert.strictEqual(book.active.value('A1'), 40);
    book.rename(1, 'January (final)');
    book.rename(2, 'Feb 2026');
    assert.strictEqual(book.active.raw('A1'), "='January (final)'!A1+SUM('January (final)'!A1:A2)");
    assert.strictEqual(book.active.raw('A2'), "='Feb 2026'!A1");
    assert.deepStrictEqual(['A1', 'A2'].map((key) => book.active.value(key)), [40, 1]);
    book.find('Feb 2026').restructure(ROW, 0, 1);
    assert.strictEqual(book.active.raw('A2'), "='Feb 2026'!A2");
    assert.strictEqual(shiftRefs("='Q1 2026'!A1", 1, 1), "='Q1 2026'!B2");
  },
  'a sheet can be moved among the tabs and copied with everything in it': () => {
    const book = bookOf({ Year: { A1: '5', A2: '=A1*2' }, Jan: {} });
    book.active.setStyle('A1', { bold: true });
    book.move(0, 1);
    book.move(1, 1);
    assert.deepStrictEqual(book.names, ['Jan', 'Year']);
    book.duplicate(1);
    book.duplicate(1);
    assert.deepStrictEqual(book.names, ['Jan', 'Year', 'Year copy 1', 'Year copy']);
    assert.strictEqual(book.active, book.find('Year copy 1'));
    book.active.setRaw('A1', '7');
    assert.deepStrictEqual([book.active.value('A2'), book.find('Year').value('A2')], [14, 10]);
    assert.deepStrictEqual(book.active.style('A1'), { bold: true });
  },
  'print settings are kept per sheet, and page breaks follow inserted and deleted rows': () => {
    const sheet = sheetOf({ A1: 'x' });
    sheet.setPrintOption('landscape', true);
    sheet.togglePageBreak(10);
    sheet.togglePageBreak(4);
    sheet.restructure(ROW, 0, 2);
    assert.deepStrictEqual(sheet.print.breaks, [6, 12]);
    sheet.restructure(ROW, 6, -1);
    sheet.togglePageBreak(11);
    const copy = new Sheet();
    copy.load(sheet.serialize());
    assert.deepStrictEqual(copy.print, { landscape: true, repeatHeader: false, breaks: [] });
    assert.deepStrictEqual(new Sheet().print, { landscape: false, repeatHeader: false, breaks: [] });
  },
  'inserting rows in one sheet moves the references other sheets have to it, and only those': () => {
    const book = bookOf({ Year: { A1: '=Jan!A2+A2', A2: '5' }, Jan: { A2: '7', B1: '=A2+Year!A2' } });
    book.find('Jan').restructure(ROW, 0, 1);
    assert.strictEqual(book.active.raw('A1'), '=Jan!A3+A2');
    assert.strictEqual(book.find('Jan').raw('B2'), '=A3+Year!A2');
    assert.strictEqual(book.active.value('A1'), 12);
  },
  'a workbook survives a save and reload, and a single-sheet save opens as one sheet': () => {
    const book = bookOf({ Year: { A1: '=Jan!A1' }, Jan: { A1: '4' } });
    book.select(1);
    const copy = new Workbook();
    copy.load(book.serialize());
    assert.deepStrictEqual(copy.names, ['Year', 'Jan']);
    assert.strictEqual(copy.active, copy.find('Jan'));
    assert.strictEqual(copy.find('Year').value('A1'), 4);
    for (const oldSave of ['[["B1",{"raw":"7","style":{}}]]', sheetOf({ B1: '7' }).serialize()]) {
      copy.load(oldSave);
      assert.deepStrictEqual(copy.names, ['Sheet1']);
      assert.strictEqual(copy.active.value('B1'), 7);
    }
    assert.throws(() => copy.load('{"other":1}'));
    assert.strictEqual(copy.active.value('B1'), 7);
  },
  'CSV is read with quotes, either separator, and written back safely': () => {
    assert.deepStrictEqual(parseCsv('a,"b,1",c\r\n"say ""hi""",,\n'), [['a', 'b,1', 'c'], ['say "hi"', '', '']]);
    assert.deepStrictEqual(parseCsv('﻿Date;Amount\n2026-01-05;"1,5"\n"two\nlines";x'), [['Date', 'Amount'], ['2026-01-05', '1,5'], ['two\nlines', 'x']]);
    assert.deepStrictEqual(parseCsv(''), []);
    assert.deepStrictEqual(parseCsv(csvLine(['a,b', 'say "hi"', 'plain'])), [['a,b', 'say "hi"', 'plain']]);
  },
  'the used range tells how far content or formatting reaches': () => {
    const sheet = sheetOf({ B3: 'x' });
    sheet.setStyle('D1', { bold: true });
    assert.deepStrictEqual(sheet.usedRange(), { lastRow: 2, lastCol: 3 });
    assert.deepStrictEqual(new Sheet().usedRange(), { lastRow: -1, lastCol: -1 });
  },
  'a formula that results in a date is shown as a date, in the format of the date it uses': () => {
    const sheet = sheetOf({ A1: '2026-01-30', A2: '15.02.2026', B1: '=A1+3', B2: '=A2-1', B3: '=MAX(A1:A2)', B4: '=IF(A1>A2, A1, A2)', B5: '=TODAY()-TODAY()+DATE(2026,3,1)',
      C1: '=A2-A1', C2: '=YEAR(A1)', C3: '=A1+A2', C4: '=COUNT(A1:A2)', C5: '=A1+' });
    assert.deepStrictEqual(['B1', 'B2', 'B3', 'B4', 'B5'].map((k) => shown(sheet, k)), ['2026-02-02', '14.02.2026', '2026-02-15', '2026-02-15', '2026-03-01']);
    assert.deepStrictEqual(['C1', 'C2', 'C3', 'C4', 'C5'].map((k) => shown(sheet, k)), ['16', '2026', '40982', '2', '#ERROR!']);
  },
  'a date formula on another sheet, and one in a cell that already has a format': () => {
    const book = bookOf({ Year: {}, 'Jan 2026': { A1: '31.01.2026' } });
    book.active.setRaw('A1', "='Jan 2026'!A1+1");
    assert.strictEqual(shown(book.active, 'A1'), '01.02.2026');
    const sheet = sheetOf({ A1: '31.01.2026' });
    sheet.setStyle('B1', { format: 'number' });
    sheet.setRaw('B1', '=A1+1');
    assert.strictEqual(shown(sheet, 'B1'), '20,485.00');
  },
  'SUMIF and COUNTIF accept a date in the criterion': () => {
    const sheet = sheetOf({ A1: '2026-01-05', A2: '2026-01-15', A3: '20.01.2026', B1: '1', B2: '10', B3: '100',
      C1: '=SUMIF(A1:A3, ">=2026-01-15", B1:B3)', C2: '=COUNTIF(A1:A3, "<15.01.2026")', C3: '=COUNTIF(A1:A3, "2026-01-20")' });
    assert.deepStrictEqual(['C1', 'C2', 'C3'].map((k) => sheet.value(k)), [110, 1, 1]);
  },
  'a filled series continues numbers by their step and dates by days, forwards and backwards': () => {
    const continued = (raws, positions) => positions.map(seriesOf(raws));
    assert.deepStrictEqual(continued(['1', '2'], [2, 3, -1]), ['3', '4', '0']);
    assert.deepStrictEqual(continued(['10', '7.5', '5'], [3, 4]), ['2.5', '0']);
    assert.deepStrictEqual(continued(['0.1', '0.2'], [2]), ['0.3']);
    assert.deepStrictEqual(continued(['2026-12-30'], [1, 2, -1]), ['2026-12-31', '2027-01-01', '2026-12-29']);
    assert.deepStrictEqual(continued(['01.01.2026', '08.01.2026'], [2]), ['15.01.2026']);
  },
  'a single number, uneven numbers, formulas and text are copied when filled, not continued': () => {
    for (const raws of [['5'], ['1', '2', '4'], ['1', '=A1+1'], ['Jan', 'Feb'], ['1', ''], ['2026-01-01', '5']]) {
      assert.strictEqual(seriesOf(raws), null, JSON.stringify(raws));
    }
  },
  'a name stands for a cell or a range in formulas, whatever the case it is typed in': () => {
    const book = bookOf({ Year: { A1: '10', A2: '20', B1: '0.19', C1: '=SUM(amounts)*(1+Vat)', C2: '=Unknown+1' }, Other: { A1: '=VAT*100' } });
    book.defineName('Amounts', book.active, { from: { col: 0, row: 0 }, to: { col: 0, row: 1 } });
    book.defineName('Vat', book.active, { from: { col: 1, row: 0 }, to: { col: 1, row: 0 } });
    assert.strictEqual(shown(book.active, 'C1'), '35.7');
    assert.strictEqual(shown(book.find('Other'), 'A1'), '19');
    assert.strictEqual(shown(book.active, 'C2'), '#NAME?');
    book.active.setRaw('A2', '90');
    assert.strictEqual(shown(book.active, 'C1'), '119');
    book.deleteName('VAT');
    assert.strictEqual(shown(book.active, 'C1'), '#NAME?');
  },
  'a name must be one word that cannot be read as a cell, and naming again moves the name': () => {
    const book = bookOf({ Year: { A1: '1', B1: '2', C1: '=Rate' } });
    const at = (col) => ({ from: { col, row: 0 }, to: { col, row: 0 } });
    for (const bad of ['A1', 'tax2026', 'my name', 'TRUE', '9lives', '']) assert.throws(() => book.defineName(bad, book.active, at(0)), bad);
    book.defineName('Rate', book.active, at(0));
    book.defineName('rate', book.active, at(1));
    assert.strictEqual(book.active.value('C1'), 2);
    assert.deepStrictEqual(book.allNames().map((area) => area.name), ['rate']);
  },
  'names follow inserted and deleted rows, are saved with the workbook and go with their sheet': () => {
    const book = bookOf({ Year: { A2: '10', A3: '20', A4: '30', C1: '=SUM(Costs)', D1: '=Jan!A1+Bonus' }, Jan: { A1: '5' } });
    book.defineName('Costs', book.active, { from: { col: 0, row: 1 }, to: { col: 0, row: 3 } });
    book.defineName('Bonus', book.find('Jan'), { from: { col: 0, row: 0 }, to: { col: 0, row: 0 } });
    book.active.restructure(ROW, 0, 2);
    book.active.restructure(ROW, 3, -1);
    assert.strictEqual(book.active.value('C3'), 50);
    const copy = new Workbook();
    copy.load(book.serialize());
    assert.deepStrictEqual(copy.areaNamed('costs'), { name: 'Costs', sheet: 'Year', from: { col: 0, row: 3 }, to: { col: 0, row: 4 } });
    assert.strictEqual(copy.active.value('D3'), 10);
    copy.active.restructure(ROW, 3, -2);
    assert.strictEqual(copy.areaNamed('Costs'), undefined);
    copy.remove(1);
    assert.deepStrictEqual(copy.allNames(), []);
  },
  'a query result fills the cells beside and below it, with the number formats of its source columns': () => {
    assert.deepStrictEqual(queried('=SQL("select client, date, amount from A1:D5 where amount >= 450 order by amount desc")'),
      ['client | date | amount', 'Acme | 2026-01-05 | 1,200.00 €', 'Cetus | 2026-02-20 | 980.00 €', 'Borealis | 2026-01-09 | 450.00 €']);
  },
  'a query groups, totals and counts; text compares without case': () => {
    assert.deepStrictEqual(queried('=SQL("select client, count(*) as orders, sum(amount) as total, avg(amount) from A1:D5 group by client order by total desc")'),
      ['client | orders | total | avg(amount)', 'Acme | 2 | 1,500.00 € | 750.00 €', 'Cetus | 1 | 980.00 € | 980.00 €', 'Borealis | 1 | 450.00 € | 450.00 €']);
    assert.deepStrictEqual(queried('=SQL("select count(*) as n, min(date) as first, max(amount) - min(amount) as spread from A1:D5 where client <> \'Cetus\'")'),
      ['n | first | spread', '3 | 2026-01-05 | 900']);
  },
  'a query filters with AND, OR, NOT, LIKE, dates and values passed for ?': () => {
    assert.deepStrictEqual(queried('=SQL("select nr from A1:D5 where date >= \'2026-02-01\' and not amount > 500 or client like \'bor%\'")'), ['nr', '2', '3']);
    assert.deepStrictEqual(queried('=SQL("select nr, amount * 2 as double from A1:D5 where date < ? and client = ? limit 5", K1, "ACME")', { K1: '2026-02-01' }), ['nr | double', '1 | 2400']);
    assert.deepStrictEqual(queried('=SQL("select distinct client from A1:D5 where nr > 2 order by 1 desc")'), ['client', 'Cetus', 'acme']);
  },
  'star gives every column, and a query over no rows still gives its column names and totals': () => {
    assert.deepStrictEqual(queried('=SQL("select * from A1:D5 where nr = 2")'), ['nr | client | date | amount', '2 | Borealis | 2026-01-09 | 450.00 €']);
    assert.deepStrictEqual(queried('=SQL("select nr from A1:D5 where nr > 99")'), ['nr']);
    assert.deepStrictEqual(queried('=SQL("select count(*) as n, sum(amount) as total from A1:D5 where nr > 99")'), ['n | total', '0 | 0.00 €']);
  },
  'two named tables are joined, with table.column where a name is in both': () => {
    const book = bookOf({ Data: { ...ORDERS, F1: 'client', G1: 'country', F2: 'Acme', G2: 'RO', F3: 'Cetus', G3: 'BE' }, Report: {} });
    book.defineName('Orders', book.active, { from: { col: 0, row: 0 }, to: { col: 3, row: 9 } });
    book.defineName('Clients', book.active, { from: { col: 5, row: 0 }, to: { col: 6, row: 2 } });
    const report = book.find('Report');
    report.setRaw('A1', '=SQL("select c.country, sum(o.amount) as total from Orders o join Clients c on o.client = c.client group by c.country order by total")');
    assert.deepStrictEqual(['A1', 'B1', 'A2', 'B2', 'A3', 'B3', 'A4'].map((key) => shown(report, key)), ['c.country', 'total', 'BE', '980', 'RO', '1500', '']);
    book.active.setRaw('D2', '5000');
    assert.strictEqual(shown(report, 'B3'), '5300');
    report.setRaw('D1', "=SQL(\"select count(*) as n from Data!A1:D5\")");
    assert.strictEqual(shown(report, 'D2'), '4');
  },
  'a result with no room shows #SPILL!, and takes its place once the cell in the way is emptied': () => {
    const sheet = sheetOf({ ...ORDERS, F1: '=SQL("select nr from A1:D5")', F3: 'in the way', H1: '=F2+1' });
    assert.deepStrictEqual(['F1', 'F2', 'H1'].map((key) => shown(sheet, key)), ['#SPILL!', '', '1']);
    sheet.setRaw('F3', '');
    assert.deepStrictEqual(['F1', 'F2', 'F3', 'H1'].map((key) => shown(sheet, key)), ['nr', '1', '2', '2']);
    assert.deepStrictEqual(sheet.usedRange(), { lastRow: 4, lastCol: 7 });
  },
  'a sheet tells where its queries are and which cells show their results': () => {
    const sheet = sheetOf({ ...ORDERS, F1: '=SQL("select nr, client from A1:D5 where nr < 3")', F6: '=SQL("select nope from A1:D5")' });
    assert.deepStrictEqual(sheet.queryAreas(), [
      { key: 'F1', from: { col: 5, row: 0 }, to: { col: 6, row: 2 } },
      { key: 'F6', from: { col: 5, row: 5 }, to: { col: 5, row: 5 } },
    ]);
    assert.deepStrictEqual(['F1', 'G3', 'F4', 'A1', 'F6'].map((key) => sheet.queryCellOf(key)), ['F1', 'F1', undefined, undefined, undefined]);
  },
  'a later query can read the result of an earlier one, and two results cannot overlap': () => {
    const sheet = sheetOf({ ...ORDERS, F1: '=SQL("select client, amount from A1:D5 where amount > 400")', I1: '=SQL("select count(*) as big from F1:G9")', F4: '' });
    assert.strictEqual(shown(sheet, 'I2'), '3');
    sheet.setRaw('G3', '=SQL("select nr from A1:D5")');
    assert.strictEqual(shown(sheet, 'F1'), '#SPILL!');
  },
  'a query that cannot be run shows #SQL! and says why': () => {
    const reason = (query, cells) => sheetOf({ ...ORDERS, ...cells, F1: query }).value('F1').detail;
    assert.match(reason('=SQL("select price from A1:D5")'), /no column "price"/);
    assert.match(reason('=SQL("select nr from Nowhere")'), /no table "Nowhere"/);
    assert.match(reason('=SQL("select nr from A1:D5 where")'), /end of the query/);
    assert.match(reason('=SQL("select nr from A1:D5 where sum(amount) > 1")'), /cannot be used in WHERE/);
    assert.match(reason('=SQL("select upper(client) from A1:D5")'), /Unknown function UPPER/);
    assert.match(reason('=SQL("select nr from A1:D5 where nr = ?")'), /more \? than values/);
    assert.match(reason('=SQL("select nr from A1:D5 order nr")'), /Expected BY/);
    assert.strictEqual(shown(sheetOf({ ...ORDERS, F1: '=SQL("select nr from A1:D5") + 1' }), 'F1'), '#VALUE!');
    assert.strictEqual(shown(sheetOf({ ...ORDERS, D3: '=1/0', F1: '=SQL("select nr from A1:D5")' }), 'F1'), '#DIV/0!');
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
