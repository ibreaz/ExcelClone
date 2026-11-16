/* Workbook: the named sheets, which one is shown, and saving/loading them together. No DOM access. */
(function (root) {
  'use strict';

  const { Sheet, renameSheetRefs, isSheetName } = root.XL;

  const DEFAULT_NAME = 'Sheet';
  const COPY_SUFFIX = ' copy';
  const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();

  class Workbook {
    constructor() {
      this.entries = []; // { name, sheet }
      this.activeIndex = 0;
      this.add();
    }

    get sheets() {
      return this.entries.map((entry) => entry.sheet);
    }

    get names() {
      return this.entries.map((entry) => entry.name);
    }

    get active() {
      return this.entries[this.activeIndex].sheet;
    }

    /** The sheet with the name (upper/lower case ignored), or undefined. */
    find(name) {
      return this.entries.find((entry) => sameName(entry.name, name))?.sheet;
    }

    /** A name that no sheet has yet: the base followed by the first free number. */
    freeName(base = DEFAULT_NAME) {
      let number = 1;
      while (this.find(base + number)) number++;
      return base + number;
    }

    /** Adds an empty sheet and shows it. */
    add(name = this.freeName()) {
      this.checkName(name);
      this.entries.push({ name, sheet: new Sheet(this) });
      this.activeIndex = this.entries.length - 1;
      return this.active;
    }

    checkName(name, ownIndex) {
      if (!isSheetName(name)) throw new Error('A sheet name cannot be empty and cannot contain an apostrophe, an exclamation mark or a double quote.');
      const taken = this.entries.findIndex((entry) => sameName(entry.name, name));
      if (taken !== -1 && taken !== ownIndex) throw new Error('There is already a sheet with this name.');
    }

    /** Formulas that refer to the sheet by name follow the new name. */
    rename(index, name) {
      this.checkName(name, index);
      const oldName = this.entries[index].name;
      this.entries[index].name = name;
      this.sheets.forEach((sheet) => sheet.rewriteFormulas((raw) => renameSheetRefs(raw, oldName, name)));
      this.active.invalidate();
    }

    /** Formulas that refer to a removed sheet show #REF!. */
    remove(index) {
      if (this.entries.length === 1) throw new Error('The last sheet cannot be deleted.');
      this.entries.splice(index, 1);
      this.activeIndex = Math.min(index, this.entries.length - 1);
      this.active.invalidate();
    }

    /** Moves a sheet one place left (step -1) or right (step 1) and keeps it shown; at either end it stays where it is. */
    move(index, step) {
      const target = index + step;
      if (target < 0 || target >= this.entries.length) return;
      const [entry] = this.entries.splice(index, 1);
      this.entries.splice(target, 0, entry);
      this.activeIndex = target;
    }

    /** Adds a copy of the sheet right after it and shows it. */
    duplicate(index) {
      const { name, sheet } = this.entries[index];
      const copy = new Sheet(this);
      copy.fromData(JSON.parse(JSON.stringify(sheet.toData())));
      const copyName = name + COPY_SUFFIX;
      this.entries.splice(index + 1, 0, { name: this.find(copyName) ? this.freeName(copyName + ' ') : copyName, sheet: copy });
      this.activeIndex = index + 1;
    }

    select(index) {
      this.activeIndex = index;
    }

    serialize() {
      return JSON.stringify({ active: this.activeIndex, sheets: this.entries.map(({ name, sheet }) => ({ name, ...sheet.toData() })) });
    }

    /** Also reads a save made before there were several sheets: it becomes the only sheet. */
    load(json) {
      const data = JSON.parse(json);
      const isWorkbook = Array.isArray(data?.sheets) && data.sheets.length > 0;
      const saved = isWorkbook ? data : { sheets: [{ name: DEFAULT_NAME + 1, content: data }] };
      const entries = saved.sheets.map(({ name, content, ...ownContent }) => {
        const sheet = new Sheet(this);
        sheet.fromData(content ?? ownContent);
        return { name, sheet };
      });
      this.entries = entries;
      this.activeIndex = Math.min(saved.active ?? 0, entries.length - 1);
    }
  }

  root.XL.Workbook = Workbook;
})(typeof window !== 'undefined' ? window : globalThis);
