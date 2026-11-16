/* Sheet model: raw cell content and style, computed values with cycle detection. No DOM access. */
(function (root) {
  'use strict';

  const { ERRORS, FormulaError, parse, evaluate, refKey, parseRef, movedIndex, restructureRefs, parseDate } = root.XL;
  const { literalNumber, dateFormatOf, DATE_FORMAT_NAMES, Table, detailedError, parseArea } = root.XL;

  const UNNAMED_COLUMN = 'column'; // column3 is the name of a third column without a heading
  /** A cell whose whole content is a query: its result is a table that fills the cells beside and below. */
  const isQuery = (raw) => /^=\s*SQL\s*\(/i.test(raw);

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
      this.spill = null; // see spilled()
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
      this.book?.moveNames(this, axis, at, count);
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
      this.family().forEach((sheet) => {
        sheet.cache.clear();
        sheet.spill = null;
      });
    }

    /** The last row and column index holding content, formatting or a query result, -1 for an empty sheet. */
    usedRange() {
      const positions = [...this.cells.keys(), ...this.spilled().keys()].map(parseRef);
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

    /** The value a cell shows: number, string, boolean, or a FormulaError. An empty cell may show part of a query result. */
    value(key) {
      if (this.cache.has(key)) return this.cache.get(key);
      const raw = this.raw(key);
      if (raw === '') return this.spilled().get(key)?.value ?? '';
      if (isQuery(raw)) {
        this.spilled(); // lays out all queries, which decides what this one shows
        if (this.cache.has(key)) return this.cache.get(key);
      }
      const result = this.evaluated(key);
      if (result instanceof Table) return result.rows[0][0]; // asked for while the queries are still being laid out
      this.cache.set(key, result);
      return result;
    }

    /** What the content of a cell works out to: a value, the Table of a query, or the FormulaError to show. */
    evaluated(key) {
      if (this.computing.has(key)) return new FormulaError(ERRORS.CYCLE);
      this.computing.add(key);
      try {
        return this.compute(this.raw(key));
      } catch (error) {
        return error instanceof FormulaError ? error : new FormulaError(ERRORS.SYNTAX);
      } finally {
        this.computing.delete(key);
      }
    }

    /**
     * The cells that show the results of queries: key -> { key, queryCell, value, format }. The result of a query starts in
     * its own cell and runs right and down over empty cells. Queries are laid out in the order their cells
     * were filled in, so a query can read the result of an earlier one, not of a later one.
     */
    spilled() {
      if (!this.spill) {
        this.spill = new Map();
        for (const [key, cell] of this.cells) if (isQuery(cell.raw)) this.layOut(key);
      }
      return this.spill;
    }

    layOut(key) {
      const result = this.evaluated(key);
      if (!(result instanceof Table)) {
        this.cache.set(key, result);
        return;
      }
      const { col, row } = parseRef(key);
      const isColumnNames = (line) => line === 0;
      const covered = result.rows.flatMap((values, line) => values.map((value, i) => (
        { key: refKey(col + i, row + line), queryCell: key, value, format: isColumnNames(line) ? undefined : result.formats[i] })));
      const isBlocked = covered.slice(1).some((cell) => this.raw(cell.key) !== '' || this.spill.has(cell.key));
      if (isBlocked) {
        this.cache.set(key, detailedError(ERRORS.SPILL, 'The result needs cells that are not empty'));
        return;
      }
      covered.forEach((cell) => this.spill.set(cell.key, cell));
      this.cache.set(key, covered[0].value);
    }

    /** The cell holding the query whose result the given cell shows (the cell itself for the query's own cell); undefined for other cells. */
    queryCellOf(key) {
      return this.spilled().get(key)?.queryCell;
    }

    /** Where the queries of the sheet are: for each, the cell holding it and the area from..to its result fills (the cell alone when it shows an error). */
    queryAreas() {
      const areas = new Map();
      for (const [key, cell] of this.cells) {
        if (isQuery(cell.raw)) areas.set(key, { key, from: parseRef(key), to: parseRef(key) });
      }
      for (const cell of this.spilled().values()) {
        const { to } = areas.get(cell.queryCell);
        const position = parseRef(cell.key);
        Object.assign(to, { col: Math.max(to.col, position.col), row: Math.max(to.row, position.row) });
      }
      return [...areas.values()];
    }

    /** The style a cell is shown with: its own, plus the number format a query result brings from its source column. */
    shownStyle(key) {
      const style = this.style(key);
      const format = this.spilled().get(key)?.format;
      return format && !style.format ? { ...style, format } : style;
    }

    /** The table a query names: a named area or a typed one. Its first row holds the column names; empty rows are left out. */
    tableAt(source) {
      const area = this.book?.areaNamed(source) ?? parseArea(source);
      const sheet = area && this.sheetNamed(area.sheet);
      if (!sheet) throw detailedError(ERRORS.SQL, `There is no table "${source}": use a name or an area such as A1:D9`);
      const columns = Array.from({ length: area.to.col - area.from.col + 1 }, (unused, i) => area.from.col + i);
      const lines = [];
      for (let row = area.from.row; row <= area.to.row; row++) lines.push(columns.map((col) => this.lookup(col, row, area.sheet)));
      return {
        headers: lines[0].map((value, i) => (value === '' ? UNNAMED_COLUMN + (i + 1) : String(value))),
        rows: lines.slice(1).filter((line) => line.some((value) => value !== '')),
        formats: columns.map((col) => sheet.style(refKey(col, area.from.row + 1)).format),
      };
    }

    compute(raw) {
      if (raw.startsWith('=') && raw.length > 1) {
        return evaluate(parse(raw.slice(1)), this.context());
      }
      return literalNumber(raw) ?? parseDate(raw)?.serial ?? raw;
    }

    /** What a formula of this sheet can reach: cells, here or on a named sheet, and the cells behind a name. */
    context() {
      return {
        cell: (col, row, sheetName) => this.lookup(col, row, sheetName),
        nameRange: (name) => this.book?.areaNamed(name),
        table: (source) => this.tableAt(source),
      };
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
