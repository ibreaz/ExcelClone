/* A small SQL SELECT over tables of cells (first row = column names). No DOM access. */
(function (root) {
  'use strict';

  const { ERRORS, Table, detailedError, compareValues, literalNumber, parseDate } = root.XL;

  const KEYWORDS = ['SELECT', 'DISTINCT', 'FROM', 'JOIN', 'ON', 'WHERE', 'GROUP', 'BY', 'ORDER', 'ASC', 'DESC', 'LIMIT', 'AS', 'AND', 'OR', 'NOT', 'LIKE'];
  const FORMAT_KEEPERS = ['SUM', 'AVG', 'MIN', 'MAX']; // their result is shown like the column they work on
  const NEAR_LENGTH = 25;

  const fail = (message) => { throw detailedError(ERRORS.SQL, message); };

  // A column name with spaces is written [like this] or "like this".
  const TOKEN = /\s*(?:(?<number>\d+\.?\d*|\.\d+)|'(?<string>(?:[^']|'')*)'|"(?<quoted>[^"]+)"|\[(?<bracketed>[^\]]+)\]|(?<word>[A-Za-z_][A-Za-z0-9_]*)|(?<op><=|>=|<>|!=|[-+*\/=<>(),.?]))/y;
  // After FROM and JOIN comes a table: a name, or an area such as A1:D9 or 'Year 2026'!A1:D9.
  const SOURCE = /\s*((?:(?:'[^']+'|[A-Za-z_][A-Za-z0-9_]*)!)?\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?|[A-Za-z_][A-Za-z0-9_]*)/y;

  function toToken(found) {
    if (found.number !== undefined) return { type: 'number', value: Number(found.number) };
    if (found.string !== undefined) return { type: 'string', value: found.string.replace(/''/g, "'") };
    if (found.op !== undefined) return { type: 'op', value: found.op };
    const name = found.quoted ?? found.bracketed;
    if (name !== undefined) return { type: 'name', value: name };
    const isKeyword = KEYWORDS.includes(found.word.toUpperCase());
    return isKeyword ? { type: 'keyword', value: found.word.toUpperCase() } : { type: 'name', value: found.word };
  }

  function tokenize(query) {
    const text = query.trimEnd();
    const tokens = [];
    let position = 0;
    while (position < text.length) {
      const last = tokens[tokens.length - 1];
      const expectsTable = last?.type === 'keyword' && (last.value === 'FROM' || last.value === 'JOIN');
      const pattern = expectsTable ? SOURCE : TOKEN;
      pattern.lastIndex = position;
      const match = pattern.exec(text);
      if (!match) fail(`Cannot read the query at: ${text.slice(position, position + NEAR_LENGTH).trim()}`);
      const token = expectsTable ? { type: 'table', value: match[1] } : toToken(match.groups);
      tokens.push({ ...token, start: match.index, end: pattern.lastIndex });
      position = pattern.lastIndex;
    }
    return tokens;
  }

  /** SELECT [DISTINCT] items FROM table [alias] {JOIN table [alias] ON condition} [WHERE] [GROUP BY] [ORDER BY] [LIMIT]. */
  function parseQuery(query) {
    const tokens = tokenize(query);
    let pos = 0;
    let parameters = 0;
    const is = (type, ...values) => pos < tokens.length && tokens[pos].type === type && (values.length === 0 || values.includes(tokens[pos].value));
    const isThe = (type, value) => (value === undefined ? is(type) : is(type, value));
    const near = () => (pos < tokens.length ? `at: ${query.slice(tokens[pos].start).trim().slice(0, NEAR_LENGTH)}` : 'at the end of the query');
    const expect = (type, value) => (isThe(type, value) ? tokens[pos++] : fail(`Expected ${value ?? 'a ' + type} ${near()}`));
    const skip = (type, value) => isThe(type, value) && Boolean(tokens[pos++]);
    const list = (parseOne) => {
      const items = [parseOne()];
      while (skip('op', ',')) items.push(parseOne());
      return items;
    };
    const binary = (operand, type, tokenType, operators) => () => {
      let left = operand();
      while (is(tokenType, ...operators)) left = { type, op: tokens[pos++].value, left, right: operand() };
      return left;
    };

    function primary() {
      if (is('number') || is('string')) return { type: 'literal', value: tokens[pos++].value };
      if (skip('op', '?')) return { type: 'parameter', index: parameters++ };
      if (skip('op', '(')) {
        const inner = condition();
        expect('op', ')');
        return inner;
      }
      const name = expect('name').value;
      if (skip('op', '(')) return aggregate(name.toUpperCase());
      return { type: 'column', name: skip('op', '.') ? `${name}.${expect('name').value}` : name };
    }

    function aggregate(fn) {
      if (!AGGREGATES[fn]) fail(`Unknown function ${fn}: there are SUM, COUNT, AVG, MIN and MAX`);
      const argument = skip('op', '*') ? null : condition();
      if (argument === null && fn !== 'COUNT') fail(`${fn}(*) means nothing: name a column`);
      expect('op', ')');
      return { type: 'aggregate', fn, argument };
    }

    const unary = () => (skip('op', '-') ? { type: 'negate', operand: unary() } : primary());
    const product = binary(unary, 'arithmetic', 'op', ['*', '/']);
    const sum = binary(product, 'arithmetic', 'op', ['+', '-']);

    function comparison() {
      const left = sum();
      if (is('op', ...Object.keys(COMPARISONS))) return { type: 'compare', op: tokens[pos++].value, left, right: sum() };
      return skip('keyword', 'LIKE') ? { type: 'like', left, right: sum() } : left;
    }

    const negation = () => (skip('keyword', 'NOT') ? { type: 'not', operand: negation() } : comparison());
    const conjunction = binary(negation, 'logic', 'keyword', ['AND']);
    const condition = binary(conjunction, 'logic', 'keyword', ['OR']);

    function selectItem() {
      if (skip('op', '*')) return { isEverything: true };
      const first = pos;
      const expr = condition();
      const written = query.slice(tokens[first].start, tokens[pos - 1].end).trim();
      return { expr, label: skip('keyword', 'AS') ? expect('name').value : written };
    }

    function table() {
      const text = expect('table').value;
      skip('keyword', 'AS');
      return { text, label: is('name') ? tokens[pos++].value : text };
    }

    function orderItem() {
      const expr = condition();
      const isDescending = skip('keyword', 'DESC');
      skip('keyword', 'ASC');
      return { expr, isDescending };
    }

    expect('keyword', 'SELECT');
    const plan = { isDistinct: skip('keyword', 'DISTINCT'), items: list(selectItem), joins: [] };
    expect('keyword', 'FROM');
    plan.from = table();
    while (skip('keyword', 'JOIN')) plan.joins.push({ table: table(), on: expect('keyword', 'ON') && condition() });
    plan.where = skip('keyword', 'WHERE') ? condition() : null;
    plan.groupBy = skip('keyword', 'GROUP') && expect('keyword', 'BY') ? list(condition) : [];
    plan.orderBy = skip('keyword', 'ORDER') && expect('keyword', 'BY') ? list(orderItem) : [];
    plan.limit = skip('keyword', 'LIMIT') ? expect('number').value : Infinity;
    if (pos < tokens.length) fail(`Unexpected text ${near()}`);
    return plan;
  }

  // ---------- values ----------

  const isNumber = (value) => typeof value === 'number';
  const isTrue = (value) => (typeof value === 'boolean' ? value : value !== '' && value !== 0);

  function numberOf(value) {
    if (isNumber(value)) return value;
    if (value === '' || typeof value === 'boolean') return Number(value);
    return literalNumber(value) ?? fail(`"${value}" is not a number`);
  }

  /** A number compared with a text reads the text as a number or a date when it is one: amount > '100', date >= '2026-01-31'. */
  function comparePair(a, b) {
    const typed = (text) => literalNumber(text) ?? parseDate(text)?.serial ?? text;
    if (isNumber(a) && typeof b === 'string') return compareValues(a, typed(b));
    if (isNumber(b) && typeof a === 'string') return compareValues(typed(a), b);
    return compareValues(a, b);
  }

  const COMPARISONS = {
    '=': (order) => order === 0, '<>': (order) => order !== 0, '!=': (order) => order !== 0,
    '<': (order) => order < 0, '>': (order) => order > 0, '<=': (order) => order <= 0, '>=': (order) => order >= 0,
  };

  const ARITHMETIC = {
    '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b,
    '/': (a, b) => (b === 0 ? fail('Division by zero') : a / b),
  };

  /** LIKE: % stands for any text, _ for one character; upper and lower case are the same. */
  function isLike(value, pattern) {
    const escaped = String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
    return new RegExp(`^${escaped}$`, 'i').test(String(value));
  }

  const total = (numbers) => numbers.reduce((sum, number) => sum + number, 0);

  /** The smallest (direction 1) or largest (-1): among the numbers when there are any, otherwise among the texts. */
  function extreme(values, direction) {
    const numbers = values.filter(isNumber);
    const candidates = numbers.length > 0 ? numbers : values.filter((value) => value !== '');
    return candidates.reduce((best, value) => (comparePair(value, best) * direction < 0 ? value : best), candidates[0] ?? '');
  }

  // Each takes the values of its argument over the rows of a group; COUNT(*) gets the rows themselves.
  const AGGREGATES = {
    COUNT: (values) => values.filter((value) => value !== '').length,
    SUM: (values) => total(values.filter(isNumber)),
    AVG: (values) => (values.some(isNumber) ? total(values.filter(isNumber)) / values.filter(isNumber).length : ''),
    MIN: (values) => extreme(values, 1),
    MAX: (values) => extreme(values, -1),
  };

  // ---------- running ----------

  /** A row is a Map from lower-case column name, plain and as table.column, to the value. */
  function rowsOf(table) {
    const keys = table.headers.map((header) => header.toLowerCase());
    return table.rows.map((values) => new Map(keys.flatMap((key, i) => [[key, values[i]], [`${table.label.toLowerCase()}.${key}`, values[i]]])));
  }

  /** When two tables have a column of the same name, the plain name means the first table's; the other needs table.column. */
  const joined = (left, right) => new Map([...right, ...left]);

  function containsAggregate(node) {
    if (node === null || typeof node !== 'object') return false;
    return node.type === 'aggregate' || Object.values(node).some(containsAggregate);
  }

  function runQuery(query, parameters, loadTable) {
    const plan = parseQuery(query);
    const tables = [plan.from, ...plan.joins.map((join) => join.table)].map((source) => ({ ...loadTable(source.text), label: source.label }));

    /** row: the row an expression is about; group: the rows SUM and the like work on, or null where they are not allowed. */
    function evaluate(node, row, group) {
      const of = (child) => evaluate(child, row, group);
      switch (node.type) {
        case 'literal': return node.value;
        case 'parameter': return node.index < parameters.length ? parameters[node.index] : fail('The query has more ? than values given after it');
        case 'column': return column(node.name, row);
        case 'negate': return -numberOf(of(node.operand));
        case 'arithmetic': return ARITHMETIC[node.op](numberOf(of(node.left)), numberOf(of(node.right)));
        case 'compare': return COMPARISONS[node.op](comparePair(of(node.left), of(node.right)));
        case 'like': return isLike(of(node.left), of(node.right));
        case 'not': return !isTrue(of(node.operand));
        case 'logic': return node.op === 'AND' ? isTrue(of(node.left)) && isTrue(of(node.right)) : isTrue(of(node.left)) || isTrue(of(node.right));
        default: return aggregated(node, group);
      }
    }

    function column(name, row) {
      if (!row) return ''; // a total over no rows at all
      return row.has(name.toLowerCase()) ? row.get(name.toLowerCase()) : fail(`There is no column "${name}"`);
    }

    function aggregated(node, group) {
      if (!group) fail(`${node.fn} works on groups of rows: it cannot be used in WHERE or ON`);
      return AGGREGATES[node.fn](node.argument ? group.map((row) => evaluate(node.argument, row, null)) : group);
    }

    let rows = rowsOf(tables[0]);
    plan.joins.forEach((join, index) => {
      const others = rowsOf(tables[index + 1]);
      rows = rows.flatMap((left) => others.map((right) => joined(left, right)).filter((row) => isTrue(evaluate(join.on, row, null))));
    });
    if (plan.where) rows = rows.filter((row) => isTrue(evaluate(plan.where, row, null)));

    const formats = new Map(tables.flatMap((table) => table.headers.flatMap((header, i) => {
      const key = header.toLowerCase();
      return [[`${table.label.toLowerCase()}.${key}`, table.formats[i]], [key, table.formats[i]]];
    }).reverse())); // reversed so that, as in joined rows, the first table wins a shared plain name
    const formatOf = (expr) => {
      const source = expr.type === 'aggregate' && FORMAT_KEEPERS.includes(expr.fn) ? expr.argument : expr;
      return source?.type === 'column' ? formats.get(source.name.toLowerCase()) : undefined;
    };
    const everything = tables.flatMap((table) => table.headers.map((header) => ({ label: header, expr: { type: 'column', name: `${table.label}.${header}` } })));
    const columns = plan.items.flatMap((item) => (item.isEverything ? everything : [item]));

    const isGrouped = plan.groupBy.length > 0 || [...columns, ...plan.orderBy].some((item) => containsAggregate(item.expr));
    const groups = isGrouped ? groupRows(rows, plan.groupBy, (expr, row) => evaluate(expr, row, null)) : rows.map((row) => [row]);
    let records = groups.map((group) => {
      const scope = isGrouped ? group : null;
      return { row: group[0], scope, values: columns.map((item) => evaluate(item.expr, group[0], scope)) };
    });
    if (plan.isDistinct) records = [...new Map(records.map((record) => [sameness(record.values), record])).values()];

    /** ORDER BY takes a result column by its name or its number, or any expression over the row. */
    const sortValue = (record, expr) => {
      const named = expr.type === 'column' ? columns.findIndex((item) => item.label.toLowerCase() === expr.name.toLowerCase()) : -1;
      const index = expr.type === 'literal' && isNumber(expr.value) ? expr.value - 1 : named;
      return index >= 0 && index < columns.length ? record.values[index] : evaluate(expr, record.row, record.scope);
    };
    const sorted = records.map((record) => ({ record, keys: plan.orderBy.map((item) => sortValue(record, item.expr)) }));
    sorted.sort((a, b) => plan.orderBy.reduce((order, item, i) => order || comparePair(a.keys[i], b.keys[i]) * (item.isDescending ? -1 : 1), 0));

    const lines = sorted.slice(0, plan.limit).map(({ record }) => record.values);
    return new Table([columns.map((item) => item.label), ...lines], columns.map((item) => formatOf(item.expr)));
  }

  /** A key that is equal for values the query treats as the same: texts that differ only in case are. */
  const sameness = (values) => JSON.stringify(values.map((value) => (typeof value === 'string' ? value.toLowerCase() : value)));

  /** Rows with the same values for the GROUP BY expressions, in the order they first appear; without GROUP BY, all rows are one group. */
  function groupRows(rows, groupBy, valueOf) {
    if (groupBy.length === 0) return [rows];
    const groups = new Map();
    for (const row of rows) {
      const key = sameness(groupBy.map((expr) => valueOf(expr, row)));
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return [...groups.values()];
  }

  root.XL.runQuery = runQuery;
})(typeof window !== 'undefined' ? window : globalThis);
