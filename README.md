# ExcelClone - a minimal spreadsheet in the browser

A small spreadsheet for basic accounting and basic formatting. Open `index.html` in a browser (double-click, no server, no install). Everything is written from scratch in plain HTML/CSS/JavaScript: no libraries, no code taken from other projects. All planned batches are done and tested; what it cannot do is listed on the `Limits` sheet of the demo file.

## What it can do

On a first start the page shows the demo workbook; after that it shows your own work, kept in the browser. Everything is in five menus: File, Edit, Format, Sheet and Print.

Type numbers, text and formulas into a 26 x 100 grid, format the cells, copy formulas around, undo mistakes and save the sheet to a file. The sheet is also kept in the browser automatically, so it is still there after a reload.

### Details

- Formulas start with `=`: `+ - * / ^ %`, comparisons `= <> < > <= >=`, text joining `&`, parentheses, cell references (`A1`, `$A$1`) and ranges (`A1:B5`).
- Functions: `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `COUNTA`, `ROUND`, `ABS`, `IF`, `AND`, `OR`, `NOT`, `SUMIF`, `COUNTIF`, `TODAY`, `DATE`, `YEAR`, `MONTH`, `DAY`. Arguments are separated by `,` or `;`.
- `SUMIF(range, criterion, [sum range])` and `COUNTIF(range, criterion)`: the criterion is a number, a text (`"Food"`, upper/lower case ignored) or a comparison in quotes (`">100"`, `"<>Food"`). No wildcards.
- Dates: type `2026-12-31` or `31.12.2026` and the cell becomes a date. Dates can be compared and subtracted (result in days), and days can be added; a formula that results in a date (a date plus days, `TODAY()`, `MAX` of dates...) is shown as a date by itself. `SUMIF`/`COUNTIF` take a date in the criterion: `">=2026-01-31"`.
- Fill handle: drag the small square at the bottom-right corner of the selection in any direction to copy it, with formula references moving along. Two or more numbers with an even step continue as a series (1, 2 -> 3, 4), dates too, and a single date continues day by day.
- Errors shown in the cell: `#DIV/0!`, `#NAME?` (unknown function), `#VALUE!` (text used as a number), `#CYCLE!` (formulas referring to each other), `#ERROR!` (formula cannot be read), `#REF!` (reference pushed off the sheet by a paste).
- Colours are applied while you pick them, so you see the result at once; the colour boxes in the Format menu show the colours of the active cell.
- Formatting: bold, italic, underline, alignment, text and fill colour, number formats (thousands separator, EUR, USD, lei, percent, two date formats), more/fewer decimals, clear format.
- Column widths: drag the right border of a column header; double-click it to fit the longest content. Widths are saved with the sheet and can be undone.
- Rows and columns: click a header to select the whole row or column (Shift+click for several). The Edit menu inserts as many rows or columns as are selected, before the selection, or deletes the selected ones. Formulas keep pointing at the same data, a range shrinks when part of it is deleted, and a formula whose cell is deleted shows `#REF!`.
- Long text: text wider than its cell runs on over the empty cells to its right and stops at the next filled (or coloured) cell. The grid lines under it are hidden. A number that does not fit shows `####` (hover to read it); centred or right-aligned text is cut at the cell edge.
- Borders: the border list draws a line above, below, above and below, or a box around each selected cell. The `-1` button shows negative numbers in red.
- Several sheets: tabs at the bottom; `+` adds a sheet; the Sheet menu copies, renames, deletes and moves the one shown. A formula uses another sheet as `Summary!B3` or `SUM(Jan!A1:A9)`, with quotes when the name is not a plain word: `'Year 2026'!B3`. Renaming a sheet updates the formulas that use it; deleting it leaves `#REF!` in them.
- CSV import: `File > Open file` also takes a `.csv` file (`,` or `;` separated) and adds it as a new sheet named after the file.
- Print: `Print > Print...` (or Ctrl+P) prints the sheet shown without toolbars, headers and grid lines, and only up to the last used row and column. Borders and fill colours are printed. The Print menu also holds the print settings of the sheet shown: print sideways, repeat row 1 on every printed page, and start a new printed page at the row of the active cell (shown as a dashed line). They change nothing on screen except that dashed line.
- Status bar: sum, average and count of the selected numbers.
- Keys: arrows move, Shift+arrows select, Enter/Tab confirm and move, arrows also confirm and move after typing into a cell (after F2 or a double-click, left/right move the text cursor instead), F2 or double-click edits, Esc cancels, Delete empties, Ctrl+B/I/U format, Ctrl+C/X/V copy/cut/paste, Ctrl+Z/Y undo/redo.
- Paste: a formula copied here has its references moved (`$` pins a column or row) and brings its formatting; select a larger area before pasting to fill it (e.g. copy one total, paste over a whole row). Tab-separated text from other programs can be pasted in.
- Files: Save downloads `workbook.json` (all sheets, formulas + formatting), Open reads it back (older single-sheet saves too), CSV downloads the computed values of the sheet shown.

