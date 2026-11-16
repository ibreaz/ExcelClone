/* Grid rendering, selection, editing and the toolbar. */
(function () {
  'use strict';

  const { Workbook, FormulaError, colName, refKey, formatValue, shiftRefs, parseCsv, csvLine, seriesOf, DEFAULT_DECIMALS, BORDER_SIDES, DEMO } = window.XL;

  const ROWS = 100;
  const COLS = 26;
  const MAX_DECIMALS = 10;
  const GENERAL_DECIMALS = 2; // starting point of the decimals buttons on an unformatted cell
  const STORAGE_KEY = 'excelclone.sheet.v1';
  const ARROWS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
  const MAX_UNDO = 100;
  const ROW_HEADER_WIDTH = 44;
  const DEFAULT_COL_WIDTH = 96;
  const MIN_COL_WIDTH = 24;
  const FILL_HANDLE_SIZE = 8;
  const EMPTY_BOOK = '[]'; // a save without cells opens as one empty sheet
  const CSV_FILE = /\.csv$/i;
  const CELL_PADDING = 4; // as in style.css
  const NEGATIVE_COLOR = '#c00000';
  const BORDER_LINE = '1px solid #222';
  const ALL_SIDES = ['Top', 'Right', 'Bottom', 'Left'];
  const COLOUR_INPUTS = { 'text-color': { property: 'color', unset: '#000000' }, 'fill-color': { property: 'fill', unset: '#ffffff' } }; // input id -> style property and what the box shows for a cell without one
  const TOO_WIDE = '####'; // shown for a number that does not fit its cell
  const PRINT_OPTIONS = { 'landscape': 'landscape', 'repeat-header': 'repeatHeader' }; // checkbox id -> sheet print option
  const LANDSCAPE_PAGE = '@page { size: landscape; }';

  const byId = (id) => document.getElementById(id);
  const grid = byId('grid');
  const table = byId('sheet');
  const editor = byId('editor');
  const formulaBar = byId('formula-bar');
  const toolbar = byId('toolbar');
  const numberFormat = byId('number-format');
  const fillHandle = byId('fill-handle');

  const borderSelect = byId('border');

  const book = new Workbook();
  let sheet = book.active; // the sheet on screen
  let rowHeaderColumn; // the <col> of the row numbers
  const cellElements = []; // [row][col]
  const columnElements = []; // the <col> of each data column
  let resizing = null; // the column border being dragged: { col, startX, startWidth, width }
  let anchor = { col: 0, row: 0 }; // the active cell
  let focus = { col: 0, row: 0 }; // the opposite corner of the selection
  let marked = [];
  let dragging = false;
  let editing = false;
  let pickedProperty = null; // the colour (text or fill) being picked in the open menu
  let filling = null; // the selection the fill handle is being dragged from, as bounds
  let replacing = false; // the edit was started by typing over the cell, not by F2 or a double-click
  let copied = null; // the last copy made here: { text, col, row, rows }
  const undoStack = [];
  const redoStack = [];

  // ---------- table ----------

  function header(text) {
    const th = document.createElement('th');
    th.textContent = text;
    return th;
  }

  function buildTable() {
    const columns = table.appendChild(document.createElement('colgroup'));
    rowHeaderColumn = columns.appendChild(document.createElement('col'));
    const head = table.createTHead().insertRow();
    head.className = 'letters';
    head.appendChild(header(''));
    for (let col = 0; col < COLS; col++) {
      columnElements.push(columns.appendChild(document.createElement('col')));
      const th = head.appendChild(header(colName(col)));
      th.dataset.col = col;
      const resizer = th.appendChild(document.createElement('div'));
      resizer.className = 'resizer';
      resizer.dataset.col = col;
    }
    const body = table.createTBody();
    for (let row = 0; row < ROWS; row++) {
      const tr = body.insertRow();
      tr.appendChild(header(row + 1)).dataset.row = row;
      cellElements.push([]);
      for (let col = 0; col < COLS; col++) {
        const td = tr.insertCell();
        td.dataset.col = col;
        td.dataset.row = row;
        cellElements[row].push(td);
      }
    }
  }

  function borderStyles(border) {
    const lined = BORDER_SIDES[border] ?? [];
    return Object.fromEntries(ALL_SIDES.map((side) => ['border' + side, lined.includes(side) ? BORDER_LINE : '']));
  }

  /** A cell that text from the left may run over: empty and without a fill colour. */
  function isFree(col, row) {
    const key = refKey(col, row);
    return sheet.value(key) === '' && !sheet.style(key).fill;
  }

  /** Lets the text of a cell run on over the free cells to its right, up to the next cell that is not free. */
  function spillText(td, col, row) {
    let end = col + 1;
    while (end < COLS && isFree(end, row)) end++;
    if (end === col + 1) return;
    let width = -2 * CELL_PADDING;
    for (let covered = col; covered < end; covered++) width += savedWidth(covered);
    const box = document.createElement('div');
    box.className = 'spill';
    box.style.width = width + 'px';
    box.appendChild(document.createElement('span')).textContent = td.textContent; // the span is as wide as the text
    td.replaceChildren(box);
    td.classList.add('spilling');
  }

  function paintCell(td, col, row) {
    const key = refKey(col, row);
    const value = sheet.value(key);
    const style = sheet.style(key);
    const isRedNegative = style.negativeRed && typeof value === 'number' && value < 0;
    const isLeftAlignedText = typeof value === 'string' && value !== '' && (style.align ?? 'left') === 'left';
    td.textContent = formatValue(value, style);
    td.classList.remove('spilling', 'covered');
    td.title = '';
    td.classList.toggle('num', typeof value === 'number');
    td.classList.toggle('err', value instanceof FormulaError);
    Object.assign(td.style, {
      fontWeight: style.bold ? 'bold' : '',
      fontStyle: style.italic ? 'italic' : '',
      textDecoration: style.underline ? 'underline' : '',
      textAlign: style.align ?? '',
      color: isRedNegative ? NEGATIVE_COLOR : style.color ?? '',
      backgroundColor: style.fill ?? '',
      ...borderStyles(style.border),
    });
    if (isLeftAlignedText) spillText(td, col, row);
  }

  const rowElement = (row) => cellElements[row][0].parentElement;

  /**
   * Fits what the cells show to the room they have: a number that does not fit becomes #### (its value
   * stays in the tooltip), and the grid lines under text that runs over its neighbours are hidden.
   * Everything is measured before anything is changed, so the browser lays the table out only once.
   */
  function renderOverflow() {
    const cutNumbers = [];
    const spills = [];
    cellElements.forEach((cells, row) => cells.forEach((td, col) => {
      if (td.classList.contains('spilling')) spills.push({ col, row, textWidth: td.querySelector('span').offsetWidth });
      else if (td.classList.contains('num') && td.scrollWidth > td.clientWidth) cutNumbers.push(td);
    }));
    cutNumbers.forEach((td) => {
      td.title = td.textContent;
      td.textContent = TOO_WIDE;
    });
    spills.forEach(hideCoveredLines);
  }

  /** Hides the line between two cells wherever the text of the spilling cell crosses it. */
  function hideCoveredLines({ col, row, textWidth }) {
    let covered = col;
    let room = savedWidth(col) - CELL_PADDING;
    while (textWidth > room && covered + 1 < COLS && isFree(covered + 1, row)) {
      cellElements[row][covered].classList.add('covered');
      covered++;
      room += savedWidth(covered);
    }
  }

  function render() {
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) paintCell(cellElements[row][col], col, row);
      rowElement(row).classList.toggle('page-break', sheet.hasPageBreak(row));
    }
    renderWidths();
    renderOverflow();
    renderTabs();
    renderSelection();
  }

  // ---------- column widths ----------

  const savedWidth = (col) => sheet.colWidth(col) ?? DEFAULT_COL_WIDTH;

  /** widthOf lets a width be shown before it is stored, while a border is dragged or a column is measured. */
  function renderWidths(widthOf = savedWidth, headerWidth = ROW_HEADER_WIDTH) {
    let total = headerWidth;
    rowHeaderColumn.style.width = headerWidth + 'px';
    columnElements.forEach((element, col) => {
      element.style.width = widthOf(col) + 'px';
      total += widthOf(col);
    });
    table.style.width = total + 'px';
  }

  const previewWidth = (col, width) => renderWidths((other) => (other === col ? width : savedWidth(other)));

  function resizerColumn(event) {
    return event.target.classList.contains('resizer') ? Number(event.target.dataset.col) : null;
  }

  function onResizeStart(event) {
    const col = resizerColumn(event);
    if (col === null) return;
    event.preventDefault();
    resizing = { col, startX: event.clientX, startWidth: savedWidth(col) };
  }

  function onResizeMove(event) {
    if (!resizing) return;
    resizing.width = Math.max(MIN_COL_WIDTH, resizing.startWidth + event.clientX - resizing.startX);
    previewWidth(resizing.col, resizing.width);
  }

  function onResizeEnd() {
    if (!resizing) return;
    const { col, width } = resizing;
    resizing = null;
    const wasDragged = width !== undefined;
    if (wasDragged) mutate(() => sheet.setColWidth(col, width));
  }

  /** Makes the column as wide as its widest content; an empty column goes back to the default. */
  function fitColumn(col) {
    const cells = cellElements.map((row) => row[col]);
    if (!cells.some((td) => td.textContent !== '')) {
      mutate(() => sheet.setColWidth(col, undefined));
      return;
    }
    previewWidth(col, MIN_COL_WIDTH); // squeezed, each cell reports the width its content needs
    table.classList.add('measuring');
    const widest = Math.max(MIN_COL_WIDTH, ...cells.map((td) => td.scrollWidth));
    table.classList.remove('measuring');
    const borderWidth = 1;
    mutate(() => sheet.setColWidth(col, widest + borderWidth));
  }

  // ---------- selection ----------

  const activeKey = () => refKey(anchor.col, anchor.row);
  const clamp = (value, max) => Math.max(0, Math.min(max, value));

  function selectionBounds() {
    return {
      col1: Math.min(anchor.col, focus.col), col2: Math.max(anchor.col, focus.col),
      row1: Math.min(anchor.row, focus.row), row2: Math.max(anchor.row, focus.row),
    };
  }

  function selectedCells() {
    const { col1, col2, row1, row2 } = selectionBounds();
    const cells = [];
    for (let row = row1; row <= row2; row++) {
      for (let col = col1; col <= col2; col++) cells.push({ col, row, key: refKey(col, row) });
    }
    return cells;
  }

  function renderSelection() {
    marked.forEach((td) => td.classList.remove('sel', 'active'));
    const cells = selectedCells();
    marked = cells.map(({ col, row }) => cellElements[row][col]);
    marked.forEach((td) => td.classList.add('sel'));
    cellElements[anchor.row][anchor.col].classList.add('active');
    byId('name-box').value = activeKey();
    formulaBar.value = sheet.raw(activeKey());
    placeFillHandle();
    renderToolbar();
    renderStatus(cells);
  }

  /** The fill handle sits on the bottom-right corner of the selection. */
  function placeFillHandle() {
    const { col2, row2 } = selectionBounds();
    const corner = cellElements[row2][col2];
    fillHandle.style.left = corner.offsetLeft + corner.offsetWidth - FILL_HANDLE_SIZE / 2 + 'px';
    fillHandle.style.top = corner.offsetTop + corner.offsetHeight - FILL_HANDLE_SIZE / 2 + 'px';
  }

  function renderToolbar() {
    const style = sheet.style(activeKey());
    toolbar.querySelectorAll('[data-toggle]').forEach((b) => b.classList.toggle('on', Boolean(style[b.dataset.toggle])));
    toolbar.querySelectorAll('[data-align]').forEach((b) => b.classList.toggle('on', style.align === b.dataset.align));
    numberFormat.value = style.format ?? 'general';
    borderSelect.value = style.border ?? 'none';
    Object.entries(COLOUR_INPUTS).forEach(([id, { property, unset }]) => { byId(id).value = style[property] ?? unset; });
    Object.entries(PRINT_OPTIONS).forEach(([id, option]) => { byId(id).checked = sheet.print[option]; });
    byId('page-break').classList.toggle('on', sheet.hasPageBreak(anchor.row));
  }

  function renderStatus(cells) {
    const numbers = cells.map((cell) => sheet.value(cell.key)).filter((value) => typeof value === 'number');
    const parts = [];
    if (numbers.length > 1) {
      const sum = numbers.reduce((total, n) => total + n, 0);
      const show = (n) => formatValue(n, { format: 'number' });
      parts.push(`Sum: ${show(sum)}`, `Average: ${show(sum / numbers.length)}`, `Count: ${numbers.length}`);
    }
    byId('status').replaceChildren(...parts.map((text) => Object.assign(document.createElement('span'), { textContent: text })));
  }

  function moveTo(col, row, extend) {
    focus = { col: clamp(col, COLS - 1), row: clamp(row, ROWS - 1) };
    if (!extend) anchor = { ...focus };
    renderSelection();
    cellElements[focus.row][focus.col].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function moveBy(dCol, dRow, extend) {
    const from = extend ? focus : anchor;
    moveTo(from.col + dCol, from.row + dRow, extend);
  }

  // ---------- changes ----------

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, book.serialize());
    } catch (error) {
      console.warn('The sheet could not be saved in this browser', error);
    }
  }

  function savedWorkbook() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      console.warn('This browser gives no access to saved work', error);
      return null;
    }
  }

  /** Shows the work saved in this browser; on a first start, the demo workbook. */
  function restore() {
    try {
      book.load(savedWorkbook() ?? DEMO ?? EMPTY_BOOK);
    } catch (error) {
      console.warn('The saved workbook could not be read', error);
    }
    sheet = book.active;
  }

  function rememberForUndo() {
    undoStack.push(book.serialize());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
  }

  /** Every change of the sheet goes through here, so it is saved and shown. isNewStep false adds it to the previous undo step. */
  function mutate(change, isNewStep = true) {
    if (isNewStep) rememberForUndo();
    change();
    sheet = book.active;
    save();
    render();
  }

  /** Steps back (or forward again) to a remembered state of the sheet. */
  function timeTravel(from, to) {
    if (from.length === 0) return;
    to.push(book.serialize());
    book.load(from.pop());
    sheet = book.active;
    save();
    render();
  }

  const undo = () => timeTravel(undoStack, redoStack);
  const redo = () => timeTravel(redoStack, undoStack);

  function setActiveRaw(raw) {
    const key = activeKey();
    if (raw !== sheet.raw(key)) mutate(() => sheet.setRaw(key, raw));
  }

  const forSelection = (change) => mutate(() => selectedCells().forEach((cell) => change(cell.key)));
  const applyStyle = (patch) => forSelection((key) => sheet.setStyle(key, patch));

  /**
   * Applies a colour while it is being picked. The colour picker reports every colour the mouse passes,
   * so all of them until the menu closes count as one undo step.
   */
  function pickColour(property, colour) {
    const isSamePick = pickedProperty === property;
    pickedProperty = property;
    mutate(() => selectedCells().forEach((cell) => sheet.setStyle(cell.key, { [property]: colour })), !isSamePick);
  }

  function toggleStyle(property) {
    applyStyle({ [property]: sheet.style(activeKey())[property] ? undefined : true });
  }

  function changeDecimals(delta) {
    const style = sheet.style(activeKey());
    const current = style.decimals ?? DEFAULT_DECIMALS[style.format] ?? GENERAL_DECIMALS;
    applyStyle({ decimals: clamp(current + delta, MAX_DECIMALS) });
  }

  // ---------- editing ----------

  function startEdit(initialText) {
    const td = cellElements[anchor.row][anchor.col];
    editing = true;
    replacing = initialText !== undefined;
    editor.value = initialText ?? sheet.raw(activeKey());
    Object.assign(editor.style, {
      display: 'block',
      left: td.offsetLeft + 'px',
      top: td.offsetTop + 'px',
      minWidth: td.offsetWidth + 'px',
      height: td.offsetHeight + 'px',
    });
    editor.focus();
  }

  function finishEdit(commit) {
    if (!editing) return;
    editing = false;
    editor.style.display = 'none';
    if (commit) setActiveRaw(editor.value);
  }

  /**
   * Where a key pressed in the editor confirms the edit and moves to, if it does. Enter and Tab always do
   * (Shift reverses them). Arrows do after typing over a cell; after F2 or a double-click, left and right
   * move the text cursor instead, so the content can be corrected.
   */
  function editorSteps(event) {
    const sign = event.shiftKey ? -1 : 1;
    const confirming = { Enter: [0, sign], Tab: [sign, 0] }[event.key];
    if (confirming) return confirming;
    const isVertical = event.key === 'ArrowUp' || event.key === 'ArrowDown';
    return replacing || isVertical ? ARROWS[event.key] : undefined;
  }

  function onEditorKey(event) {
    const steps = editorSteps(event);
    if (!steps && event.key !== 'Escape') return;
    event.preventDefault();
    finishEdit(Boolean(steps));
    grid.focus();
    if (steps) moveBy(...steps);
  }

  function onFormulaBarKey(event) {
    if (event.key === 'Escape') formulaBar.value = sheet.raw(activeKey());
    if (event.key !== 'Enter' && event.key !== 'Escape') return;
    grid.focus(); // leaving the bar commits a changed value through its change event
    if (event.key === 'Enter') moveBy(0, 1);
  }

  // ---------- clipboard ----------

  function copyBlock({ col1, col2, row1, row2 } = selectionBounds()) {
    const rows = [];
    for (let row = row1; row <= row2; row++) {
      rows.push([]);
      for (let col = col1; col <= col2; col++) {
        const key = refKey(col, row);
        rows[row - row1].push({ raw: sheet.raw(key), style: sheet.style(key) });
      }
    }
    const text = rows.map((cells) => cells.map((cell) => cell.raw.replace(/[\t\n]/g, ' ')).join('\t')).join('\n');
    return { text, col: col1, row: row1, rows };
  }

  function onCopy(event) {
    if (document.activeElement !== grid) return;
    copied = copyBlock();
    event.clipboardData.setData('text/plain', copied.text);
    event.preventDefault();
    if (event.type === 'cut') forSelection((key) => sheet.setRaw(key, ''));
  }

  /** Text from another program arrives as tab separated lines. */
  function rowsOfText(text) {
    return text.replace(/\r?\n$/, '').split(/\r?\n/).map((line) => line.split('\t').map((raw) => ({ raw })));
  }

  /** Writes one copied cell; a copy made here also brings its formatting and has its formula references moved. */
  function pasteCell(source, from, to) {
    if (to.col >= COLS || to.row >= ROWS) return;
    const key = refKey(to.col, to.row);
    sheet.setRaw(key, from ? shiftRefs(source.raw, to.col - from.col, to.row - from.row) : source.raw);
    if (!source.style) return;
    sheet.clearStyle(key);
    sheet.setStyle(key, source.style);
  }

  /** Pastes at the top-left of the selection; a larger selection is filled by repeating the copied block. */
  function onPaste(event) {
    if (document.activeElement !== grid) return;
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    const isOwnCopy = copied !== null && copied.text === text;
    const rows = isOwnCopy ? copied.rows : rowsOfText(text);
    const { col1, col2, row1, row2 } = selectionBounds();
    const target = { col1, row1, col2: Math.max(col2, col1 + rows[0].length - 1), row2: Math.max(row2, row1 + rows.length - 1) };
    mutate(() => tileBlock(rows, isOwnCopy ? copied : null, target));
  }

  /** Writes the rows of cells over the target bounds, repeating them when the target is larger. origin is where a copy made here came from; start is the cell the first of the rows lands on (the top-left of the target unless given). */
  function tileBlock(rows, origin, target, start = { col: target.col1, row: target.row1 }) {
    const wrap = (offset, length) => ((offset % length) + length) % length; // also for cells before the start
    for (let row = target.row1; row <= target.row2; row++) {
      for (let col = target.col1; col <= target.col2; col++) {
        const sourceRow = wrap(row - start.row, rows.length);
        const sourceCol = wrap(col - start.col, rows[sourceRow].length);
        const from = origin && { col: origin.col + sourceCol, row: origin.row + sourceRow };
        pasteCell(rows[sourceRow][sourceCol], from, { col, row });
      }
    }
  }

  // ---------- fill handle ----------

  /** The bounds to fill when the handle is dragged to the cell: the source grown towards it, in the direction it is furthest away. */
  function fillTarget(source, cell) {
    const grown = {
      down: { distance: cell.row - source.row2, bounds: { ...source, row2: cell.row } },
      up: { distance: source.row1 - cell.row, bounds: { ...source, row1: cell.row } },
      right: { distance: cell.col - source.col2, bounds: { ...source, col2: cell.col } },
      left: { distance: source.col1 - cell.col, bounds: { ...source, col1: cell.col } },
    };
    const furthest = Object.values(grown).reduce((best, way) => (way.distance > best.distance ? way : best));
    return furthest.distance > 0 ? furthest.bounds : source;
  }

  /** Where the source cells form a series (1, 2, 3 or dates), the filled cells continue it instead of repeating it. */
  function continueSeries(block, source, target) {
    const isVertical = target.row1 !== source.row1 || target.row2 !== source.row2;
    const raws = block.rows.map((cells) => cells.map((cell) => cell.raw));
    const lines = isVertical ? raws[0].map((raw, col) => raws.map((row) => row[col])) : raws;
    const [first, last, start] = isVertical ? [target.row1, target.row2, source.row1] : [target.col1, target.col2, source.col1];
    lines.forEach((line, lineIndex) => {
      const series = seriesOf(line);
      if (!series) return;
      for (let position = first; position <= last; position++) {
        const key = isVertical ? refKey(source.col1 + lineIndex, position) : refKey(position, source.row1 + lineIndex);
        sheet.setRaw(key, series(position - start));
      }
    });
  }

  /** While dragging, the selection shows what will be filled. */
  function showFillTarget(cell) {
    const target = fillTarget(filling, cell);
    anchor = { col: target.col1, row: target.row1 };
    focus = { col: target.col2, row: target.row2 };
    renderSelection();
  }

  function onFillEnd() {
    if (!filling) return;
    const source = filling;
    filling = null;
    const target = selectionBounds();
    const isExtended = Object.keys(source).some((side) => target[side] !== source[side]);
    if (!isExtended) return;
    const block = copyBlock(source);
    mutate(() => {
      tileBlock(block.rows, block, target, { col: source.col1, row: source.row1 });
      continueSeries(block, source, target);
    });
  }

  // ---------- files ----------

  function download(fileName, text, type) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type }));
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  /** The computed values, up to the last row and column that hold something. */
  function toCsv() {
    const lines = [];
    let lastRow = -1;
    let lastCol = -1;
    for (let row = 0; row < ROWS; row++) {
      lines.push([]);
      for (let col = 0; col < COLS; col++) {
        const value = sheet.value(refKey(col, row));
        lines[row].push(formatValue(value));
        if (value !== '') { lastRow = row; lastCol = Math.max(lastCol, col); }
      }
    }
    return lines.slice(0, lastRow + 1).map((fields) => csvLine(fields.slice(0, lastCol + 1))).join('\r\n');
  }

  /** A .csv file arrives as a new sheet named after the file; anything else must be a saved workbook. */
  async function openFile(file) {
    const text = await file.text();
    const isCsv = CSV_FILE.test(file.name);
    const before = book.serialize();
    try {
      mutate(() => (isCsv ? importCsv(file.name, text) : book.load(text)));
    } catch (error) {
      undoStack.pop();
      book.load(before);
      sheet = book.active;
      render();
      alert('This file is not a workbook saved from here.');
    }
  }

  function importCsv(fileName, text) {
    const base = fileName.replace(CSV_FILE, '').replace(/['!"]/g, '_').trim() || 'csv';
    const target = book.add(book.find(base) ? book.freeName(base + ' ') : base);
    parseCsv(text).forEach((fields, row) => fields.forEach((raw, col) => target.setRaw(refKey(col, row), raw)));
    selectFirstCell();
  }

  function openDemo() {
    selectFirstCell();
    mutate(() => book.load(DEMO));
  }

  function newBook() {
    if (!confirm('Start an empty workbook? (Ctrl+Z brings the current one back)')) return;
    selectFirstCell();
    mutate(() => book.load(EMPTY_BOOK));
  }

  /**
   * For a printout, the rows and columns after the last used cell are left out, as are the headers.
   * Row 1 moves into the table head while printing when it has to repeat on every page: browsers repeat the head.
   */
  function setPrintArea(isPrinting) {
    const { lastRow, lastCol } = sheet.usedRange();
    const isLeftOut = (index, last) => isPrinting && index > last;
    cellElements.forEach((cells, row) => {
      rowElement(row).classList.toggle('unprinted', isLeftOut(row, lastRow));
      cells.forEach((td, col) => td.classList.toggle('unprinted', isLeftOut(col, lastCol)));
    });
    if (isPrinting) renderWidths((col) => (col > lastCol ? 0 : savedWidth(col)), 0); else renderWidths();
    byId('page-style').textContent = isPrinting && sheet.print.landscape ? LANDSCAPE_PAGE : '';
    const repeatedPart = isPrinting && sheet.print.repeatHeader ? table.tHead : table.tBodies[0];
    repeatedPart.prepend(rowElement(0));
  }

  // ---------- sheets ----------

  function selectFirstCell() {
    anchor = { col: 0, row: 0 };
    focus = { col: 0, row: 0 };
  }

  function renderTabs() {
    byId('tab-list').replaceChildren(...book.names.map((name, index) => {
      const tab = document.createElement('button');
      tab.textContent = name;
      tab.dataset.index = index;
      tab.classList.toggle('on', index === book.activeIndex);
      return tab;
    }));
  }

  /** Which sheet is shown is saved, but is not a step for undo. */
  function showSheet(index) {
    book.select(index);
    sheet = book.active;
    selectFirstCell();
    save();
    render();
  }

  /** A change the workbook may refuse (a name that is taken, deleting the last sheet): the reason is shown and nothing changes. */
  function attempt(change) {
    try {
      mutate(change);
    } catch (error) {
      undoStack.pop();
      alert(error.message);
    }
  }

  function addSheet() {
    selectFirstCell();
    mutate(() => book.add());
  }

  function renameSheet() {
    const current = book.names[book.activeIndex];
    const name = prompt('New name for the sheet', current)?.trim();
    if (name && name !== current) attempt(() => book.rename(book.activeIndex, name));
  }

  function deleteSheet() {
    if (!confirm(`Delete the sheet "${book.names[book.activeIndex]}"? (Ctrl+Z brings it back)`)) return;
    selectFirstCell();
    attempt(() => book.remove(book.activeIndex));
  }

  function copySheet() {
    selectFirstCell();
    mutate(() => book.duplicate(book.activeIndex));
  }

  const SHEET_ACTIONS = {
    'menu-add-sheet': addSheet,
    'rename-sheet': renameSheet,
    'delete-sheet': deleteSheet,
    'copy-sheet': copySheet,
    'move-left': () => mutate(() => book.move(book.activeIndex, -1)),
    'move-right': () => mutate(() => book.move(book.activeIndex, 1)),
  };

  function onTabsClick(event) {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.index !== undefined) showSheet(Number(button.dataset.index)); else addSheet();
    grid.focus();
  }

  // ---------- grid input ----------

  function cellAt(event) {
    const td = event.target.closest('td');
    return td && { col: Number(td.dataset.col), row: Number(td.dataset.row) };
  }

  /** The row or column header under the mouse, as { axis, index }. */
  function headerAt(event) {
    const th = event.target.closest('th');
    if (!th || resizerColumn(event) !== null) return null;
    const axis = ['col', 'row'].find((name) => th.dataset[name] !== undefined);
    return axis ? { axis, index: Number(th.dataset[axis]) } : null;
  }

  /** Selects a whole row or column; with Shift, everything from the active cell's row or column to it. */
  function selectHeader({ axis, index }, extend) {
    const first = extend ? anchor[axis] : index;
    const whole = axis === 'col' ? { from: { row: 0 }, to: { row: ROWS - 1 } } : { from: { col: 0 }, to: { col: COLS - 1 } };
    anchor = { ...whole.from, [axis]: first };
    focus = { ...whole.to, [axis]: index };
    renderSelection();
  }

  /** Inserts (direction 1) as many rows or columns as are selected before the selection, or deletes (-1) the selected ones. */
  function restructure(axis, direction) {
    const bounds = selectionBounds();
    const first = bounds[axis + '1'];
    const count = bounds[axis + '2'] - first + 1;
    mutate(() => sheet.restructure(axis, first, direction * count));
  }

  function onMouseDown(event) {
    const cell = cellAt(event);
    const clickedHeader = headerAt(event);
    if (!cell && !clickedHeader) return;
    // Commit a pending edit to the cell it belongs to, before the selection moves away from it.
    if (document.activeElement !== grid) document.activeElement.blur();
    if (clickedHeader) { selectHeader(clickedHeader, event.shiftKey); return; }
    dragging = true;
    moveTo(cell.col, cell.row, event.shiftKey);
  }

  function onMouseOver(event) {
    const cell = (dragging || filling) && cellAt(event);
    if (!cell) return;
    if (filling) showFillTarget(cell); else moveTo(cell.col, cell.row, true);
  }

  const SHORTCUTS = {
    b: () => toggleStyle('bold'),
    i: () => toggleStyle('italic'),
    u: () => toggleStyle('underline'),
    z: undo,
    y: redo,
  };

  function onShortcut(event) {
    const action = SHORTCUTS[event.key.toLowerCase()];
    if (!action) return; // copy, cut and paste arrive as their own events
    event.preventDefault();
    action();
  }

  function onGridKey(event) {
    if (event.target !== grid) return;
    if (event.ctrlKey || event.metaKey) { onShortcut(event); return; }
    if (event.altKey) return;
    const isTyping = event.key.length === 1;
    if (isTyping) { startEdit(''); return; } // the typed character lands in the editor
    const steps = ARROWS[event.key] ?? { Enter: [0, 1], Tab: [1, 0] }[event.key];
    if (steps) {
      const isArrow = event.key in ARROWS;
      const sign = !isArrow && event.shiftKey ? -1 : 1;
      moveBy(steps[0] * sign, steps[1] * sign, isArrow && event.shiftKey);
    } else if (event.key === 'F2') {
      startEdit();
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      forSelection((key) => sheet.setRaw(key, ''));
    } else {
      return;
    }
    event.preventDefault();
  }

  // ---------- menus ----------

  const openMenu = () => toolbar.querySelector('.menu.open');

  function closeMenus() {
    pickedProperty = null;
    openMenu()?.classList.remove('open');
  }

  function toggleMenu(menu) {
    const wasOpen = menu === openMenu();
    closeMenus();
    if (!wasOpen) menu.classList.add('open');
  }

  /** With a menu open, moving over another menu opens that one instead. */
  function onMenuHover(event) {
    const menu = event.target.closest('.menu');
    if (menu && openMenu() && menu !== openMenu()) toggleMenu(menu);
  }

  const BUTTON_ACTIONS = {
    'clear-format': () => forSelection((key) => sheet.clearStyle(key)),
    'insert-row': () => restructure('row', 1),
    'delete-row': () => restructure('row', -1),
    'insert-col': () => restructure('col', 1),
    'delete-col': () => restructure('col', -1),
    'undo': undo,
    'redo': redo,
    ...SHEET_ACTIONS,
    'new-sheet': newBook,
    'open-demo': openDemo,
    'print': () => window.print(),
    'page-break': () => mutate(() => sheet.togglePageBreak(anchor.row)),
    'open-file': () => byId('file-input').click(),
    'save-file': () => download('workbook.json', book.serialize(), 'application/json'),
    'export-csv': () => download('sheet.csv', toCsv(), 'text/csv'),
  };

  function onToolbarClick(event) {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.classList.contains('menu-title')) {
      toggleMenu(button.parentElement);
      return;
    }
    const { toggle, align, decimals } = button.dataset;
    if (toggle) toggleStyle(toggle);
    else if (align) applyStyle({ align: sheet.style(activeKey()).align === align ? undefined : align });
    else if (decimals) changeDecimals(Number(decimals));
    else BUTTON_ACTIONS[button.id]();
    closeMenus();
    grid.focus();
  }

  function bindEvents() {
    grid.addEventListener('mousedown', onMouseDown);
    grid.addEventListener('mouseover', onMouseOver);
    grid.addEventListener('dblclick', (event) => { if (cellAt(event)) startEdit(); });
    grid.addEventListener('keydown', onGridKey);
    document.addEventListener('mouseup', () => { dragging = false; });
    fillHandle.addEventListener('mousedown', (event) => {
      event.preventDefault();
      filling = selectionBounds();
    });
    document.addEventListener('mouseup', onFillEnd);
    table.tHead.addEventListener('mousedown', onResizeStart);
    table.tHead.addEventListener('dblclick', (event) => { if (resizerColumn(event) !== null) fitColumn(resizerColumn(event)); });
    document.addEventListener('mousemove', onResizeMove);
    document.addEventListener('mouseup', onResizeEnd);
    editor.addEventListener('keydown', onEditorKey);
    editor.addEventListener('blur', () => finishEdit(true));
    formulaBar.addEventListener('keydown', onFormulaBarKey);
    formulaBar.addEventListener('change', () => setActiveRaw(formulaBar.value));
    toolbar.addEventListener('click', onToolbarClick);
    toolbar.addEventListener('change', closeMenus); // a choice was made in a list, colour or tick box of a menu
    toolbar.addEventListener('mouseover', onMenuHover);
    document.addEventListener('mousedown', (event) => { if (!event.target.closest('.menu')) closeMenus(); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenus(); });
    byId('tabs').addEventListener('click', onTabsClick);
    window.addEventListener('beforeprint', () => setPrintArea(true));
    window.addEventListener('afterprint', () => setPrintArea(false));
    Object.entries(PRINT_OPTIONS).forEach(([id, option]) => {
      byId(id).addEventListener('change', (event) => mutate(() => sheet.setPrintOption(option, event.target.checked)));
    });
    borderSelect.addEventListener('change', () => {
      applyStyle({ border: borderSelect.value === 'none' ? undefined : borderSelect.value });
      grid.focus();
    });
    ['copy', 'cut'].forEach((type) => document.addEventListener(type, onCopy));
    document.addEventListener('paste', onPaste);
    byId('file-input').addEventListener('change', (event) => {
      if (event.target.files[0]) openFile(event.target.files[0]);
      event.target.value = '';
    });
    numberFormat.addEventListener('change', () => {
      applyStyle({ format: numberFormat.value === 'general' ? undefined : numberFormat.value, decimals: undefined });
      grid.focus();
    });
    Object.entries(COLOUR_INPUTS).forEach(([id, { property }]) => {
      byId(id).addEventListener('input', (event) => pickColour(property, event.target.value));
    });
  }

  buildTable();
  restore();
  bindEvents();
  render();
  grid.focus();
})();
