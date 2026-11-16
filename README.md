# ExcelClone - a minimal spreadsheet in the browser

A small spreadsheet for basic accounting and basic formatting. Open `index.html` in a browser (double-click, no server, no install). Everything is written from scratch in plain HTML/CSS/JavaScript: no libraries, no code taken from other projects. Four batches are done and tested; what is left is in `TODO.md`.

## What it can do

Type numbers, text and formulas into a 26 x 100 grid, format the cells, copy formulas around, undo mistakes and save the sheet to a file. The sheet is also kept in the browser automatically, so it is still there after a reload.

### Details

- Formulas start with `=`: `+ - * / ^ %`, comparisons `= <> < > <= >=`, text joining `&`, parentheses, cell references (`A1`, `$A$1`) and ranges (`A1:B5`).
- Functions: `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `ROUND`, `ABS`, `IF`. Arguments are separated by `,` or `;`.
- Errors shown in the cell: `#DIV/0!`, `#NAME?` (unknown function), `#VALUE!` (text used as a number), `#CYCLE!` (formulas referring to each other), `#ERROR!` (formula cannot be read), `#REF!` (reference pushed off the sheet by a paste).
- Formatting: bold, italic, underline, alignment, text and fill colour, number formats (thousands separator, EUR, USD, lei, percent), more/fewer decimals, clear format.
- Column widths: drag the right border of a column header; double-click it to fit the longest content. Widths are saved with the sheet and can be undone.
- Status bar: sum, average and count of the selected numbers.
- Keys: arrows move, Shift+arrows select, Enter/Tab confirm and move, F2 or double-click edits, Esc cancels, Delete empties, Ctrl+B/I/U format, Ctrl+C/X/V copy/cut/paste, Ctrl+Z/Y undo/redo.
- Paste: a formula copied here has its references moved (`$` pins a column or row) and brings its formatting; select a larger area before pasting to fill it (e.g. copy one total, paste over a whole row). Tab-separated text from other programs can be pasted in.
- Files: Save downloads `sheet.json` (formulas + formatting), Open reads it back, CSV downloads the computed values.

## Batches

Each batch left the page working and added one group of features.

- H1 - grid, selection, editing, formula engine, automatic saving in the browser.
- H2 - cell formatting and number formats, status bar totals.
- H3 - copy/cut/paste with moving references, undo/redo, Save/Open/CSV.
- K1 - resizable column widths.

## How it is tested

All three test sets pass: 15 model tests, 6 tests that drive the page in a simulated browser, and 10 checks in a real headless Chromium (typing, mouse drag, editor position, Ctrl+C/V/Z, reload, scrolling, column resize and fit) with a screenshot in `tests/out/sheet.png`.

### Details

- I1 - model (formulas, formats, reference shifting), needs only Node: `node tests/run.js`
- I2 - the page itself, driven in jsdom (a test-only tool, not part of the app): `npm i jsdom` in any scratch folder, then `NODE_PATH=<that folder>/node_modules node tests/ui-smoke.js`. The "could not be saved" warnings there are jsdom refusing browser storage for local files; real browsers allow it.
- I3 - real Chromium through Playwright (test-only), in the sandbox Docker sidecar. The container `excelclone-browser` (image `mcr.microsoft.com/playwright:v1.49.0-noble`, this folder mounted at `/app`, `playwright@1.49.0` installed in `/tools`) is kept stopped between uses: `docker start excelclone-browser && docker exec excelclone-browser sh -c 'NODE_PATH=/tools/node_modules node /app/tests/browser-check.js'; docker stop excelclone-browser`

## Code layout

Four small scripts, loaded in this order; only the last one touches the page.

### Details

- `js/formula.js` - tokenizer, parser, evaluator, functions, reference shifting.
- `js/sheet.js` - cell content and style, computed values, cycle detection, save/load.
- `js/format.js` - number formats.
- `js/ui.js` - grid, selection, editor, toolbar, clipboard, undo, files.
