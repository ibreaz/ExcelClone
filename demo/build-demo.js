/*
 * Builds the demo workbook, which shows every feature and lists every known limit:
 * demo/all-features.json to open as a file, and demo/all-features.js, the same content as a script,
 * which the page loads to show the demo on a first start (a page opened from disk cannot read a .json file).
 * After adding a feature, add a demo of it here, bring LIMITS up to date (a limit that is gone is removed,
 * a new one is added) and run: node demo/build-demo.js
 * (tests/run.js fails while a function, number format or kind of formatting is missing from the demo).
 */
'use strict';
const fs = require('fs');
const path = require('path');
require('../js/formula.js');
require('../js/sheet.js');
require('../js/workbook.js');
const { Workbook } = globalThis.XL;

const DEMO_FILE = path.join(__dirname, 'all-features.json');
const DEMO_SCRIPT = path.join(__dirname, 'all-features.js');
const ERROR_LABEL = 'Error: ';
const HEADING = { bold: true, fill: '#dbeef6' };
const MONEY = { format: 'eur' };
const FEATURES = 'Features';
const SUMMARY = 'Summary 2026';
const PAGE_BREAK_AT = 'Number formats'; // the section a new printed page starts with
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
    ['A date plus 30 days, shown day first', '=A4+30', { format: 'date-dmy' }],
    ['A formula with a date is shown as a date by itself', '=A4+7'],
    ['SUMIF with a date in the criterion', '=SUMIF(A4:A8, ">=2026-01-10", D4:D8)', MONEY],
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
    ['A number too wide for its cell shows #### (widen column B)', '123456789012345678', { format: 'number', decimals: 6 }],
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
    ['Long text runs on over the empty cells beside it', 'This text is longer than its cell and continues to the right until a filled cell'],
  ]],
  ['Borders and red negative numbers', [
    ['Line above (a total)', '1907.25', { border: 'top', format: 'eur' }],
    ['Line below', 'underlined cell', { border: 'bottom' }],
    ['Lines above and below', '1907.25', { border: 'top-bottom', format: 'eur', bold: true }],
    ['Box', 'boxed', { border: 'box', align: 'center' }],
    ['Negative number in red', '-250', { negativeRed: true, format: 'eur' }],
    ['The same format on a positive number', '250', { negativeRed: true, format: 'eur' }],
  ]],
  ['Names (type a name in the box left of fx to name the selected cells)', [
    ['A name for a range: Amounts is D4:D8', '=SUM(Amounts)', MONEY],
    ['A name for one cell: Balance is D9', '=Balance*19%', MONEY],
  ]],
  ['Queries (more on the Tables sheet)', [
    ['SQL over an area; the result fills the cells below', '=SQL("select Category, sum(Amount) as Total from A3:D8 group by Category order by Total")'],
    ['', ''],
    ['', ''],
    ['', ''],
  ]],
  ['Several sheets (tabs at the bottom)', [
    [`A cell of another sheet: '${SUMMARY}'!B3`, `='${SUMMARY}'!B3`, MONEY],
    ['A range of another sheet', `=SUM('${SUMMARY}'!B4:B5)`, MONEY],
  ]],
  ['Errors (shown on purpose)', [
    [ERROR_LABEL + 'division by zero', '=1/0'],
    [ERROR_LABEL + 'unknown function', '=NOPE(1)'],
    [ERROR_LABEL + 'text used as a number', '="x"*2'],
    [ERROR_LABEL + 'formula that cannot be read', '=1+'],
    [ERROR_LABEL + 'formula that refers to itself', (row) => '=B' + row + '+1'],
    [ERROR_LABEL + 'reference to a deleted cell', '=#REF!+1'],
    [ERROR_LABEL + 'query that cannot be run (hover the cell to read why)', '=SQL("select Price from A3:D8")'],
    [ERROR_LABEL + 'query result with a filled cell in its way', '=SQL("select Date, Amount from A3:D8")', undefined, 'in the way'],
  ]],
  ['Try it yourself', [
    ['Select D9 and drag the small square at its corner to the right: the formula is copied'],
    ['Type 1 and 2 in two cells, select both and drag the square: 3, 4, 5 follow (up and left work too)'],
    ['Drag the square of a date cell: the days follow one by one'],
    ['Click row header 6, then Edit > Insert rows above: the balance still adds up'],
    ['Copy B13 (Ctrl+C), select a few cells, paste (Ctrl+V); undo with Ctrl+Z'],
    ['Drag the border between column headers to resize; double-click it to fit'],
    ['Select D4:D8 and read Sum, Average and Count at the bottom right'],
    ['Open the other tab; Rename this sheet and see its formulas follow; Copy it; move it with the arrows'],
    ['Print preview (Ctrl+P): row 1 is on every page and page 2 starts at Number formats (dashed line)'],
    ['The other sheets print sideways (see their Print menu); File > New workbook starts empty'],
    ['File > Open file, pick demo/sample.csv: it arrives as a new sheet'],
    ['File > Export this sheet as TSV keeps the formulas; open the .tsv again and they still work'],
    ['Copy cells here and paste them into a text editor: tab separated text with the formulas'],
    ['Select D4:D8: the box left of fx says Amounts. Type B7 or a name there to go to it'],
    ['Print: only the used part of the sheet is printed, without the grid'],
  ]],
];

