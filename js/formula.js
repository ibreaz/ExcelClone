/* Formula engine: tokenizer, recursive-descent parser and evaluator. No DOM access. */
(function (root) {
  'use strict';

  const ERRORS = { DIV: '#DIV/0!', NAME: '#NAME?', VALUE: '#VALUE!', CYCLE: '#CYCLE!', SYNTAX: '#ERROR!', REF: '#REF!' };

  /** An error shown in a cell; the message is one of ERRORS. */
  class FormulaError extends Error {}

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

  // Groups: 1 number, 2 string, 3 cell reference, 4 name, 5 operator, 6 the mark left by a deleted reference.
  const TOKEN = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+)|"((?:[^"]|"")*)"|(\$?[A-Za-z]{1,3}\$?\d+)(?![A-Za-z0-9_(])|([A-Za-z_][A-Za-z0-9_]*)|(<=|>=|<>|[-+*\/^&=<>(),;:%])|(#REF!))/y;

  function tokenize(text) {
    const source = text.trimEnd();
    const tokens = [];
    TOKEN.lastIndex = 0;
    while (TOKEN.lastIndex < source.length) {
      const match = TOKEN.exec(source);
      if (!match) throw new FormulaError(ERRORS.SYNTAX);
      tokens.push(toToken(match));
    }
    return tokens;
  }

  function toToken(match) {
    if (match[1] !== undefined) return { type: 'number', value: Number(match[1]) };
    if (match[2] !== undefined) return { type: 'string', value: match[2].replace(/""/g, '"') };
    if (match[3] !== undefined) return { type: 'ref', value: match[3] };
    if (match[4] !== undefined) return { type: 'name', value: match[4].toUpperCase() };
    if (match[6] !== undefined) return { type: 'error', value: ERRORS.REF };
    return { type: 'op', value: match[5] };
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
      if (!isOp(':')) return { type: 'ref', ...from };
      pos++;
      const end = tokens[pos++];
      if (!end || end.type !== 'ref') fail();
      return { type: 'range', from, to: parseRef(end.value) };
    }

    function named(name) {
      if (name === 'TRUE' || name === 'FALSE') return literal(name === 'TRUE');
      expectOp('(');
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

  /** The test of a SUMIF/COUNTIF criterion such as 100, "Food", ">100" or "<>Food". Numbers match numbers, text matches text. */
  function criterionTest(criterion) {
    const [, operator = '=', operand = criterion] = (typeof criterion === 'string' && CRITERION.exec(criterion)) || [];
    const isNumber = typeof operand === 'number' || (typeof operand === 'string' && operand.trim() !== '' && !Number.isNaN(Number(operand)));
    const wanted = isNumber ? Number(operand) : toText(operand);
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

  function rangeValues(range, getValue) {
    const values = [];
    for (let row = Math.min(range.from.row, range.to.row); row <= Math.max(range.from.row, range.to.row); row++) {
      for (let col = Math.min(range.from.col, range.to.col); col <= Math.max(range.from.col, range.to.col); col++) {
        values.push(getValue(col, row));
      }
    }
    return values;
  }

  /** getValue(col, row) returns the value of a cell, or throws its FormulaError. */
  function evaluate(node, getValue) {
    const scalar = (child) => {
      const value = evaluate(child, getValue);
      if (Array.isArray(value)) throw new FormulaError(ERRORS.VALUE);
      return value;
    };
    switch (node.type) {
      case 'literal': return node.value;
      case 'error': throw new FormulaError(node.code);
      case 'ref': return getValue(node.col, node.row);
      case 'range': return rangeValues(node, getValue);
      case 'negate': return -toNumber(scalar(node.operand));
      case 'percent': return toNumber(scalar(node.operand)) / 100;
      case 'binary': return BINARY[node.op](scalar(node.left), scalar(node.right));
      default: return call(node, getValue, scalar);
    }
  }

  function call(node, getValue, scalar) {
    if (node.name === 'IF') return evaluateIf(node.args, scalar);
    const fn = FUNCTIONS[node.name];
    if (!fn) throw new FormulaError(ERRORS.NAME);
    return fn(node.args.map((arg) => evaluate(arg, getValue)));
  }

  /** Only the chosen branch is evaluated, so an error in the other one does not leak. */
  function evaluateIf(args, scalar) {
    if (args.length < 2 || args.length > 3) throw new FormulaError(ERRORS.SYNTAX);
    if (toBoolean(scalar(args[0]))) return scalar(args[1]);
    return args.length === 3 ? scalar(args[2]) : false;
  }

  const REF_PATTERN = String.raw`(\$?)([A-Za-z]{1,3})(\$?)(\d+)`;
  // A reference or a whole range; groups 1-4 describe the first reference, 5 the colon, 6-9 the second one.
  const REFS_IN_FORMULA = new RegExp(String.raw`(?<![A-Za-z0-9_$])${REF_PATTERN}(?:(\s*:\s*)${REF_PATTERN})?(?![A-Za-z0-9_(])`, 'g');
  const STRING_LITERAL = /("(?:[^"]|"")*")/;

  const toRef = ([pinCol, letters, pinRow, digits]) => ({ pinCol, col: colIndex(letters), pinRow, row: Number(digits) - 1 });
  const refText = (ref) => ref.pinCol + colName(ref.col) + ref.pinRow + (ref.row + 1);

  /**
   * Rewrites the references of a formula. rewrite gets the one reference, or the two ends of a range,
   * and returns them changed, or null when they no longer point at anything (shown as #REF!).
   */
  function rewriteRefs(raw, rewrite) {
    if (!raw.startsWith('=')) return raw;
    const replace = (match, ...groups) => {
      const isRange = groups[4] !== undefined;
      const refs = [toRef(groups.slice(0, 4))].concat(isRange ? [toRef(groups.slice(5, 9))] : []);
      const rewritten = rewrite(refs);
      return rewritten === null ? ERRORS.REF : rewritten.map(refText).join(':');
    };
    const isLiteral = (index) => index % 2 === 1; // split keeps the captured string literals at odd positions
    return raw.split(STRING_LITERAL).map((part, i) => (isLiteral(i) ? part : part.replace(REFS_IN_FORMULA, replace))).join('');
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

  /** Keeps the references of a formula pointing at the same cells after rows or columns (axis 'row' | 'col') were inserted or removed. */
  function restructureRefs(raw, axis, at, count) {
    return rewriteRefs(raw, (refs) => {
      const isRange = refs.length === 2;
      const lowFirst = !isRange || refs[0][axis] <= refs[1][axis];
      const endOf = (position) => (isRange ? ((position === 0) === lowFirst ? 'low' : 'high') : null);
      const moved = refs.map((ref, position) => ({ ...ref, [axis]: movedIndex(ref[axis], at, count, endOf(position)) }));
      const [low, high] = lowFirst ? moved : [moved[1], moved[0]];
      const isGone = moved.some((ref) => ref[axis] === null) || (isRange && low[axis] > high[axis]);
      return isGone ? null : moved;
    });
  }

  root.XL = Object.assign(root.XL || {}, { ERRORS, FormulaError, colName, refKey, parse, evaluate, roundTo, shiftRefs, parseRef, movedIndex, restructureRefs, parseDate, dateParts, plainNumber });
  root.XL.FUNCTION_NAMES = ['IF', ...Object.keys(FUNCTIONS)];
})(typeof window !== 'undefined' ? window : globalThis);
