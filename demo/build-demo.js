/*
 * Builds demo/all-features.json: one sheet that shows every feature, to open with the Open button.
 * After adding a feature, add a demo of it here and run: node demo/build-demo.js
 * (tests/run.js fails while a function, number format or kind of formatting is missing from the demo).
 */
'use strict';
const fs = require('fs');
const path = require('path');
require('../js/formula.js');
require('../js/sheet.js');
const { Sheet } = globalThis.XL;

const DEMO_FILE = path.join(__dirname, 'all-features.json');
const ERROR_LABEL = 'Error: ';
const HEADING = { bold: true, fill: '#dbeef6' };
const MONEY = { format: 'eur' };
const SAMPLE = '1234567.891';
const COLUMN_WIDTHS = [300, 170, 110, 110];
const LEDGER_COLUMNS = ['A', 'B', 'C', 'D'];
const LEDGER_FIRST_ROW = 4;
const LEDGER = [
  ['2026-01-05', 'Salary', 'Income', '3200'],
  ['2026-01-07', 'Rent', 'Housing', '-950'],
  ['08.01.2026', 'Groceries', 'Food', '-182.45'],
  ['2026-01-15', 'Electricity', 'Housing', '-96.3'],
  ['2026-01-20', 'Restaurant', 'Food', '-64'],
];

// Each section: [title, demos]; each demo: [label, cell content, cell style].
const SECTIONS = [
  ['Arithmetic and text', [
    ['Multiplication goes before addition', '=1+2*3'],
    ['Parentheses', '=(1+2)*3'],
    ['Power', '=2^10'],
    ['Percent', '=50%*200'],
    ['Join text with &', '="Balance: " & D9'],
    ['Compare (= <> < > <= >=)', '=D4>1000'],
    ['$ keeps a reference in place when copied', '=$D$9*19%', MONEY],
  ]],
  ['Totals over a range', [
    ['SUM', '=SUM(D4:D8)', MONEY],
    ['AVERAGE', '=AVERAGE(D4:D8)', MONEY],
    ['MIN', '=MIN(D4:D8)', MONEY],
    ['MAX', '=MAX(D4:D8)', MONEY],
    ['COUNT (numbers)', '=COUNT(D4:D8)'],
    ['COUNTA (filled cells)', '=COUNTA(B4:B8)'],
    ['ROUND to 2 decimals', '=ROUND(D9/3, 2)'],
    ['ABS', '=ABS(D5)', MONEY],
  ]],
  ['Conditions', [
    ['IF', '=IF(D9>0, "surplus", "deficit")'],
    ['AND', '=AND(D9>0, D4>3000)'],
    ['OR', '=OR(D9<0, D4<0)'],
    ['NOT', '=NOT(D9<0)'],
    ['SUMIF by category', '=SUMIF(C4:C8, "Food", D4:D8)', MONEY],
    ['SUMIF by comparison (all expenses)', '=SUMIF(D4:D8, "<0")', MONEY],
    ['COUNTIF', '=COUNTIF(C4:C8, "Housing")'],
  ]],
  ['Dates (type 2026-12-31 or 31.12.2026)', [
    ['Typed as year-month-day', '2026-11-16'],
    ['Typed as day.month.year', '16.11.2026'],
    ['TODAY', '=TODAY()', { format: 'date' }],
    ['DATE from year, month, day', '=DATE(2026, 12, 31)', { format: 'date' }],
    ['Days between two dates', '=A8-A4'],
    ['A date plus 30 days', '=A4+30', { format: 'date-dmy' }],
    ['YEAR', '=YEAR(A4)'],
    ['MONTH', '=MONTH(A4)'],
    ['DAY', '=DAY(A4)'],
  ]],
  ['Number formats', [
    ['General', SAMPLE],
    ['Thousands separator', SAMPLE, { format: 'number' }],
    ['Euro', SAMPLE, MONEY],
    ['Dollar', SAMPLE, { format: 'usd' }],
    ['Lei', SAMPLE, { format: 'ron' }],
    ['Percent', '0.1925', { format: 'percent' }],
    ['More decimals', SAMPLE, { format: 'number', decimals: 4 }],
    ['Fewer decimals', SAMPLE, { format: 'eur', decimals: 0 }],
  ]],
  ['Cell formatting', [
    ['Bold', 'Bold', { bold: true }],
    ['Italic', 'Italic', { italic: true }],
    ['Underline', 'Underline', { underline: true }],
    ['Number aligned left', '42', { align: 'left' }],
    ['Centred', 'centre', { align: 'center' }],
    ['Text aligned right', 'right', { align: 'right' }],
    ['Text colour', 'red text', { color: '#c00000' }],
    ['Fill colour', 'yellow fill', { fill: '#fff2a8' }],
    ['Combined', '-1500', { bold: true, italic: true, color: '#c00000', fill: '#fde9e7', format: 'eur' }],
  ]],
  ['Errors (shown on purpose)', [
    [ERROR_LABEL + 'division by zero', '=1/0'],
    [ERROR_LABEL + 'unknown function', '=NOPE(1)'],
    [ERROR_LABEL + 'text used as a number', '="x"*2'],
    [ERROR_LABEL + 'formula that cannot be read', '=1+'],
    [ERROR_LABEL + 'formula that refers to itself', (row) => '=B' + row + '+1'],
    [ERROR_LABEL + 'reference to a deleted cell', '=#REF!+1'],
  ]],
  ['Try it yourself', [
    ['Select D9 and drag the small square at its corner to the right: the formula is copied'],
    ['Click row header 6, then +Row: the balance still adds up'],
    ['Copy B13 (Ctrl+C), select a few cells, paste (Ctrl+V); undo with Ctrl+Z'],
    ['Drag the border between column headers to resize; double-click it to fit'],
    ['Select D4:D8 and read Sum, Average and Count at the bottom right'],
  ]],
];

function build() {
  const sheet = new Sheet();
  const put = (key, raw, style) => {
    sheet.setRaw(key, raw);
    if (style) sheet.setStyle(key, style);
  };
  const headingRow = (row, titles) => LEDGER_COLUMNS.forEach((column, index) => put(column + row, titles[index] ?? '', HEADING));

  put('A1', 'All features - a demo of each (open this file with the Open button)', { bold: true });
  headingRow(LEDGER_FIRST_ROW - 1, ['Date', 'Description', 'Category', 'Amount']);
  LEDGER.forEach((entry, index) => {
    entry.forEach((raw, column) => put(LEDGER_COLUMNS[column] + (LEDGER_FIRST_ROW + index), raw));
    sheet.setStyle('D' + (LEDGER_FIRST_ROW + index), MONEY);
  });
  let row = LEDGER_FIRST_ROW + LEDGER.length;
  put('A' + row, 'Balance', { bold: true });
  put('D' + row, `=SUM(D${LEDGER_FIRST_ROW}:D${row - 1})`, { ...MONEY, bold: true });

  for (const [title, demos] of SECTIONS) {
    row += 2;
    headingRow(row, [title]);
    for (const [label, content = '', style] of demos) {
      row += 1;
      put('A' + row, label);
      put('B' + row, typeof content === 'function' ? content(row) : content, style);
    }
  }
  COLUMN_WIDTHS.forEach((width, col) => sheet.setColWidth(col, width));
  return sheet.serialize();
}

if (require.main === module) {
  fs.writeFileSync(DEMO_FILE, build());
  console.log('written ' + DEMO_FILE);
}

module.exports = { build, DEMO_FILE, ERROR_LABEL };