const LIMITS = 'Limits';
const TABLES = 'Tables';
// Every known limit, as [area, limit]. Keep it current: it is the one list of limits (README and TODO point here).
const LIMIT_ROWS = [
  ['Size', 'Each sheet has 26 columns (A-Z) and 100 rows. Cells pushed past the edge by an insert are hidden, not lost.'],
  ['Size', 'Row heights are fixed; there is no wrapped text and no merged cells.'],
  ['Typing', 'Numbers use . for decimals and no thousands separator: 1234.5, not 1.234,5. Type =10% for a percentage.'],
  ['Typing', 'Dates are typed as 2026-12-31 or 31.12.2026 only. There are no times of day.'],
  ['Typing', 'References to another sheet are typed (Sheet2!A1); they cannot be picked with the mouse.'],
  ['Formulas', 'Only the functions shown on the Features sheet. No text functions, no lookups (a query with JOIN does that job).'],
  ['Names', 'A name is one word and belongs to the whole workbook. Names do not move when their cells are cut and pasted elsewhere.'],
  ['Queries', 'SELECT only: columns, expressions, AS, DISTINCT, JOIN ... ON (inner), WHERE, GROUP BY, ORDER BY, LIMIT; SUM COUNT AVG MIN MAX.'],
  ['Queries', 'No LEFT JOIN, HAVING, subqueries, UNION, IN, BETWEEN, or text and date functions.'],
  ['Queries', 'The first row of a table is its column names. A name with a space is written [like this].'],
  ['Queries', 'The cell must hold only the query: =SQL(...) cannot be part of a bigger formula.'],
  ['Queries', 'A query can read the result of a query entered before it, not of one entered after it.'],
  ['Queries', 'Every change reruns every query; fine for tables of a few hundred rows.'],
  ['Formulas', 'SUMIF and COUNTIF have no wildcards (* and ?).'],
  ['Formulas', 'A formula gets its date format when it is entered; if the cells it uses become dates later, pick the format by hand.'],
  ['Formulas', 'Every change recalculates the whole workbook: fine at this size.'],
  ['Fill handle', 'Continues only even steps (1, 2, 3 or 10, 20, 30; dates by a fixed number of days). No month or weekday names.'],
  ['Long content', 'Only left-aligned text runs over empty neighbours. A number that does not fit shows ####; hover to read it.'],
  ['Formatting', 'One border style: a thin dark line. A border choice applies to every selected cell, not to the outline of the block.'],
  ['Formatting', 'Currencies: euro, dollar and lei only. One font and one text size.'],
  ['Sheets', "A sheet name cannot contain ' ! or \"."],
  ['Clipboard', 'Copy puts formulas, not results, on the system clipboard. Paste from another program brings text only.'],
  ['Files', 'Saves to this browser and to .json files. No .xlsx. CSV numbers with decimal commas arrive as text.'],
  ['Files', 'TSV keeps formulas but no formatting, names or column widths, and holds one sheet.'],
  ['Print', 'Paper size and margins are chosen in the print dialog of the browser. Landscape is a hint that some browsers ignore.'],
  ['Print', 'Only row 1 can repeat on every page.'],
  ['Undo', 'The last 100 steps, forgotten when the page is reloaded.'],
  ['Not there', 'Charts, sorting, filters, frozen panes, comments, find and replace, several users at once.'],
];
const LIMIT_WIDTHS = [110, 760];

