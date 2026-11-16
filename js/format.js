/* Turns a computed cell value into the text shown in the grid. No DOM access. */
(function (root) {
  'use strict';

  const { FormulaError, roundTo, dateParts, plainNumber } = root.XL;

  const DEFAULT_DECIMALS = { number: 2, percent: 0, eur: 2, usd: 2, ron: 2 };
  const AFFIXES = { percent: ['', '%'], eur: ['', ' €'], usd: ['$', ''], ron: ['', ' lei'] };

  const twoDigits = (number) => String(number).padStart(2, '0');
  const DATE_FORMATS = {
    'date': ({ year, month, day }) => `${year}-${twoDigits(month)}-${twoDigits(day)}`,
    'date-dmy': ({ year, month, day }) => `${twoDigits(day)}.${twoDigits(month)}.${year}`,
  };

  function grouped(value, decimals) {
    const [whole, fraction] = roundTo(Math.abs(value), decimals).toFixed(decimals).split('.');
    const text = whole.replace(/\B(?=(\d{3})+$)/g, ',') + (fraction ? '.' + fraction : '');
    return (value < 0 && Number(text.replace(/,/g, '')) !== 0 ? '-' : '') + text;
  }

  function formatNumber(value, style) {
    const format = style.format ?? 'general';
    if (DATE_FORMATS[format]) return DATE_FORMATS[format](dateParts(value));
    if (format === 'general' && style.decimals === undefined) return plainNumber(value);
    const decimals = style.decimals ?? DEFAULT_DECIMALS[format] ?? 0;
    const [prefix, suffix] = AFFIXES[format] ?? ['', ''];
    const scaled = format === 'percent' ? value * 100 : value;
    return prefix + grouped(scaled, decimals) + suffix;
  }

  /** style.format: general or one of NUMBER_FORMATS; style.decimals overrides the default number of decimals. */
  function formatValue(value, style = {}) {
    if (value instanceof FormulaError) return value.message;
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (typeof value === 'number') return formatNumber(value, style);
    return value;
  }

  root.XL.formatValue = formatValue;
  root.XL.NUMBER_FORMATS = [...Object.keys(DEFAULT_DECIMALS), ...Object.keys(DATE_FORMATS)];
  root.XL.DEFAULT_DECIMALS = DEFAULT_DECIMALS;
})(typeof window !== 'undefined' ? window : globalThis);
