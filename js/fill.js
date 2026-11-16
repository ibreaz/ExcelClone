/* Continuing a series when cells are filled by dragging. No DOM access. */
(function (root) {
  'use strict';

  const { parseDate, literalNumber, plainNumber, formatValue } = root.XL;

  const ONE_DAY = 1;
  const TOLERANCE = 1e-9;

  /** index -> content, for values that go up or down by the same step; null when they do not. */
  function linear(values, step, toRaw) {
    const isEvenlySpaced = values.every((value, i) => i === 0 || Math.abs(value - values[i - 1] - step) < TOLERANCE);
    return isEvenlySpaced ? (index) => toRaw(values[0] + step * index) : null;
  }

  /**
   * How a line of cell contents continues: a function from the position (0 is the first given cell,
   * negative positions come before it) to the content there, or null when the cells are to be copied.
   * Two or more numbers continue with their step (1, 2 -> 3, 4; 10, 20 -> 30); dates do too, and a
   * single date continues day by day. A single number, formulas and text are copied.
   */
  function seriesOf(raws) {
    const dates = raws.map((raw) => parseDate(raw));
    if (dates.every(Boolean)) {
      const serials = dates.map((date) => date.serial);
      const step = serials.length > 1 ? serials[1] - serials[0] : ONE_DAY;
      return linear(serials, step, (serial) => formatValue(serial, { format: dates[0].format }));
    }
    const numbers = raws.map(literalNumber);
    const isNumberSeries = numbers.length > 1 && numbers.every((number) => number !== null);
    return isNumberSeries ? linear(numbers, numbers[1] - numbers[0], plainNumber) : null;
  }

  root.XL.seriesOf = seriesOf;
})(typeof window !== 'undefined' ? window : globalThis);
