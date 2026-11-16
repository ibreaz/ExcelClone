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

  // Groups: 1 number, 2 string, 3 cell reference, 4 name, 5 operator.
  const TOKEN = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+)|"((?:[^"]|"")*)"|(\$?[A-Za-z]{1,3}\$?\d+)(?![A-Za-z0-9_(])|([A-Za-z_][A-Za-z0-9_]*)|(<=|>=|<>|[-+*\/^&=<>(),;:%]))/y;

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

  function toText(value) {
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    return String(value);
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

  const extreme = (pick, numbers) => (numbers.length === 0 ? 0 : pick(...numbers));

  const FUNCTIONS = {
    SUM: (args) => sum(numbersOf(args)),
    AVERAGE: (args) => average(numbersOf(args)),
    MIN: (args) => extreme(Math.min, numbersOf(args)),
    MAX: (args) => extreme(Math.max, numbersOf(args)),
    COUNT: (args) => numbersOf(args).length,
    ABS: (args) => Math.abs(toNumber(args[0])),
    ROUND: (args) => roundTo(toNumber(args[0]), toNumber(args[1] ?? 0)),
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
    if (node.args.length === 0) throw new FormulaError(ERRORS.SYNTAX);
    return fn(node.args.map((arg) => evaluate(arg, getValue)));
  }

  /** Only the chosen branch is evaluated, so an error in the other one does not leak. */
  function evaluateIf(args, scalar) {
    if (args.length < 2 || args.length > 3) throw new FormulaError(ERRORS.SYNTAX);
    const condition = scalar(args[0]);
    const isTrue = typeof condition === 'boolean' ? condition : toNumber(condition) !== 0;
    if (isTrue) return scalar(args[1]);
    return args.length === 3 ? scalar(args[2]) : false;
  }

  const REF_IN_FORMULA = /(?<![A-Za-z0-9_$])(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(])/g;
  const STRING_LITERAL = /("(?:[^"]|"")*")/;

  /** Moves the relative references of a formula, as when it is copied to another cell; $ pins a column or row. */
  function shiftRefs(raw, dCol, dRow) {
    if (!raw.startsWith('=')) return raw;
    const shift = (match, pinCol, letters, pinRow, digits) => {
      const col = colIndex(letters) + (pinCol ? 0 : dCol);
      const row = Number(digits) - 1 + (pinRow ? 0 : dRow);
      return col < 0 || row < 0 ? ERRORS.REF : pinCol + colName(col) + pinRow + (row + 1);
    };
    const isLiteral = (index) => index % 2 === 1; // split keeps the captured string literals at odd positions
    return raw.split(STRING_LITERAL).map((part, i) => (isLiteral(i) ? part : part.replace(REF_IN_FORMULA, shift))).join('');
  }

  root.XL = Object.assign(root.XL || {}, { ERRORS, FormulaError, colName, refKey, parse, evaluate, roundTo, shiftRefs });
})(typeof window !== 'undefined' ? window : globalThis);
