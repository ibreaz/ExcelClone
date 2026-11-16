# ExcelClone - a minimal spreadsheet in the browser

A small spreadsheet for basic accounting and basic formatting. Open `index.html` in a browser (double-click, no server, no install). Everything is written from scratch in plain HTML/CSS/JavaScript: no libraries, no code taken from other projects. Eight batches are done and tested; what is left is in `TODO.md`.

## What it can do

Type numbers, text and formulas into a 26 x 100 grid, format the cells, copy formulas around, undo mistakes and save the sheet to a file. The sheet is also kept in the browser automatically, so it is still there after a reload.

### Details

- Formulas start with `=`: `+ - * / ^ %`, comparisons `= <> < > <= >=`, text joining `&`, parentheses, cell references (`A1`, `$A$1`) and ranges (`A1:B5`).
- Functions: `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `COUNTA`, `ROUND`, `ABS`, `IF`, `AND`, `OR`, `NOT`, `SUMIF`, `COUNTIF`, `TODAY`, `DATE`, `YEAR`, `MONTH`, `DAY`. Arguments are separated by `,` or `;`.
- `SUMIF(range, criterion, [sum range])` and `COUNTIF(range, criterion)`: the criterion is a number, a text (`"Food"`, upper/lower case ignored) or a comparison in quotes (`">100"`, `"<>Food"`). No wildcards.
- Dates: type `2026-12-31` or `31.12.2026` and the cell becomes a date. Dates can be compared and subtracted (result in days), and days can be added; give a formula cell that results in a date one of the two date formats from the format list.
- Fill handle: drag the small square at the bottom-right corner of the selection down or right to copy it, with formula references moving along. It copies; it does not continue a series such as 1, 2, 3.
- Errors shown in the cell: `#DIV/0!`, `#NAME?` (unknown function), `#VALUE!` (text used as a number), `#CYCLE!` (formulas referring to each other), `#ERROR!` (formula cannot be read), `#REF!` (reference pushed off the sheet by a paste).
- Formatting: bold, italic, underline, alignment, text and fill colour, number formats (thousands separator, EUR, USD, lei, percent, two date formats), more/fewer decimals, clear format.
- Column widths: drag the right border of a column header; double-click it to fit the longest content. Widths are saved with the sheet and can be undone.
- Rows and columns: click a header to select the whole row or column (Shift+click for several). `+Row`/`+Col` insert as many as are selected, before the selection; `-Row`/`-Col` delete the selected ones. Formulas keep pointing at the same data, a range shrinks when part of it is deleted, and a formula whose cell is deleted shows `#REF!`.
- Status bar: sum, average and count of the selected numbers.
- Keys: arrows move, Shift+arrows select, Enter/Tab confirm and move, arrows also confirm and move after typing into a cell (after F2 or a double-click, left/right move the text cursor instead), F2 or double-click edits, Esc cancels, Delete empties, Ctrl+B/I/U format, Ctrl+C/X/V copy/cut/paste, Ctrl+Z/Y undo/redo.
- Paste: a formula copied here has its references moved (`$` pins a column or row) and brings its formatting; select a larger area before pasting to fill it (e.g. copy one total, paste over a whole row). Tab-separated text from other programs can be pasted in.
- Files: Save downloads `sheet.json` (formulas + formatting), Open reads it back, CSV downloads the computed values.

## Demo file with all features

`demo/all-features.json` is one sheet with a small ledger and a demo of every feature: open it with the Open button. It is generated, and the tests fail when it falls behind, so it always covers everything.

### Details

- Source: `demo/build-demo.js`. After adding a feature, add its demo there and run `node demo/build-demo.js`.
- `node tests/run.js` checks that the file matches its builder, that every function, number format and kind of cell formatting is used in it, and that every error code is shown, only in the rows labelled `Error:`.
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

## How it is tested

All three test sets pass: 26 model tests and 14 tests that drive the page in a simulated browser. The 10 checks in a real headless Chromium (typing, mouse drag, editor position, Ctrl+C/V/Z, reload, scrolling, column resize and fit) last passed on batch K1; batches K2-K5 have not been run in a real browser, because the sandbox of the new project has no Docker with a screenshot in `tests/out/sheet.png`.

### Details

- I1 - model (formulas, formats, reference shifting), needs only Node: `node tests/run.js`
- I2 - the page itself, driven in jsdom (a test-only tool, not part of the app): `npm i jsdom` in any scratch folder, then `NODE_PATH=<that folder>/node_modules node tests/ui-smoke.js`. The "could not be saved" warnings there are jsdom refusing browser storage for local files; real browsers allow it.
- I3 - real Chromium through Playwright (test-only), in the sandbox Docker sidecar. The container `excelclone-browser` (image `mcr.microsoft.com/playwright:v1.49.0-noble`, this folder mounted at `/app`, `playwright@1.49.0` installed in `/tools`) is kept stopped between uses (it mounted the old folder `TODO/!Fixes/ExcelClone`, so it has to be recreated for this one): `docker start excelclone-browser && docker exec excelclone-browser sh -c 'NODE_PATH=/tools/node_modules node /app/tests/browser-check.js'; docker stop excelclone-browser`

## Code layout

Four small scripts, loaded in this order; only the last one touches the page.

### Details

- `js/formula.js` - tokenizer, parser, evaluator, functions, reference shifting.
- `js/sheet.js` - cell content and style, computed values, cycle detection, save/load.
- `js/format.js` - number formats.
- `js/ui.js` - grid, selection, editor, toolbar, clipboard, undo, files.