function buildLimits(sheet) {
  const put = putter(sheet);
  put('A1', 'Known limits - updated with every change', { bold: true });
  put('A3', 'Area', HEADING);
  put('B3', 'Limit', HEADING);
  LIMIT_ROWS.forEach(([area, limit], index) => {
    put('A' + (index + 4), area);
    put('B' + (index + 4), limit);
  });
  LIMIT_WIDTHS.forEach((width, col) => sheet.setColWidth(col, width));
  sheet.setPrintOption('landscape', true);
}

const SUMMARY_ROWS = [
  ['Balance', `=${FEATURES}!D9`, { ...MONEY, bold: true, border: 'top-bottom' }],
  ['Food', `=SUMIF(${FEATURES}!C4:C8, "Food", ${FEATURES}!D4:D8)`, { ...MONEY, negativeRed: true }],
  ['Housing', `=SUMIF(${FEATURES}!C4:C8, "Housing", ${FEATURES}!D4:D8)`, { ...MONEY, negativeRed: true }],
  ['Income', `=SUMIF(${FEATURES}!D4:D8, ">0")`, { ...MONEY, negativeRed: true }],
];

const putter = (sheet) => (key, raw, style) => {
  sheet.setRaw(key, raw);
  if (style) sheet.setStyle(key, style);
};

function buildSummary(sheet) {
  const put = putter(sheet);
  put('A1', `Summary - every number here comes from the ${FEATURES} sheet`, { bold: true });
  SUMMARY_ROWS.forEach(([label, formula, style], index) => {
    put('A' + (index + 3), label);
    put('B' + (index + 3), formula, style);
  });
  sheet.setColWidth(1, COLUMN_WIDTHS[1]);
  sheet.setPrintOption('landscape', true);
}

function build() {
  const book = new Workbook();
  book.rename(0, FEATURES);
  buildFeatures(book.active);
  buildSummary(book.add(SUMMARY));
  buildTables(book.add(TABLES));
  buildLimits(book.add(LIMITS));
  book.select(0);
  return book.serialize();
}

function buildFeatures(sheet) {
  const put = putter(sheet);
  const headingRow = (row, titles) => LEDGER_COLUMNS.forEach((column, index) => put(column + row, titles[index] ?? '', HEADING));

  put('A1', 'All features - a demo of each (File > Open the demo workbook brings this back)', { bold: true });
  headingRow(LEDGER_FIRST_ROW - 1, ['Date', 'Description', 'Category', 'Amount']);
  LEDGER.forEach((entry, index) => {
    entry.forEach((raw, column) => put(LEDGER_COLUMNS[column] + (LEDGER_FIRST_ROW + index), raw));
    sheet.setStyle('D' + (LEDGER_FIRST_ROW + index), { ...MONEY, negativeRed: true });
  });
  let row = LEDGER_FIRST_ROW + LEDGER.length;
  put('A' + row, 'Balance', { bold: true });
  put('D' + row, `=SUM(D${LEDGER_FIRST_ROW}:D${row - 1})`, { ...MONEY, bold: true, border: 'top' });

  for (const [title, demos] of SECTIONS) {
    row += 2;
    headingRow(row, [title]);
    if (title === PAGE_BREAK_AT) sheet.togglePageBreak(row - 1);
    for (const [label, content = '', style, beside = ''] of demos) {
      row += 1;
      put('A' + row, label);
      put('C' + row, beside);
      put('B' + row, typeof content === 'function' ? content(row) : content, style);
    }
  }
  COLUMN_WIDTHS.forEach((width, col) => sheet.setColWidth(col, width));
  sheet.setPrintOption('repeatHeader', true);
  sheet.book.defineName('Amounts', sheet, { from: { col: 3, row: 3 }, to: { col: 3, row: 7 } });
  sheet.book.defineName('Balance', sheet, { from: { col: 3, row: 8 }, to: { col: 3, row: 8 } });
}

