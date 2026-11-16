/* Formula engine: tokenizer, recursive-descent parser and evaluator. No DOM access. */
(function (root) {
  'use strict';

  const ERRORS = { DIV: '#DIV/0!', NAME: '#NAME?', VALUE: '#VALUE!', CYCLE: '#CYCLE!', SYNTAX: '#ERROR!', REF: '#REF!', SPILL: '#SPILL!', SQL: '#SQL!' };

  /** An error shown in a cell; the message is one of ERRORS. */
  class FormulaError extends Error {}

  /** An error that can tell more than its code: the page shows the detail when the mouse is over the cell. */
  function detailedError(code, detail) {
    return Object.assign(new FormulaError(code), { detail });
  }

  /** The result of a query: rows of values, the first being the column names, and the number format of each column. */
  class Table {
    constructor(rows, formats) {
      this.rows = rows;
      this.formats = formats;
    }
  }

  const LETTERS = 26;
  const CODE_BEFORE_A = 64;

  function colName(index) {
    let name = '';
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / LETTERS)) {
      name = String.fromCharCode(CODE_BEFORE_A + 1 + ((n - 1) % LETTERS)) + name;
    }
    return name;
  }

  function colIndex(name) {
    let index = 0;
    for (const letter of name.toUpperCase()) index = index * LETTERS + letter.charCodeAt(0) - CODE_BEFORE_A;
    return index - 1;
  }

  function refKey(col, row) {
    return colName(col) + (row + 1);
  }

  function parseRef(text) {
    const match = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(text);
    return { col: colIndex(match[1]), row: Number(match[2]) - 1 };
  }

  const SIMPLE_SHEET_NAME = '[A-Za-z_][A-Za-z0-9_]*';
  const QUOTED_SHEET_NAME = `'[^'!"]+'`;
  // In front of a reference a sheet is written as Jan!A1, or as 'Year 2026'!A1 when its name is not a plain word.
  const WRITTEN_SHEET_NAME = `${SIMPLE_SHEET_NAME}|${QUOTED_SHEET_NAME}`;

  /** Any name will do, except one with ' ! or " (they would break the way formulas write it) or with spaces around it. */
  const isSheetName = (name) => /^[^'!"]+$/.test(name) && name === name.trim();
  const isSimpleSheetName = (name) => new RegExp(`^${SIMPLE_SHEET_NAME}$`).test(name);
  const sheetPrefix = (name) => (isSimpleSheetName(name) ? name : `'${name}'`) + '!';
  const unquoted = (writtenName) => writtenName.replace(/^'|'$/g, '');

  // A cell reference may name its sheet (Sheet2!A1); `error` is the mark left by a deleted reference.
  const TOKEN = new RegExp(String.raw`\s*(?:(?<number>\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+)|"(?<string>(?:[^"]|"")*)"`
    + String.raw`|(?:(?<sheet>${WRITTEN_SHEET_NAME})!)?(?<ref>\$?[A-Za-z]{1,3}\$?\d+)(?![A-Za-z0-9_(])|(?<name>[A-Za-z_][A-Za-z0-9_]*)`
    + String.raw`|(?<op><=|>=|<>|[-+*\/^&=<>(),;:%])|(?<error>#REF!))`, 'y');

  function tokenize(text) {
    const source = text.trimEnd();
    const tokens = [];
    TOKEN.lastIndex = 0;
    while (TOKEN.lastIndex < source.length) {
      const match = TOKEN.exec(source);
      if (!match) throw new FormulaError(ERRORS.SYNTAX);
      tokens.push(toToken(match.groups));
    }
    return tokens;
  }

  function toToken(found) {
    if (found.number !== undefined) return { type: 'number', value: Number(found.number) };
    if (found.string !== undefined) return { type: 'string', value: found.string.replace(/""/g, '"') };
    if (found.ref !== undefined) return { type: 'ref', value: found.ref, sheet: found.sheet && unquoted(found.sheet) };
    if (found.name !== undefined) return { type: 'name', value: found.name.toUpperCase() };
    if (found.error !== undefined) return { type: 'error', value: ERRORS.REF };
    return { type: 'op', value: found.op };
  }

  // Lowest precedence first.
  const BINARY_LEVELS = [['=', '<>', '<', '>', '<=', '>='], ['&'], ['+', '-'], ['*', '/'], ['^']];

  function parse(text) {
    const tokens = tokenize(text);
    let pos = 0;
    const fail = () => { throw new FormulaError(ERRORS.SYNTAX); };
    const isOp = (...ops) => pos < tokens.length && tokens[pos].type === 'op' && ops.includes(tokens[pos].value);
    const expectOp = (op) => (isOp(op) ? pos++ : fail());
    const literal = (value) => ({ type: 'literal', value });

    function binary(level) {
      if (level === BINARY_LEVELS.length) return unary();
      let left = binary(level + 1);
      while (isOp(...BINARY_LEVELS[level])) {
        const op = tokens[pos++].value;
        left = { type: 'binary', op, left, right: binary(level + 1) };
      }
      return left;
    }

    function unary() {
      if (isOp('-')) { pos++; return { type: 'negate', operand: unary() }; }
      if (isOp('+')) { pos++; return unary(); }
      let node = primary();
      while (isOp('%')) { pos++; node = { type: 'percent', operand: node }; }
      return node;
    }

    function primary() {
      const token = tokens[pos++] ?? fail();
      if (token.type === 'number' || token.type === 'string') return literal(token.value);
      if (token.type === 'ref') return reference(token);
      if (token.type === 'name') return named(token.value);
      if (token.type === 'error') return { type: 'error', code: token.value };
      if (token.value !== '(') fail();
      const inner = binary(0);
      expectOp(')');
      return inner;
    }

    function reference(token) {
      const from = parseRef(token.value);
      if (!isOp(':')) return { type: 'ref', sheet: token.sheet, ...from };
      pos++;
      const end = tokens[pos++];
      if (!end || end.type !== 'ref') fail();
      return { type: 'range', sheet: token.sheet, from, to: parseRef(end.value) };
    }

    function named(name) {
      if (name === 'TRUE' || name === 'FALSE') return literal(name === 'TRUE');
      if (!isOp('(')) return { type: 'name', name }; // a named cell or range
      pos++;
      const args = [];
      while (!isOp(')')) {
        args.push(binary(0));
        if (!isOp(')')) (isOp(',', ';') ? pos++ : fail());
      }
      pos++;
      return { type: 'call', name, args };
    }

    const ast = binary(0);
    if (pos < tokens.length) fail();
    return ast;
  }

  function toNumber(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'boolean') return Number(value);
    if (value === '') return 0;
    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value);
    throw new FormulaError(ERRORS.VALUE);
  }

  const SIGNIFICANT_DIGITS = 12;

  /** A number as text without binary noise such as 0.1 + 0.2 = 0.30000000000000004. */
  function plainNumber(value) {
    return String(Number(value.toPrecision(SIGNIFICANT_DIGITS)));
  }

  /** The number a typed text stands for, or null when it is not a number. */
  function literalNumber(text) {
    const trimmed = text.trim();
    return trimmed !== '' && !Number.isNaN(Number(trimmed)) ? Number(trimmed) : null;
  }

  function toText(value) {
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    return typeof value === 'number' ? plainNumber(value) : String(value);
  }

  function compare(a, b) {
    const numeric = (v) => typeof v !== 'string' || v === '';
    if (numeric(a) && numeric(b)) return toNumber(a) - toNumber(b);
    return toText(a).toLowerCase().localeCompare(toText(b).toLowerCase());
  }

  function divide(a, b) {
    const divisor = toNumber(b);
    if (divisor === 0) throw new FormulaError(ERRORS.DIV);
    return toNumber(a) / divisor;
  }

  const BINARY = {
    '+': (a, b) => toNumber(a) + toNumber(b),
    '-': (a, b) => toNumber(a) - toNumber(b),
    '*': (a, b) => toNumber(a) * toNumber(b),
    '/': divide,
    '^': (a, b) => Math.pow(toNumber(a), toNumber(b)),
    '&': (a, b) => toText(a) + toText(b),
    '=': (a, b) => compare(a, b) === 0,
    '<>': (a, b) => compare(a, b) !== 0,
    '<': (a, b) => compare(a, b) < 0,
    '>': (a, b) => compare(a, b) > 0,
    '<=': (a, b) => compare(a, b) <= 0,
    '>=': (a, b) => compare(a, b) >= 0,
  };

  /** Rounds half away from zero, as accountants expect. */
  function roundTo(value, digits) {
    const factor = Math.pow(10, digits);
    return Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * factor) / factor;
  }

  /** Numbers of a function call: range cells that hold text or nothing are skipped. */
  function numbersOf(args) {
    const numbers = [];
    for (const arg of args) {
      if (Array.isArray(arg)) numbers.push(...arg.filter((v) => typeof v === 'number'));
      else numbers.push(toNumber(arg));
    }
    return numbers;
  }

  const sum = (numbers) => numbers.reduce((total, n) => total + n, 0);

  function average(numbers) {
    if (numbers.length === 0) throw new FormulaError(ERRORS.DIV);
    return sum(numbers) / numbers.length;
  }

  function toBoolean(value) {
    return typeof value === 'boolean' ? value : toNumber(value) !== 0;
  }

  /** Conditions of AND/OR: range cells that hold text or nothing are skipped. */
  function booleansOf(args) {
    const isLogical = (value) => typeof value === 'boolean' || typeof value === 'number';
    return args.flatMap((arg) => (Array.isArray(arg) ? arg.filter(isLogical) : [arg])).map(toBoolean);
  }

  const CRITERION = /^(<=|>=|<>|<|>|=)(.*)$/;

  /** The test of a SUMIF/COUNTIF criterion such as 100, "Food", ">100", "<>Food" or ">=2026-01-31". Numbers and dates match numbers, text matches text. */
  function criterionTest(criterion) {
    const [, operator = '=', operand = criterion] = (typeof criterion === 'string' && CRITERION.exec(criterion)) || [];
    const typed = typeof operand === 'string' ? literalNumber(operand) ?? parseDate(operand)?.serial : null;
    const wanted = typeof operand === 'number' ? operand : typed ?? toText(operand);
    return (value) => typeof value === typeof wanted && BINARY[operator](value, wanted);
  }

  /** The cells of `results` whose cell at the same place in `range` meets the criterion. */
  function matching(range, criterion, results) {
    const isUsable = Array.isArray(range) && Array.isArray(results) && !Array.isArray(criterion) && range.length === results.length;
    if (!isUsable) throw new FormulaError(ERRORS.VALUE);
    const matches = criterionTest(criterion);
    return results.filter((result, index) => matches(range[index]));
  }

  // A date is the number of days since 1970-01-01, so dates can be subtracted and days added.
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  function dateSerial(year, month, day) {
    return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
  }

  function dateParts(serial) {
    const date = new Date(Math.floor(serial) * MS_PER_DAY);
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
  }

  function today() {
    const now = new Date();
    return dateSerial(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }

  // How a date can be typed; `order` gives the pattern groups holding year, month, day.
  const TYPED_DATES = [
    { format: 'date', pattern: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, order: [1, 2, 3] },
    { format: 'date-dmy', pattern: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, order: [3, 2, 1] },
  ];

  /** A typed date as { serial, format }, or null when the text is not a date that exists. */
  function parseDate(text) {
    for (const { format, pattern, order } of TYPED_DATES) {
      const match = pattern.exec(text.trim());
      if (!match) continue;
      const [year, month, day] = order.map((group) => Number(match[group]));
      const serial = dateSerial(year, month, day);
      const parts = dateParts(serial);
      return parts.month === month && parts.day === day ? { serial, format } : null;
    }
    return null;
  }

  const DATE_FORMAT_NAMES = TYPED_DATES.map((typed) => typed.format);
  const DATE_MAKERS = ['TODAY', 'DATE'];
  const DATE_KEEPERS = ['MIN', 'MAX', 'IF']; // they give back one of their arguments
  const IF_CONDITION_ARGS = 1;

  /**
   * The date format the result of a formula should be shown in, or null when the result is not a date.
   * A date is: a date cell (dateFormatAt(col, row, sheetName) gives its format, or null), TODAY() or DATE(),
   * a date plus or minus a number, or what MIN, MAX or IF pick among dates.
   */
  function dateFormatOf(node, dateFormatAt) {
    const of = (child) => dateFormatOf(child, dateFormatAt);
    if (node.type === 'ref') return dateFormatAt(node.col, node.row, node.sheet);
    if (node.type === 'range') return dateFormatAt(node.from.col, node.from.row, node.sheet);
    if (node.type === 'binary') return dateFormatOfSum(node.op, of(node.left), of(node.right));
    if (node.type !== 'call') return null;
    if (DATE_MAKERS.includes(node.name)) return DATE_FORMAT_NAMES[0];
    if (!DATE_KEEPERS.includes(node.name)) return null;
    const results = node.args.slice(node.name === 'IF' ? IF_CONDITION_ARGS : 0);
    return results.map(of).find(Boolean) ?? null;
  }

  /** date + days and date - days are dates; date - date is a number of days, and date + date means nothing. */
  function dateFormatOfSum(operator, left, right) {
    if (operator === '+') return left && right ? null : left ?? right;
    return operator === '-' && !right ? left : null;
  }

  const extreme = (pick, numbers) => (numbers.length === 0 ? 0 : pick(...numbers));

  const FUNCTIONS = {
    SUM: (args) => sum(numbersOf(args)),
    AVERAGE: (args) => average(numbersOf(args)),
    MIN: (args) => extreme(Math.min, numbersOf(args)),
    MAX: (args) => extreme(Math.max, numbersOf(args)),
    COUNT: (args) => numbersOf(args).length,
    ABS: (args) => Math.abs(toNumber(args[0])),
    ROUND: (args) => roundTo(toNumber(args[0]), toNumber(args[1] ?? 0)),
    COUNTA: (args) => args.flat().filter((value) => value !== '').length,
    AND: (args) => booleansOf(args).every(Boolean),
    OR: (args) => booleansOf(args).some(Boolean),
    NOT: (args) => !toBoolean(args[0]),
    SUMIF: (args) => sum(matching(args[0], args[1], args[2] ?? args[0]).filter((value) => typeof value === 'number')),
    COUNTIF: (args) => matching(args[0], args[1], args[0]).length,
    TODAY: today,
    DATE: (args) => dateSerial(toNumber(args[0]), toNumber(args[1]), toNumber(args[2])),
    YEAR: (args) => dateParts(toNumber(args[0])).year,
    MONTH: (args) => dateParts(toNumber(args[0])).month,
    DAY: (args) => dateParts(toNumber(args[0])).day,
  };

  function rangeValues(range, context) {
    const values = [];
    for (let row = Math.min(range.from.row, range.to.row); row <= Math.max(range.from.row, range.to.row); row++) {
      for (let col = Math.min(range.from.col, range.to.col); col <= Math.max(range.from.col, range.to.col); col++) {
        values.push(context.cell(col, row, range.sheet));
      }
    }
    return values;
  }

  /**
   * context.cell(col, row, sheetName) returns the value of a cell, or throws its FormulaError; sheetName is
   * undefined for the formula's own sheet. context.nameRange(name) returns the area { sheet, from, to } a name
   * stands for, or undefined.
   */
  function evaluate(node, context) {
    const scalar = (child) => {
      const value = evaluate(child, context);
      if (Array.isArray(value)) throw new FormulaError(ERRORS.VALUE);
      return value;
    };
    switch (node.type) {
      case 'literal': return node.value;
      case 'error': throw new FormulaError(node.code);
      case 'name': return namedValue(node.name, context);
      case 'ref': return context.cell(node.col, node.row, node.sheet);
      case 'range': return rangeValues(node, context);
      case 'negate': return -toNumber(scalar(node.operand));
      case 'percent': return toNumber(scalar(node.operand)) / 100;
      case 'binary': return BINARY[node.op](scalar(node.left), scalar(node.right));
      default: return call(node, context, scalar);
    }
  }

  /** A name that stands for one cell gives its value; for more cells it gives them all, like a range. */
  function namedValue(name, context) {
    const area = context.nameRange?.(name);
    if (!area) throw new FormulaError(ERRORS.NAME);
    const isOneCell = area.from.col === area.to.col && area.from.row === area.to.row;
    return isOneCell ? context.cell(area.from.col, area.from.row, area.sheet) : rangeValues(area, context);
  }

  function call(node, context, scalar) {
    if (node.name === 'IF') return evaluateIf(node.args, scalar);
    if (node.name === 'SQL') return evaluateQuery(node.args, scalar, context);
    const fn = FUNCTIONS[node.name];
    if (!fn) throw new FormulaError(ERRORS.NAME);
    return fn(node.args.map((arg) => evaluate(arg, context)));
  }

  /**
   * SQL("select ... from table ...", value, ...): the query names its tables itself, so it gets context.table(text),
   * which returns { headers, rows, formats } for a name or an area. The values after the query fill its ? in order.
   */
  function evaluateQuery(args, scalar, context) {
    if (args.length === 0 || !context.table) throw new FormulaError(ERRORS.VALUE);
    const [query, ...parameters] = args.map(scalar);
    return root.XL.runQuery(toText(query), parameters, context.table);
  }

  /** Only the chosen branch is evaluated, so an error in the other one does not leak. */
  function evaluateIf(args, scalar) {
    if (args.length < 2 || args.length > 3) throw new FormulaError(ERRORS.SYNTAX);
    if (toBoolean(scalar(args[0]))) return scalar(args[1]);
    return args.length === 3 ? scalar(args[2]) : false;
  }

  const REF_PATTERN = String.raw`(\$?)([A-Za-z]{1,3})(\$?)(\d+)`;
  // A reference or a whole range: group 1 is the sheet name as written, if given, 2-5 describe the first reference, 6 the colon, 7-10 the second one.
  const REFS_IN_FORMULA = new RegExp(String.raw`(?<![A-Za-z0-9_$!])(?:(${WRITTEN_SHEET_NAME})!)?${REF_PATTERN}(?:(\s*:\s*)${REF_PATTERN})?(?![A-Za-z0-9_(])`, 'g');
  const STRING_LITERAL = /("(?:[^"]|"")*")/;

  const AREA = new RegExp(String.raw`^(?:(${WRITTEN_SHEET_NAME})!)?${REF_PATTERN}(?::${REF_PATTERN})?$`);

  /** A typed address such as B7, A1:C3 or 'Year 2026'!A1:C3 as { sheet, from, to } with from at the top-left; null for anything else. */
  function parseArea(text) {
    const found = AREA.exec(text.trim());
    if (!found) return null;
    const first = toRef(found.slice(2, 6));
    const second = found[7] === undefined ? first : toRef(found.slice(6, 10));
    return {
      sheet: found[1] && unquoted(found[1]),
      from: { col: Math.min(first.col, second.col), row: Math.min(first.row, second.row) },
      to: { col: Math.max(first.col, second.col), row: Math.max(first.row, second.row) },
    };
  }

  /** B7 for one cell, A1:C3 for more. */
  function areaText({ from, to }) {
    const start = refKey(from.col, from.row);
    const end = refKey(to.col, to.row);
    return start === end ? start : start + ':' + end;
  }

  /** A name for cells is one word that cannot be mistaken for a cell address (A1, TAX2026) or for TRUE and FALSE. */
  function isRangeName(name) {
    return new RegExp(`^${SIMPLE_SHEET_NAME}$`).test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name) && !/^(true|false)$/i.test(name);
  }

  const toRef = ([pinCol, letters, pinRow, digits]) => ({ pinCol, col: colIndex(letters), pinRow, row: Number(digits) - 1 });
  const refText = (ref) => ref.pinCol + colName(ref.col) + ref.pinRow + (ref.row + 1);

  /**
   * Rewrites the references of a formula. rewrite gets the one reference, or the two ends of a range,
   * plus the sheet name written in front of them (undefined when there is none), and returns the
   * references changed, or null when they no longer point at anything (shown as #REF!).
   */
  function rewriteRefs(raw, rewrite) {
    const replace = (match, sheetName, ...groups) => { // sheetName as written, so with its quotes
      const isRange = groups[4] !== undefined;
      const refs = [toRef(groups.slice(0, 4))].concat(isRange ? [toRef(groups.slice(5, 9))] : []);
      const rewritten = rewrite(refs, sheetName && unquoted(sheetName));
      if (rewritten === null) return ERRORS.REF;
      return (sheetName ? sheetName + '!' : '') + rewritten.map(refText).join(':');
    };
    return outsideStrings(raw, (part) => part.replace(REFS_IN_FORMULA, replace));
  }

  /** Applies the change to a formula, leaving the text between double quotes alone; anything that is not a formula is returned as it is. */
  function outsideStrings(raw, change) {
    if (!raw.startsWith('=')) return raw;
    const isLiteral = (index) => index % 2 === 1; // split keeps the captured string literals at odd positions
    return raw.split(STRING_LITERAL).map((part, i) => (isLiteral(i) ? part : change(part))).join('');
  }

  /** Follows a sheet that was renamed: Old!A1 becomes New!A1, or 'New name'!A1. */
  function renameSheetRefs(raw, oldName, newName) {
    const name = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const prefix = new RegExp(`(?<![A-Za-z0-9_'])(?:'${name}'|${name})!`, 'gi');
    return outsideStrings(raw, (part) => part.replace(prefix, () => sheetPrefix(newName)));
  }

  /** Moves the relative references of a formula, as when it is copied to another cell; $ pins a column or row. */
  function shiftRefs(raw, dCol, dRow) {
    return rewriteRefs(raw, (refs) => {
      const moved = refs.map((ref) => ({ ...ref, col: ref.col + (ref.pinCol ? 0 : dCol), row: ref.row + (ref.pinRow ? 0 : dRow) }));
      return moved.some((ref) => ref.col < 0 || ref.row < 0) ? null : moved;
    });
  }

  /**
   * Where a row or column index ends up after `count` rows/columns are inserted at `at` (count > 0)
   * or removed from `at` on (count < 0). A removed index gives null, unless it is the low or high
   * end of a range, which then shrinks to what is left.
   */
  function movedIndex(index, at, count, rangeEnd) {
    if (index < at) return index;
    const isRemoved = count < 0 && index < at - count;
    if (!isRemoved) return index + count;
    if (rangeEnd === 'low') return at;
    return rangeEnd === 'high' ? at - 1 : null;
  }

  const hasNoSheetName = (sheetName) => sheetName === undefined;

  /**
   * Keeps the references of a formula pointing at the same cells after rows or columns (axis 'row' | 'col')
   * were inserted or removed. pointsAtChangedSheet(sheetName) tells which references are about that sheet.
   */
  function restructureRefs(raw, axis, at, count, pointsAtChangedSheet = hasNoSheetName) {
    return rewriteRefs(raw, (refs, sheetName) => {
      if (!pointsAtChangedSheet(sheetName)) return refs;
      const isRange = refs.length === 2;
      const lowFirst = !isRange || refs[0][axis] <= refs[1][axis];
      const endOf = (position) => (isRange ? ((position === 0) === lowFirst ? 'low' : 'high') : null);
      const moved = refs.map((ref, position) => ({ ...ref, [axis]: movedIndex(ref[axis], at, count, endOf(position)) }));
      const [low, high] = lowFirst ? moved : [moved[1], moved[0]];
      const isGone = moved.some((ref) => ref[axis] === null) || (isRange && low[axis] > high[axis]);
      return isGone ? null : moved;
    });
  }

  root.XL = Object.assign(root.XL || {}, { ERRORS, FormulaError, colName, refKey, parse, evaluate, roundTo, shiftRefs, parseRef, movedIndex, restructureRefs, parseDate, dateParts, plainNumber, isSheetName, renameSheetRefs, literalNumber, dateFormatOf, DATE_FORMAT_NAMES, parseArea, areaText, isRangeName, sheetPrefix });
  root.XL.FUNCTION_NAMES = ['IF', 'SQL', ...Object.keys(FUNCTIONS)];
  Object.assign(root.XL, { Table, detailedError, compareValues: compare });
})(typeof window !== 'undefined' ? window : globalThis);
