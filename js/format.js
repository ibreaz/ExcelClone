/* Turns a computed cell value into the text shown in the grid. No DOM access. */
(function (root) {
  'use strict';

  const { FormulaError, roundTo } = root.XL;

  const SIGNIFICANT_DIGITS = 12; // hides binary noise such as 0.1 + 0.2 = 0.30000000000000004
  const DEFAULT_DECIMALS = { number: 2, percent: 0, eur: 2, usd: 2, ron: 2 };
  const AFFIXES = { percent: ['', '%'], eur: ['', ' €'], usd: ['$', ''], ron: ['', ' lei'] };

  function grouped(value, decimals) {
    const [whole, fraction] = roundTo(Math.abs(value), decimals).toFixed(decimals).split('.');
    const text = whole.replace(/\B(?=(\d{3})+$)/g, ',') + (fraction ? '.' + fraction : '');
    return (value < 0 && Number(text.replace(/,/g, '')) !== 0 ? '-' : '') + text;
  }

  function formatNumber(value, style) {
    const format = style.format ?? 'general';
    if (format === 'general' && style.decimals === undefined) return String(Number(value.toPrecision(SIGNIFICANT_DIGITS)));
    const decimals = style.decimals ?? DEFAULT_DECIMALS[format] ?? 0;
    const [prefix, suffix] = AFFIXES[format] ?? ['', ''];
    const scaled = format === 'percent' ? value * 100 : value;
    return prefix + grouped(scaled, decimals) + suffix;
  }

  /** style.format: general | number | percent | eur | usd | ron; style.decimals overrides the default. */
  function formatValue(value, style = {}) {
    if (value instanceof FormulaError) return value.message;
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (typeof value === 'number') return formatNumber(value, style);
    return value;
  }

  root.XL.formatValue = formatValue;
  root.XL.DEFAULT_DECIMALS = DEFAULT_DECIMALS;
})(typeof window !== 'undefined' ? window : globalThis);
