# ExcelClone - TODO

Batches H1-H3 and K1-K5 are done (see `README.md`). It was checked in a real headless Chromium (README -> How it is tested -> I3). Next are the batches below, most useful for accounting first. Each one is small and leaves the page working.

## Check first

- [x] J1 - headless Chromium: grid and toolbar look right, drag-selecting works, the in-cell editor sits on the cell, reload keeps the sheet.
- [ ] J3 - rerun `tests/browser-check.js` in a real browser for K2-K5 (needs Docker in the sandbox, or do J2 by hand: header click, +Row, -Row, +Col, -Col).
- [ ] J2 - a quick look in your own browser on Windows (fonts and the colour pickers differ per browser).

## Next batches

Rule for every batch: add a demo of the new feature to `demo/build-demo.js` and regenerate `demo/all-features.json` (README -> Demo file with all features).

- [ ] K9 - fill handle continues a series (1, 2, 3; dates) and fills up/left.
- [ ] K10 - a formula that results in a date picks up the date format by itself; dates inside `SUMIF`/`COUNTIF` criteria.

- [x] K1 - column widths: drag a column border to resize, double-click to fit.
- [x] K2 - select a whole row/column by clicking its header; insert and delete rows/columns with formulas following.
- [x] K3 - fill handle: drag the corner of the selection to copy it down/right.
- [x] K4 - dates: type `2026-11-16` or `16.11.2026`, date formats, `TODAY`, `DATE`, `YEAR`, `MONTH`, `DAY`.
- [x] K5 - `SUMIF`, `COUNTIF`, `COUNTA`, `AND`, `OR`, `NOT`.
- [ ] K6 - borders (e.g. a line above a total) and negative numbers in red.
- [ ] K7 - several sheets (tabs) with references between them.
- [ ] K8 - CSV import; printing layout.

## Known limits

- Fixed size: 26 columns x 100 rows. Rows or columns pushed past the edge by an insert are not shown, but are kept and come back when rows/columns are deleted again.
- Every change recomputes and repaints the whole sheet - fine at this size, to revisit if the grid grows.
- A typed number must use `.` for decimals and no thousands separator (`1234.5`, not `1.234,5` or `10%`).
- Copy puts the formulas, not the results, on the system clipboard.