## Demo file with all features

The demo workbook is what the page shows on a first start, and `File > Open the demo workbook` brings it back. `demo/all-features.json` is the same workbook as a file. It has three sheets: a small ledger with a demo of every feature, a summary that reads from it, and `Limits`, the list of everything the spreadsheet cannot do. It is generated, and the tests fail when it falls behind, so it always covers everything.

### Details

- `demo/all-features.js` is the same content as a script, which the page loads for the first start: a page opened from disk is not allowed to read a `.json` file by itself. Both files are generated together.
- Source: `demo/build-demo.js`. After adding a feature, add its demo there, update the limits (`LIMIT_ROWS`) and run `node demo/build-demo.js`.
- The `Limits` sheet is the only list of limits; it is updated with every change, so no other document repeats it.
- `node tests/run.js` checks that the file matches its builder, that every function, number format and kind of cell formatting is used in it, and that every error code is shown, only in the rows labelled `Error:`.
- `demo/sample.csv` is a small `;` separated file to try the CSV import with.
- Features that are actions, not cell content (fill handle, insert/delete, copy/paste, resize), are listed in its last section, "Try it yourself".

## Batches

Each batch left the page working and added one group of features.

- H1 - grid, selection, editing, formula engine, automatic saving in the browser.
- H2 - cell formatting and number formats, status bar totals.
- H3 - copy/cut/paste with moving references, undo/redo, Save/Open/CSV.
- K1 - resizable column widths.
- K2 - select whole rows/columns, insert and delete rows/columns with formulas following.
- K3 - fill handle.
- K4 - dates.
- K5 - `SUMIF`, `COUNTIF`, `COUNTA`, `AND`, `OR`, `NOT`.
- K6 - borders and red negative numbers.
- K7 - several sheets with references between them.
- K8 - CSV import and print layout.
- Text overflow - long text runs on over empty neighbours.
- K9 - fill handle continues series and fills in every direction.
- K10 - automatic date format for date formulas; dates in `SUMIF`/`COUNTIF` criteria.
- K11 - `####` for numbers that do not fit; no grid lines under overflowing text.
- K12 - sheet names with spaces, moving and copying sheets.
- K13 - print options.

## How it is tested

All three test sets pass: 42 model tests, 27 tests that drive the page in a simulated browser, and 23 checks in a real headless Chromium, which also saves pictures of the demo, an open menu and the print layout in `tests/out/`.

### Details

- I1 - model (formulas, formats, sheets, CSV, fill series, the demo file), needs only Node: `node tests/run.js`
- I2 - the page itself, driven in jsdom (a test-only tool, not part of the app): `npm i jsdom` in any scratch folder, then `NODE_PATH=<that folder>/node_modules node tests/ui-smoke.js`. jsdom has no layout, so the tests pretend every character is 7px wide. The "no access to saved work" warning there is jsdom refusing browser storage for local files; real browsers allow it.
- I3 - real Chromium through Playwright (test-only): `sh tests/browser.sh`, from the SafeAI sandbox. It covers the demo at first start, typing, mouse selection, the editor position, menus, colours, copy/paste/undo, column resize and fit, the fill handle, inserting rows, sheets, print layout and reload.
- The real browser found what the simulated one could not: the first print layout lost column A. What it cannot do is operate the operating system's colour picker; colours are set through the colour box directly.

## Code layout

Seven small scripts, loaded in this order; only the last one touches the page.

### Details

- `js/formula.js` - tokenizer, parser, evaluator, functions, reference shifting.
- `js/sheet.js` - cell content and style, computed values, cycle detection, save/load.
- `js/format.js` - number formats.
- `js/workbook.js` - the named sheets and saving/loading them together.
- `js/csv.js` - reading and writing CSV.
- `js/fill.js` - continuing a series for the fill handle.
- `js/ui.js` - grid, selection, editor, toolbar, clipboard, undo, files.