const CLIENTS = [['id', 'client'], ['1', 'Acme'], ['2', 'Borealis'], ['3', 'Cetus']];
const ORDERS = [
  ['nr', 'client_id', 'date', 'amount'],
  ['1001', '1', '2026-01-05', '1200'],
  ['1002', '2', '2026-01-09', '450'],
  ['1003', '1', '2026-01-17', '300'],
  ['1004', '3', '2026-02-02', '980'],
  ['1005', '2', '2026-02-11', '150'],
  ['1006', '1', '2026-02-20', '640'],
];
const ORDERS_ROOM = 7; // the Orders name covers empty rows too, so new orders typed below are part of the table
const TABLE_TOP = 3; // row of the column names
// [cell, what it shows, the query]
const QUERIES = [
  ['A13', 'Total per client: two tables joined, grouped and ordered',
    '=SQL("select client, count(*) as orders, sum(amount) as total from Orders o join Clients c on o.client_id = c.id group by client order by total desc")'],
  ['E13', 'Orders from the date in H13 on, largest first (? takes the value after the query)',
    '=SQL("select nr, date, amount from Orders where date >= ? order by amount desc", H13)'],
  ['A20', 'A query over an area instead of a name',
    '=SQL("select count(*) as orders, max(amount) as largest, avg(amount) as average from D3:G9")'],
  ['E20', 'Clients whose name has an e, with LIKE',
    `=SQL("select client from Clients where client like '%e%' order by client")`],
];

function buildTables(sheet) {
  const put = putter(sheet);
  const table = (rows, firstColumn, columnStyle = {}) => rows.forEach((cells, line) => cells.forEach((raw, i) => {
    const column = String.fromCharCode(firstColumn.charCodeAt(0) + i);
    put(column + (TABLE_TOP + line), raw, line === 0 ? HEADING : columnStyle[cells.length - 1 === i ? 'last' : 'other']);
  }));
  put('A1', 'Two tables on one sheet, and live queries over them (violet; the darker cell holds the query): change a number, add an order in row 10', { bold: true });
  put('A2', 'Clients (named Clients)', { italic: true });
  put('D2', 'Orders (named Orders)', { italic: true });
  table(CLIENTS, 'A');
  table(ORDERS, 'D', { last: MONEY });
  sheet.book.defineName('Clients', sheet, { from: { col: 0, row: TABLE_TOP - 1 }, to: { col: 1, row: TABLE_TOP + CLIENTS.length - 2 } });
  sheet.book.defineName('Orders', sheet, { from: { col: 3, row: TABLE_TOP - 1 }, to: { col: 6, row: TABLE_TOP + ORDERS_ROOM } });
  put('G13', 'From:', { align: 'right' });
  put('H13', '2026-01-15', { fill: '#fff2a8' });
  QUERIES.forEach(([cell, title, query]) => {
    const row = Number(cell.slice(1));
    put(cell[0] + (row - 1), title, { bold: true });
    put(cell[0] + (row + 1), query);
  });
  sheet.setColWidth(0, 130);
}

/** The demo as a script that hands the workbook text to the page. */
function buildScript() {
  return `/* Generated by build-demo.js - do not edit. */\n(window.XL = window.XL || {}).DEMO = ${JSON.stringify(build())};\n`;
}

if (require.main === module) {
  fs.writeFileSync(DEMO_FILE, build());
  fs.writeFileSync(DEMO_SCRIPT, buildScript());
  console.log('written ' + DEMO_FILE + ' and ' + DEMO_SCRIPT);
}

module.exports = { build, buildScript, DEMO_FILE, DEMO_SCRIPT, ERROR_LABEL, FEATURES, LIMITS };
