# ExcelClone - TODO

Batches H1-H3, K1-K13 and text overflow are done (see `README.md`). It was checked in a real headless Chromium (README -> How it is tested -> I3). Next are the batches below, most useful for accounting first. Each one is small and leaves the page working.

## Check first

- [x] J1 - headless Chromium: grid and toolbar look right, drag-selecting works, the in-cell editor sits on the cell, reload keeps the sheet.
- [x] J3 - everything rerun in a real headless Chromium (`sh tests/browser.sh`, README -> How it is tested -> I3).
- [ ] J2 - a quick look in your own browser on Windows (fonts and the colour pickers differ per browser).

## Next batches

Rule for every batch: add a demo of the new feature to `demo/build-demo.js`, bring its list of limits (`LIMIT_ROWS`) up to date, and regenerate `demo/all-features.json` (README -> Demo file with all features).

- [x] K9 - fill handle continues a series (1, 2, 3; dates) and fills up/left.
- [x] K10 - a formula that results in a date picks up the date format by itself; dates inside `SUMIF`/`COUNTIF` criteria.

- [x] K1 - column widths: drag a column border to resize, double-click to fit.
- [x] K2 - select a whole row/column by clicking its header; insert and delete rows/columns with formulas following.
- [x] K3 - fill handle: drag the corner of the selection to copy it down/right.
- [x] K4 - dates: type `2026-11-16` or `16.11.2026`, date formats, `TODAY`, `DATE`, `YEAR`, `MONTH`, `DAY`.
- [x] K5 - `SUMIF`, `COUNTIF`, `COUNTA`, `AND`, `OR`, `NOT`.
- [x] K6 - borders (e.g. a line above a total) and negative numbers in red.
- [x] K7 - several sheets (tabs) with references between them.
- [x] K8 - CSV import; printing layout.
- [x] K11 - numbers too wide for their cell show `####`; the grid lines under text that runs over neighbours are hidden.
- [x] K12 - sheet names with spaces; reorder tabs; copy a sheet.
- [x] K13 - print options: page breaks, repeat row 1, landscape.

Nothing else is planned. Candidates, if wanted: wrap text and row heights, sorting, freeze the header row, find and replace, more functions (text, lookups).

## Known limits

The one list of limits is the `Limits` sheet of `demo/all-features.json`, generated from `LIMIT_ROWS` in `demo/build-demo.js`. Every batch updates it: a limit that is gone is removed, a new one is added.
