/* Sheet model: raw cell content and style, computed values with cycle detection. No DOM access. */
(function (root) {
  'use strict';

  const { ERRORS, FormulaError, parse, evaluate, refKey } = root.XL;

  class Sheet {
    constructor() {
      this.cells = new Map();
      this.widths = {}; // column index -> pixels, only for resized columns
      this.cache = new Map();
      this.computing = new Set();
    }

    raw(key) {
      return this.cells.get(key)?.raw ?? '';
    }

    style(key) {
      return this.cells.get(key)?.style ?? {};
    }

    setRaw(key, raw) {
      this.update(key, (cell) => { cell.raw = raw; });
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

    clearStyle(key) {
      this.update(key, (cell) => { cell.style = {}; });
    }

    update(key, change) {
      const cell = this.cells.get(key) ?? { raw: '', style: {} };
      change(cell);
      const isEmpty = cell.raw === '' && Object.keys(cell.style).length === 0;
      if (isEmpty) this.cells.delete(key); else this.cells.set(key, cell);
      this.cache.clear();
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
        return evaluate(parse(raw.slice(1)), (col, row) => this.lookup(col, row));
      }
      const text = raw.trim();
      return text !== '' && !Number.isNaN(Number(text)) ? Number(text) : raw;
    }

    lookup(col, row) {
      const value = this.value(refKey(col, row));
      if (value instanceof FormulaError) throw value;
      return value;
    }

    serialize() {
      return JSON.stringify({ cells: [...this.cells], widths: this.widths });
    }

    /** Also reads the first save format, which was the bare list of cells. */
    load(json) {
      const data = JSON.parse(json);
      const saved = Array.isArray(data) ? { cells: data } : data;
      if (!Array.isArray(saved.cells)) throw new Error('Not a saved sheet');
      this.cells = new Map(saved.cells);
      this.widths = { ...saved.widths };
      this.cache.clear();
    }
  }

  root.XL.Sheet = Sheet;
})(typeof window !== 'undefined' ? window : globalThis);
