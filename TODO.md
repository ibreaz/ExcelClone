# ExcelClone - TODO

Batches H1-H3 and K1 are done (see `README.md`). It was checked in a real headless Chromium (README -> How it is tested -> I3). Next are the batches below, most useful for accounting first. Each one is small and leaves the page working.

## Check first

- [x] J1 - headless Chromium: grid and toolbar look right, drag-selecting works, the in-cell editor sits on the cell, reload keeps the sheet.
- [ ] J2 - a quick look in your own browser on Windows (fonts and the colour pickers differ per browser).

## Next batches

- [x] K1 - column widths: drag a column border to resize, double-click to fit.
- [ ] K2 - select a whole row/column by clicking its header; insert and delete rows/columns with formulas following.
- [ ] K3 - fill handle: drag the corner of a cell to copy a formula down/right (today: copy, select the area, paste).
- [ ] K4 - dates: type `2026-11-16`, date format, `TODAY()`.
- [ ] K5 - more functions as needed: `SUMIF`, `COUNTIF`, `COUNTA`, `AND`, `OR`, `NOT`.
- [ ] K6 - borders (e.g. a line above a total) and negative numbers in red.
- [ ] K7 - several sheets (tabs) with references between them.
- [ ] K8 - CSV import; printing layout.

## Known limits

- Fixed size: 26 columns x 100 rows.
- Every change recomputes and repaints the whole sheet - fine at this size, to revisit if the grid grows.
- A typed number must use `.` for decimals and no thousands separator (`1234.5`, not `1.234,5` or `10%`).
- Copy puts the formulas, not the results, on the system clipboard.
