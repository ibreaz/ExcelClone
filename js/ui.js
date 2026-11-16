/* Grid rendering, selection, editing and the toolbar. */
(function () {
  'use strict';

  const { Sheet, FormulaError, colName, refKey, formatValue, shiftRefs, DEFAULT_DECIMALS } = window.XL;

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
  const EMPTY_SHEET = '[]';

  const byId = (id) => document.getElementById(id);
  const grid = byId('grid');
  const table = byId('sheet');
  const editor = byId('editor');
  const formulaBar = byId('formula-bar');
  const toolbar = byId('toolbar');
  const numberFormat = byId('number-format');
  const fillHandle = byId('fill-handle');

  const sheet = new Sheet();
  const cellElements = []; // [row][col]
  const columnElements = []; // the <col> of each data column
  let resizing = null; // the column border being dragged: { col, startX, startWidth, width }
  let anchor = { col: 0, row: 0 }; // the active cell
  let focus = { col: 0, row: 0 }; // the opposite corner of the selection
  let marked = [];
  let dragging = false;
  let editing = false;
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
    columns.appendChild(document.createElement('col')).style.width = ROW_HEADER_WIDTH + 'px';
    const head = table.createTHead().insertRow();
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

  function paintCell(td, key) {
    const value = sheet.value(key);
    const style = sheet.style(key);
    td.textContent = formatValue(value, style);
    td.classList.toggle('num', typeof value === 'number');
    td.classList.toggle('err', value instanceof FormulaError);
    Object.assign(td.style, {
      fontWeight: style.bold ? 'bold' : '',
      fontStyle: style.italic ? 'italic' : '',
      textDecoration: style.underline ? 'underline' : '',
      textAlign: style.align ?? '',
      color: style.color ?? '',
      backgroundColor: style.fill ?? '',
    });
  }

  function render() {
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) paintCell(cellElements[row][col], refKey(col, row));
    }
    renderWidths();
    renderSelection();
  }

  // ---------- column widths ----------

  const savedWidth = (col) => sheet.colWidth(col) ?? DEFAULT_COL_WIDTH;

  /** widthOf lets a width be shown before it is stored, while a border is dragged or a column is measured. */
  function renderWidths(widthOf = savedWidth) {
    let total = ROW_HEADER_WIDTH;
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
    const widest = Math.max(MIN_COL_WIDTH, ...cells.map((td) => td.scrollWidth));
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
      localStorage.setItem(STORAGE_KEY, sheet.serialize());
    } catch (error) {
      console.warn('The sheet could not be saved in this browser', error);
    }
  }

  function restore() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) sheet.load(saved);
    } catch (error) {
      console.warn('The saved sheet could not be read', error);
    }
  }

  /** Every change of the sheet goes through here, so it is saved and shown. */
  function mutate(change) {
    undoStack.push(sheet.serialize());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
    change();
    save();
    render();
  }

  /** Steps back (or forward again) to a remembered state of the sheet. */
  function timeTravel(from, to) {
    if (from.length === 0) return;
    to.push(sheet.serialize());
    sheet.load(from.pop());
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

  /** Writes the rows of cells over the target bounds, repeating them when the target is larger. origin is where a copy made here came from. */
  function tileBlock(rows, origin, target) {
    for (let row = target.row1; row <= target.row2; row++) {
      for (let col = target.col1; col <= target.col2; col++) {
        const sourceRow = (row - target.row1) % rows.length;
        const sourceCol = (col - target.col1) % rows[sourceRow].length;
        const from = origin && { col: origin.col + sourceCol, row: origin.row + sourceRow };
        pasteCell(rows[sourceRow][sourceCol], from, { col, row });
      }
    }
  }

  // ---------- fill handle ----------

  /** The bounds to fill when the handle is dragged to the cell: the source grown down or right, whichever is further. */
  function fillTarget(source, cell) {
    const down = cell.row - source.row2;
    const right = cell.col - source.col2;
    if (down <= 0 && right <= 0) return source;
    return down >= right ? { ...source, row2: cell.row } : { ...source, col2: cell.col };
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
    const isExtended = target.row2 !== source.row2 || target.col2 !== source.col2;
    const block = copyBlock(source);
    if (isExtended) mutate(() => tileBlock(block.rows, block, target));
  }

  // ---------- files ----------

  function download(fileName, text, type) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type }));
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function csvField(value) {
    const text = formatValue(value);
    return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
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
        lines[row].push(csvField(value));
        if (value !== '') { lastRow = row; lastCol = Math.max(lastCol, col); }
      }
    }
    return lines.slice(0, lastRow + 1).map((fields) => fields.slice(0, lastCol + 1).join(',')).join('\r\n');
  }

  async function openFile(file) {
    const text = await file.text();
    const before = sheet.serialize();
    try {
      mutate(() => sheet.load(text));
    } catch (error) {
      sheet.load(before);
      render();
      alert('This file is not a sheet saved from here.');
    }
  }

  function newSheet() {
    if (confirm('Start an empty sheet? (Ctrl+Z brings the current one back)')) mutate(() => sheet.load(EMPTY_SHEET));
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

  const BUTTON_ACTIONS = {
    'clear-format': () => forSelection((key) => sheet.clearStyle(key)),
    'insert-row': () => restructure('row', 1),
    'delete-row': () => restructure('row', -1),
    'insert-col': () => restructure('col', 1),
    'delete-col': () => restructure('col', -1),
    'undo': undo,
    'redo': redo,
    'new-sheet': newSheet,
    'open-file': () => byId('file-input').click(),
    'save-file': () => download('sheet.json', sheet.serialize(), 'application/json'),
    'export-csv': () => download('sheet.csv', toCsv(), 'text/csv'),
  };

  function onToolbarClick(event) {
    const button = event.target.closest('button');
    if (!button) return;
    const { toggle, align, decimals } = button.dataset;
    if (toggle) toggleStyle(toggle);
    else if (align) applyStyle({ align: sheet.style(activeKey()).align === align ? undefined : align });
    else if (decimals) changeDecimals(Number(decimals));
    else BUTTON_ACTIONS[button.id]();
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
    byId('text-color').addEventListener('change', (event) => applyStyle({ color: event.target.value }));
    byId('fill-color').addEventListener('change', (event) => applyStyle({ fill: event.target.value }));
  }

  buildTable();
  restore();
  bindEvents();
  render();
  grid.focus();
})();
