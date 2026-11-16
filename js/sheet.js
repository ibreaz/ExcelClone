/* Sheet model: raw cell content and style, computed values with cycle detection. No DOM access. */
(function (root) {
  'use strict';

  const { ERRORS, FormulaError, parse, evaluate, refKey, parseRef, movedIndex, restructureRefs, parseDate } = root.XL;
  const { literalNumber, dateFormatOf, DATE_FORMAT_NAMES } = root.XL;

  const NO_CELL = -1;
  // breaks: the row indexes a new printed page starts at.
  const defaultPrint = () => ({ landscape: false, repeatHeader: false, breaks: [] });

  class Sheet {
    /** book: the workbook the sheet belongs to, when it has sibling sheets its formulas can refer to. */
    constructor(book = null) {
      this.book = book;
      this.cells = new Map();
      this.widths = {}; // column index -> pixels, only for resized columns
      this.print = defaultPrint();
      this.cache = new Map();
      this.computing = new Set();
    }

    raw(key) {
      return this.cells.get(key)?.raw ?? '';
    }

    style(key) {
      return this.cells.get(key)?.style ?? {};
    }

    /** A typed date, or a formula that results in one, also gives the cell a date format, unless it already has a number format. */
    setRaw(key, raw) {
      const dateFormat = this.dateFormatFor(raw);
      this.update(key, (cell) => {
        cell.raw = raw;
        if (dateFormat && !cell.style.format) cell.style = { ...cell.style, format: dateFormat };
      });
    }

    /** The date format the content should be shown in, or null when it is not a date. */
    dateFormatFor(raw) {
      if (!raw.startsWith('=')) return parseDate(raw)?.format ?? null;
      try {
        return dateFormatOf(parse(raw.slice(1)), (col, row, sheetName) => this.dateFormatAt(col, row, sheetName));
      } catch (error) {
        return null; // a formula that cannot be read shows its error, not a date
      }
    }

    dateFormatAt(col, row, sheetName) {
      const format = this.sheetNamed(sheetName)?.style(refKey(col, row)).format;
      return DATE_FORMAT_NAMES.includes(format) ? format : null;
    }

    /** The sheet a reference points at: this one when the reference names no sheet; undefined when the named sheet does not exist. */
    sheetNamed(sheetName) {
      return sheetName === undefined ? this : this.book?.find(sheetName);
    }

    /** Merges the patch into the cell style; a property set to undefined is removed. */
    setStyle(key, patch) {
      this.update(key, (cell) => {
        cell.style = Object.fromEntries(Object.entries({ ...cell.style, ...patch }).filter(([, v]) => v !== undefined));
      });
    }

    colWidth(col) {
      return this.widths[col];
    }

    /** An undefined width puts the column back to the default. */
    setColWidth(col, width) {
      if (width === undefined) delete this.widths[col]; else this.widths[col] = width;
    }

    /**
     * Inserts `count` empty rows or columns (axis 'row' | 'col') before index `at`, or removes -count
     * of them from `at` on when count is negative. Cells, column widths and formulas follow.
     */
    restructure(axis, at, count) {
      this.moveCells(axis, at, count);
      for (const sheet of this.family()) {
        const pointsHere = (sheetName) => (sheetName === undefined ? sheet === this : this.book?.find(sheetName) === this);
        sheet.rewriteFormulas((raw) => restructureRefs(raw, axis, at, count, pointsHere));
      }
      this.invalidate();
    }

    moveCells(axis, at, count) {
      const moved = new Map();
      for (const [key, cell] of this.cells) {
        const position = parseRef(key);
        position[axis] = movedIndex(position[axis], at, count);
        if (position[axis] !== null) moved.set(refKey(position.col, position.row), cell);
      }
      this.cells = moved;
      if (axis === 'col') this.widths = this.movedWidths(at, count);
      else this.print.breaks = this.print.breaks.map((row) => movedIndex(row, at, count)).filter((row) => row !== null);
    }

    /** option: 'landscape' (print the page sideways) or 'repeatHeader' (print row 1 on top of every page). */
    setPrintOption(option, isOn) {
      this.print[option] = isOn;
    }

    hasPageBreak(row) {
      return this.print.breaks.includes(row);
    }

    /** Starts a new printed page at the row, or stops doing so. */
    togglePageBreak(row) {
      const others = this.print.breaks.filter((existing) => existing !== row);
      this.print.breaks = this.hasPageBreak(row) ? others : [...others, row].sort((a, b) => a - b);
    }

    rewriteFormulas(rewrite) {
      for (const cell of this.cells.values()) cell.raw = rewrite(cell.raw);
    }

    /** This sheet and the other sheets of its workbook. */
    family() {
      return this.book ? this.book.sheets : [this];
    }

    /** A change in one sheet can change what the formulas of the others show. */
    invalidate() {
      this.family().forEach((sheet) => sheet.cache.clear());
    }

    /** The last row and column index holding content or formatting, -1 for an empty sheet. */
    usedRange() {
      const positions = [...this.cells.keys()].map(parseRef);
      return { lastRow: Math.max(NO_CELL, ...positions.map((p) => p.row)), lastCol: Math.max(NO_CELL, ...positions.map((p) => p.col)) };
    }

    movedWidths(at, count) {
      const widths = {};
      for (const [col, width] of Object.entries(this.widths)) {
        const target = movedIndex(Number(col), at, count);
        if (target !== null) widths[target] = width;
      }
      return widths;
    }

    clearStyle(key) {
      this.update(key, (cell) => { cell.style = {}; });
    }

    update(key, change) {
      const cell = this.cells.get(key) ?? { raw: '', style: {} };
      change(cell);
      const isEmpty = cell.raw === '' && Object.keys(cell.style).length === 0;
      if (isEmpty) this.cells.delete(key); else this.cells.set(key, cell);
      this.invalidate();
    }

    /** The computed value of a cell: number, string, boolean, or a FormulaError to display. */
    value(key) {
      if (this.cache.has(key)) return this.cache.get(key);
      if (this.computing.has(key)) return new FormulaError(ERRORS.CYCLE);
      this.computing.add(key);
      let result;
      try {
        result = this.compute(this.raw(key));
      } catch (error) {
        result = error instanceof FormulaError ? error : new FormulaError(ERRORS.SYNTAX);
      } finally {
        this.computing.delete(key);
      }
      this.cache.set(key, result);
      return result;
    }

    compute(raw) {
      if (raw.startsWith('=') && raw.length > 1) {
        return evaluate(parse(raw.slice(1)), (col, row, sheetName) => this.lookup(col, row, sheetName));
      }
      return literalNumber(raw) ?? parseDate(raw)?.serial ?? raw;
    }

    lookup(col, row, sheetName) {
      const source = this.sheetNamed(sheetName);
      if (!source) throw new FormulaError(ERRORS.REF);
      const value = source.value(refKey(col, row));
      if (value instanceof FormulaError) throw value;
      return value;
    }

    serialize() {
      return JSON.stringify(this.toData());
    }

    toData() {
      return { cells: [...this.cells], widths: this.widths, print: this.print };
    }

    /** Also reads the first save format, which was the bare list of cells. */
    load(json) {
      this.fromData(JSON.parse(json));
    }

    fromData(data) {
      const saved = Array.isArray(data) ? { cells: data } : data;
      if (!Array.isArray(saved?.cells)) throw new Error('Not a saved sheet');
      this.cells = new Map(saved.cells);
      this.widths = { ...saved.widths };
      this.print = { ...defaultPrint(), ...saved.print, breaks: [...(saved.print?.breaks ?? [])] };
      this.invalidate();
    }
  }

  root.XL.Sheet = Sheet;
})(typeof window !== 'undefined' ? window : globalThis);
